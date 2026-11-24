/**
 * The grouping behind the all-sources list, and the upgrade that fills it in.
 *
 * `merged.test.ts` settles what the merged list must show. This settles the
 * column it now reads to show it: that resolving the grouping once gives the
 * same answer as working it out per query, and — the part that would have
 * shipped broken — that an existing install gets it on upgrade rather than
 * waiting for its next sync.
 *
 * `group_key` defaults to the empty string, and an empty key is a key like
 * any other: every channel in a catalogue would share it, and the merged list
 * would collapse to one row. An upgrade must not break a screen and then wait
 * to be rescued, so the migration backfills. This checks the backfill agrees
 * with the code that maintains the column afterwards — two expressions of the
 * same rules, in different languages, which is exactly the pair that drifts.
 */
import { getDb } from '@main/db'
import { MIGRATIONS } from '@main/db/migrations'
import { importCatalog } from '@main/db/repo/import'
import { createPlaylist } from '@main/db/repo/playlists'
import { rebuildGrouping } from '@main/db/repo/grouping'

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

const db = getDb()
const channel = (externalId: string, name: string) => ({
  externalId,
  name,
  categoryExternalId: null,
  number: null,
  logoUrl: null,
  epgChannelId: null,
  streamUrl: `http://p.invalid/${externalId}.ts`,
  containerExtension: 'ts',
  isAdult: false
})

const a = createPlaylist({ name: 'A', kind: 'm3u', url: 'http://p.invalid/a' })
const b = createPlaylist({ name: 'B', kind: 'm3u', url: 'http://p.invalid/b' })

/* The cases that make grouping more than lowercasing: a quality suffix, a
   prefix with a plain counterpart, two prefixes that must block each other,
   and names that normalise to nothing. */
importCatalog(a.id, 'live', [], [
  channel('a1', 'Alto Sports 2 HD'),
  channel('a2', 'UK Harbour Sports 2'),
  channel('a3', 'Harbour Sports 2'),
  channel('a4', 'FR Lumen Channel'),
  channel('a5', '4K')
])
importCatalog(b.id, 'live', [], [
  channel('b1', 'ALTO SPORTS 2'),
  channel('b2', 'DE Harbour Sports 2'),
  channel('b3', '|||')
])

type Row = { id: number; name: string; group_key: string; playlist_sort: number }
const rows = (): Row[] => db.prepare('SELECT id, name, group_key, playlist_sort FROM channels ORDER BY id').all() as Row[]
const keyOf = (name: string, from = rows()): string => from.find((r) => r.name === name)!.group_key

console.log('\nResolved once, at sync')

const built = rows()
check('every channel has a key', built.every((r) => r.group_key !== ''), built.filter((r) => r.group_key === ''))
check(
  'a quality suffix does not separate two spellings of one channel',
  keyOf('Alto Sports 2 HD', built) === keyOf('ALTO SPORTS 2', built),
  [keyOf('Alto Sports 2 HD', built), keyOf('ALTO SPORTS 2', built)]
)
check(
  'two differently prefixed feeds stay apart from the plain name',
  new Set([
    keyOf('UK Harbour Sports 2', built),
    keyOf('DE Harbour Sports 2', built),
    keyOf('Harbour Sports 2', built)
  ]).size === 3,
  built.filter((r) => r.name.includes('Harbour')).map((r) => r.group_key)
)
check(
  'a name that normalises to nothing groups only with itself',
  keyOf('4K', built) !== keyOf('|||', built) && keyOf('4K', built).startsWith('id:'),
  [keyOf('4K', built), keyOf('|||', built)]
)
check(
  "each row carries its provider's position",
  built.every((r) => typeof r.playlist_sort === 'number')
)

console.log('\nAn install upgrading from before the column existed')

/*
  What version 15 finds: the columns added, carrying their defaults. Running
  only the backfill half of it is the closest this can come to the real
  upgrade without a database from the previous release.
*/
db.exec("UPDATE channels SET group_key = '', playlist_sort = -1")
const fifteen = MIGRATIONS.find((m) => m.version === 15)
check('the migration is there to run', fifteen !== undefined)
db.exec(fifteen!.up.slice(fifteen!.up.indexOf('UPDATE channels')))

const upgraded = rows()
check(
  'the backfill reproduces exactly what a sync produces',
  JSON.stringify(upgraded) === JSON.stringify(built),
  upgraded.map((r) => `${r.name} -> ${r.group_key}`)
)
check('and leaves nothing without a key', upgraded.every((r) => r.group_key !== ''))

console.log('\nAnd it stays right as the catalogue changes')

/*
  Whether a prefixed name may collapse onto its plain form depends on what the
  *other* providers offer, so a second source arriving can change how the
  first one's channels group. That is why the rebuild is catalogue-wide rather
  than per playlist — and it is the kind of thing that works until the day
  somebody optimises it to only touch what was just imported.
*/
const c = createPlaylist({ name: 'C', kind: 'm3u', url: 'http://p.invalid/c' })
importCatalog(c.id, 'live', [], [channel('c1', 'Lumen Channel')])
const after = rows()
check(
  'a new source can collapse a prefix that stood alone before',
  keyOf('FR Lumen Channel', after) === keyOf('Lumen Channel', after),
  [keyOf('FR Lumen Channel', after), keyOf('Lumen Channel', after)]
)
check(
  'and the channels it did not touch keep their keys',
  keyOf('Alto Sports 2 HD', after) === keyOf('Alto Sports 2 HD', built)
)

/* Rebuilding twice must not change anything: it is a resolution, not a step. */
rebuildGrouping()
check('rebuilding again changes nothing', JSON.stringify(rows()) === JSON.stringify(after))

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`)
process.exit(failures === 0 ? 0 : 1)
