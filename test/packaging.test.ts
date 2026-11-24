import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { load } from 'js-yaml'

/*
 * What ends up inside the package.
 *
 * electron-builder's `files` is a filter, and a platform block's copy of it
 * does not extend the top-level one — it replaces that list, and
 * electron-builder's own defaults with it. The `win:` and `linux:` blocks here
 * existed only to drop the ffprobe and better-sqlite3 binaries belonging to
 * platforms not being built, four lines each, and those four lines quietly
 * became the whole filter.
 *
 * The result shipped for several releases: every Windows and Linux package
 * carried the full source tree, the test suite and the `.git` directory, and
 * one built on a working machine carried whatever else was lying in the folder
 * beside them. Nothing caught it. The size guard in `tools/after-pack.cjs`
 * only fails above 60 MB and the archive was still under five, the installer
 * grew by an amount the engine upgrade could explain, and nobody opens an
 * asar to see what is in it.
 *
 * So the three lists are compared here instead. The duplication in the
 * configuration is deliberate — there is no way to splice one YAML sequence
 * into another — and this is what keeps it from drifting.
 */

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

interface BuilderConfig {
  files?: string[]
  win?: { files?: string[] }
  linux?: { files?: string[] }
  asarUnpack?: string[]
}

// The runner bundles each test elsewhere and runs it with the project root as
// the working directory, so `__dirname` points at the bundle rather than here.
const root = process.cwd()
const config = load(readFileSync(join(root, 'electron-builder.yml'), 'utf8')) as BuilderConfig

const common = config.files ?? []
const win = config.win?.files ?? []
const linux = config.linux?.files ?? []

console.log('\nThe three lists')
check('the top-level list is not empty', common.length > 0, common.length)
check('the Windows build has its own list', win.length > 0, win.length)
check('the Linux build has its own list', linux.length > 0, linux.length)

// A platform list may add to the common one; it may never drop from it.
const missingFromWin = common.filter((pattern) => !win.includes(pattern))
const missingFromLinux = common.filter((pattern) => !linux.includes(pattern))

check('Windows repeats every common exclusion', missingFromWin.length === 0, missingFromWin)
check('Linux repeats every common exclusion', missingFromLinux.length === 0, missingFromLinux)

/*
 * The things that must not ship, named rather than inferred.
 *
 * Checking only that the lists match each other would pass happily if all
 * three were emptied, so the ones that actually caused this are stated. `.git`
 * is here because it is excluded by electron-builder's defaults and therefore
 * was never in the configuration at all — which is exactly why a platform
 * block replacing those defaults put the whole repository history into the
 * package.
 */
console.log('\nThings that must never be packaged')
const MUST_EXCLUDE = ['.git', 'src', 'test', 'release', 'Claude outputs']

for (const name of MUST_EXCLUDE) {
  // Both spellings: the directory, and everything under it.
  const wanted = [`!${name}`, `!${name}/**/*`]
  for (const [label, list] of [
    ['top level', common],
    ['Windows', win],
    ['Linux', linux]
  ] as const) {
    const has = wanted.every((pattern) => list.includes(pattern))
    check(`${label}: "${name}" is excluded`, has, list.filter((p) => p.includes(name)))
  }
}

console.log('\nStray files from a working folder')
// A log beside the source is what a local build swept up, and the log is the
// one file in that folder with a user's own provider hostnames in it.
for (const [label, list] of [
  ['top level', common],
  ['Windows', win],
  ['Linux', linux]
] as const) {
  check(`${label}: log files are excluded`, list.includes('!*.log'), list.filter((p) => p.includes('log')))
}

console.log('\nWhat still has to be packaged')
// The exclusions must not have taken the application with them.
const unpack = config.asarUnpack ?? []
check(
  'the database addon is still unpacked',
  unpack.some((pattern) => pattern.includes('better-sqlite3')),
  unpack
)
check(
  'ffmpeg is still unpacked',
  unpack.some((pattern) => pattern.includes('ffmpeg-static')),
  unpack
)
check('nothing excludes out/', !common.some((pattern) => /^!out\b/.test(pattern)))

