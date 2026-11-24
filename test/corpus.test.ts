/**
 * Runs the golden-vector corpus against this implementation.
 *
 * `corpus/` holds what the parsers and matchers must *do*, as data: a
 * function name, arguments, and the answer. Nothing in it is TypeScript, so
 * the same cases can be run by a second implementation in another language —
 * which is the point. LiberCast's parsers are the part most likely to be
 * rewritten rather than shared: none of them compiles on Android, and a
 * rewrite that is only checked against its own new tests is a rewrite that
 * quietly disagrees with the original about the playlists people actually
 * have.
 *
 * It pays for itself here first. These cases used to live inside test files
 * as assertions about particular functions, so changing a signature meant
 * rewriting the evidence along with the code — which is how a refactor loses
 * the cases that were hard-won. Here the evidence is data and the only thing
 * a refactor has to update is the adapter below.
 *
 * This file is the adapter and the referee. It also fails when the corpus and
 * the adapter drift apart in either direction, because a vector file nobody
 * runs is worse than no vector file: it reads like coverage.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseM3u } from '@main/sources/m3u'
import { decodeEntities, parseChannelBlock, parseProgrammeBlock, parseXmltvTime } from '@main/sources/xmltv'
import { bestMatch, normalizeName, sameChannelName, similarity } from '@main/sources/epgMatch'
import { canReplay, catchupWindowMs, formatStart } from '@shared/catchup'
import { rankAlternatesDetailed, type AlternateCandidate } from '@main/sources/failover'
import * as xtream from '@main/sources/xtream'
import * as stalker from '@main/sources/stalker'
import { sanitize } from '@shared/filename'
import type { ParsedArchiveRecord } from '@main/sources/types'
import { fold } from '@main/db'

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

// The suite runs from a bundle in the cache directory with the project as its
// working directory, so `__dirname` points at the bundle rather than at here.
const root = join(process.cwd(), 'corpus')

interface Manifest {
  version: number
  rounding: number
  suites: { file: string; function: string; about: string }[]
}

interface Case {
  name: string
  why?: string
  args: unknown[]
  expect: unknown
}

interface Suite {
  function: string
  cases: Case[]
}

/**
 * Every function the corpus may name.
 *
 * Arguments arrive as JSON, positionally, exactly as another language would
 * pass them. Nothing here may massage a case into passing: an adapter that
 * reshapes its input is an adapter that hides a difference between two
 * implementations, which is the one thing this is for.
 */
const FUNCTIONS: Record<string, (...args: never[]) => unknown> = {
  'm3u.parse': (content: string) => parseM3u(content),
  'xmltv.time': (value: string) => parseXmltvTime(value),
  'xmltv.entities': (value: string) => decodeEntities(value),
  'xmltv.programme': (block: string) => parseProgrammeBlock(block),
  'xmltv.channel': (block: string) => parseChannelBlock(block),
  'names.fold': (value: string) => fold(value),
  'names.normalize': (value: string) => normalizeName(value),
  'names.same': (a: string, b: string) => sameChannelName(a, b),
  'names.similarity': (a: string, b: string) => similarity(a, b),
  'names.best': (name: string, candidates: { epgChannelId: string; displayName: string }[]) =>
    bestMatch(name, candidates),
  'catchup.window': (days: number) => catchupWindowMs(days),
  'catchup.replay': (
    programme: { startsAt: number; endsAt: number },
    days: number,
    now: number
  ) => canReplay(programme, days, now),
  'catchup.start': (at: number, timeZone: string | null) => formatStart(at, timeZone),
  'failover.rank': (name: string, candidates: AlternateCandidate[], exclude: number[]) =>
    rankAlternatesDetailed(name, candidates, exclude),
  /*
    One suite for the small coercions, named by their own names. They are a
    family rather than one function, and a case per file would be ten files
    describing one page of code.
  */
  'xtream.fields': (which: string, value: unknown) => {
    const table: Record<string, (v: never) => unknown> = {
      str: xtream.str,
      toInt: xtream.toInt,
      num: xtream.num,
      text: xtream.text,
      firstImage: xtream.firstImage,
      parseDuration: xtream.parseDuration,
      catchupDays: xtream.catchupDays
    }
    const fn = table[which]
    if (!fn) throw new Error(`no coercion named ${which}`)
    return fn(value as never)
  },
  'stalker.identity': (which: string, value: string) => {
    const table: Record<string, (v: string) => unknown> = {
      normalizeMac: stalker.normalizeMac,
      isMacAddress: stalker.isMacAddress,
      serialFor: stalker.serialFor
    }
    const fn = table[which]
    if (!fn) throw new Error(`no helper named ${which}`)
    return fn(value)
  },
  'stalker.link': (which: string, a: string, b: string | null) => {
    if (which === 'stripLinkPrefix') return stalker.stripLinkPrefix(a)
    if (which === 'hasBlankStreamId') return stalker.hasBlankStreamId(a)
    if (which === 'linkAttempts') return stalker.linkAttempts(a, b ?? undefined)
    throw new Error(`no helper named ${which}`)
  },
  'stalker.archive': (records: ParsedArchiveRecord[], startsAt: number) =>
    stalker.archiveCovering(records, startsAt),
  'filename.sanitize': (value: string) => sanitize(value)
}

