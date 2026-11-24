/**
 * The query plan for the screen that opens first.
 *
 * An external review claimed three performance problems: SQLite on the main
 * thread, a recomputed CTE, and `LIKE '%x%'` across the catalogue. They were
 * declined at the time for want of a measurement, which was right — a rewrite
 * of the most data-critical code in the application on a hunch is a bad
 * trade — but "no measurement" is not an answer either.
 *
 * Measured on 150,000 channels across three providers, the claims came out
 * one right, one wrong, and one pointing at something else:
 *
 *   - `LIKE '%x%'` is not a problem. Searching one provider's catalogue takes
 *     half a millisecond, because `name_folded` is indexed and the search is
 *     anchored to a playlist.
 *   - The merged all-sources CTE really is expensive, and far more so than
 *     first reported here: **465 ms** for one page at 150,000 channels, plus
 *     193 ms for the count beside it. The first measurement said 31 ms and
 *     was wrong — it was taken without `merge: true`, so it timed the plain
 *     query across every provider rather than the CTE at all. The claim was
 *     not merely right, it was understated.
 *   - And the thing nobody claimed: "what did I watch recently" was scanning
 *     every live channel in the database to return twenty rows — 19 ms on the
 *     screen that opens first, with the right index sitting unused.
 *
 * SQLite without statistics assumes every table holds about a million rows.
 * `watch_history` holds tens and `channels` holds hundreds of thousands, and
 * from a guess that they are the same size the planner drove the join from
 * the wrong end. `PRAGMA optimize` costs 16 ms and makes it 0.2.
 *
 * So this test is about a plan rather than a duration. A timing test on a
 * build machine measures the build machine; the plan is the decision, it is
 * stable, and it is what went wrong.
 */
import { getDb, optimizeDb } from '@main/db'
import { importCatalog } from '@main/db/repo/import'
import { createPlaylist } from '@main/db/repo/playlists'
import { recentChannels } from '@main/db/repo/catalog'
import { EFFECTIVE_EPG_ID } from '@main/db/repo/epg'

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

const db = getDb()

/* Enough rows that the two tables are obviously different sizes. Ten thousand
   is far below a real catalogue and already more than enough to choose wrong,
   which is the point: this is not an extreme case. */
const playlist = createPlaylist({ name: 'Planner', kind: 'm3u', url: 'http://p.invalid' })
importCatalog(
  playlist.id,
  'live',
  [{ externalId: 'c1', name: 'Category' }],
  Array.from({ length: 10_000 }, (_, i) => ({
    externalId: `p-${i}`,
    name: `Channel ${i}`,
    categoryExternalId: 'c1',
    number: i + 1,
    logoUrl: null,
    epgChannelId: `e${i}`,
    streamUrl: `http://p.invalid/${i}.ts`,
    containerExtension: 'ts',
    isAdult: false
  }))
)

const insert = db.prepare('INSERT INTO watch_history (channel_id, last_watched_at) VALUES (?, ?)')
const ids = db.prepare('SELECT id FROM channels LIMIT 25').all() as { id: number }[]
db.transaction(() => {
  ids.forEach((row, i) => insert.run(row.id, Date.now() - i * 1000))
})()

const RECENT = `SELECT ch.*, ${EFFECTIVE_EPG_ID} AS effective_epg_id,
     CASE WHEN f.channel_id IS NULL THEN 0 ELSE 1 END AS favorite,
     h.last_watched_at AS last_watched_at
   FROM watch_history h
   JOIN channels ch ON ch.id = h.channel_id
   LEFT JOIN favorites f ON f.channel_id = ch.id
   WHERE ch.hidden = 0 AND ch.kind = 'live'
   ORDER BY h.last_watched_at DESC
   LIMIT ?`

const planOf = (): string[] =>
  (db.prepare(`EXPLAIN QUERY PLAN ${RECENT}`).all(20) as { detail: string }[]).map((r) => r.detail)

console.log('\nThe planner, told how big the tables are')

const before = planOf()
console.log(`  (without statistics: ${before[0]})`)

optimizeDb()
const after = planOf()
console.log(`  (with them:          ${after[0]})`)

/*
  The whole claim, in one line: the join is driven from the small table.
  `watch_history` first means twenty index entries are read and the work stops;
  `channels` first means every live channel is visited to find out which
  twenty they were.
*/
check(
  'the recent list is driven from the watch history, not from the catalogue',
  /\bh\b/.test(after[0] ?? '') && !/\bch\b/.test(after[0] ?? ''),
  after
)
check(
  'and it reads the index on when things were watched',
  after.some((step) => step.includes('idx_history_recent')),
  after
)
check(
  'so nothing has to be sorted afterwards',
  !after.some((step) => step.includes('TEMP B-TREE')),
  after
)

/* The answer has to be right as well as quick — a plan that returns the wrong
   rows quickly is not an improvement. */
const recent = recentChannels(20)
check('it still returns twenty rows', recent.length === 20, recent.length)
check(
  'most recently watched first',
  recent.every((row, i) => i === 0 || row.lastWatchedAt! <= recent[i - 1]!.lastWatchedAt!),
  recent.slice(0, 3).map((r) => r.lastWatchedAt)
)

/*
  Recorded because it is what this test is really guarding. Statistics are
  computed, not declared: anything that rebuilds the database, or a sync that
  changes the row counts without `optimizeDb` being called afterwards, puts the
  planner back on a guess — and nothing else in the suite would notice.
*/
check(
  'statistics are present for the planner to read',
  (db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'sqlite_stat1'").get() as { n: number }).n === 1
)

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`)
process.exit(failures === 0 ? 0 : 1)