/*
  Everything at the top of the repository has to have been decided about.

  `tools/after-pack.cjs` catches a stray file by reading the archive, which is
  the check that matters because it works on the artifact. But it only runs
  during a package, so the answer arrives forty minutes into a release build —
  which is exactly how it arrived: a release-notes file was added at the root,
  committed, tagged, and the Linux job failed on it.

  This asks the same question of the working tree, in the unit suite, in
  milliseconds. Anything at the root must be one of three things: packaged on
  purpose, excluded on purpose, or dropped by electron-builder itself. A new
  entry that is none of them fails here and names itself.
*/
console.log('\nNothing at the root packages itself')

/** What `tools/after-pack.cjs` expects to find inside the archive. */
const PACKAGED = new Set(['out', 'node_modules', 'package.json', 'electron-builder.yml', 'resources'])

/**
 * Names electron-builder drops without being told to.
 *
 * Kept short and explicit rather than modelled: if a future version stops
 * dropping one of these, this test fails and says so, instead of a build
 * quietly including it.
 */
const DROPPED_BY_BUILDER = new Set(['LICENSE', 'LICENCE', 'LICENSE.md', 'LICENSE.txt', '.DS_Store'])

/** Expands `{a,b,c}` into the alternatives it stands for. */
function expand(pattern: string): string[] {
  const match = /\{([^{}]*)\}/.exec(pattern)
  if (!match) return [pattern]
  return match[1]!
    .split(',')
    .flatMap((option) => expand(pattern.replace(match[0], option)))
}

/**
 * Whether an exclusion pattern covers a root-level entry.
 *
 * Only the pattern shapes the configuration actually uses are understood, and
 * an unrecognised one fails rather than being ignored — a pattern this cannot
 * read is a pattern whose entries this test would wrongly report as stray.
 */
function covers(pattern: string, entry: string): boolean | null {
  // Patterns reaching into a directory are covered by the directory's own.
  if (pattern.includes('/')) return false
  if (!/^[\w.*{}, +-]+$/.test(pattern)) return null
  const regex = new RegExp(
    `^${pattern.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`
  )
  return regex.test(entry)
}

const exclusions = common.filter((p) => p.startsWith('!')).flatMap((p) => expand(p.slice(1)))
const unreadable: string[] = []
const excluded = (entry: string): boolean =>
  exclusions.some((pattern) => {
    const result = covers(pattern, entry)
    if (result === null) unreadable.push(pattern)
    return result === true
  })

const rootEntries = readdirSync(root).filter((name) => name !== '.git')
check('the repository root could be read', rootEntries.length > 0)

const stray = rootEntries.filter(
  (entry) => !PACKAGED.has(entry) && !DROPPED_BY_BUILDER.has(entry) && !excluded(entry)
)
check(
  'every entry at the root is packaged, excluded, or dropped by the builder',
  stray.length === 0,
  stray.length === 0
    ? undefined
    : `${stray.join(', ')} — add an exclusion to ALL THREE lists in electron-builder.yml, ` +
      'or move it under a directory that already has one'
)
check('every exclusion pattern could be read', unreadable.length === 0, [...new Set(unreadable)])

/*
  And the same question of the other two lists, since a platform block
  replaces the top-level list rather than extending it — so an exclusion added
  to one of them and not the others is an entry that ships on one platform.
*/
for (const [label, list] of [
  ['Windows', win],
  ['Linux', linux]
] as const) {
  const theirs = new Set(list.filter((p) => p.startsWith('!')))
  const missing = common.filter((p) => p.startsWith('!') && !theirs.has(p))
  check(`${label}: carries every exclusion the top-level list has`, missing.length === 0, missing)
}

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`)
process.exit(failures === 0 ? 0 : 1)