/**
 * Compares by value, with floating point rounded to the manifest's precision.
 *
 * A similarity score is arithmetic, and two languages doing the same
 * arithmetic agree to far more places than anyone cares about but not
 * necessarily to all of them. Rounding is part of the contract rather than a
 * concession: the corpus states the precision it holds implementations to.
 */
function canonical(value: unknown, places: number): string {
  const round = (v: unknown): unknown => {
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) return String(v)
      return Number.isInteger(v) ? v : Number(v.toFixed(places))
    }
    if (Array.isArray(v)) return v.map(round)
    if (v && typeof v === 'object') {
      // Key order must not decide the answer; another language's object will
      // not share this one's insertion order.
      const out: Record<string, unknown> = {}
      for (const key of Object.keys(v as Record<string, unknown>).sort()) {
        out[key] = round((v as Record<string, unknown>)[key])
      }
      return out
    }
    return v
  }
  return JSON.stringify(round(value))
}

console.log('\ncorpus\n')

const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as Manifest
check('the manifest declares a version', manifest.version === 1)
check('and a rounding precision', typeof manifest.rounding === 'number' && manifest.rounding > 0)

/*
  The corpus and this file must describe the same set of functions. A vector
  file that nothing runs, or an adapter for a suite that no longer exists,
  both read as coverage that is not there.
*/
const onDisk = readdirSync(root)
  .filter((f) => f.endsWith('.json') && f !== 'manifest.json')
  .sort()
const declared = manifest.suites.map((s) => s.file).sort()
check(
  'every vector file is in the manifest, and every manifest entry exists',
  JSON.stringify(onDisk) === JSON.stringify(declared),
  { onDisk, declared }
)

const named = manifest.suites.map((s) => s.function).sort()
const adapted = Object.keys(FUNCTIONS).sort()
check(
  'every function the corpus names has an adapter, and no adapter is unused',
  JSON.stringify(named) === JSON.stringify(adapted),
  { named, adapted }
)

let total = 0

for (const entry of manifest.suites) {
  const suite = JSON.parse(readFileSync(join(root, entry.file), 'utf8')) as Suite
  const run = FUNCTIONS[entry.function]
  if (!run) continue

  console.log(`\n${entry.function} — ${entry.about}`)
  check('the file names the function the manifest expects', suite.function === entry.function, suite.function)
  check('and it holds cases', Array.isArray(suite.cases) && suite.cases.length > 0)

  const names = new Set<string>()
  for (const testCase of suite.cases) {
    total++
    if (names.has(testCase.name)) {
      check(`${testCase.name} — has a name of its own`, false)
      continue
    }
    names.add(testCase.name)

    let actual: unknown
    try {
      actual = run(...(testCase.args as never[]))
    } catch (error) {
      actual = { threw: (error as Error).message }
    }

    const got = canonical(actual, manifest.rounding)
    const want = canonical(testCase.expect, manifest.rounding)
    check(testCase.name, got === want, got === want ? undefined : { want, got })
  }
}

console.log(`\n${total} vectors across ${manifest.suites.length} suites.`)
console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`)
process.exit(failures === 0 ? 0 : 1)
