import Database from 'better-sqlite3'
import { MIGRATIONS, migrate } from '@main/db/migrations'

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

/**
 * Existing installs already hold a v1 database full of the user's favorites and
 * history, so the upgrade has to backfill in place rather than start over.
 * This builds a real v1 database, populates it the way a v1 sync would, and
 * then runs the migration.
 */
console.log('\nUpgrading a populated v1 database')

const db = new Database(':memory:')
db.pragma('foreign_keys = ON')

const v1 = MIGRATIONS.find((m) => m.version === 1)!
db.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)')
db.exec(v1.up)
db.prepare('INSERT INTO schema_migrations VALUES (1, ?, ?)').run(v1.name, Date.now())

check('v1 schema has no kind column', !hasColumn(db, 'channels', 'kind'))

db.prepare(
  `INSERT INTO playlists (name, kind, url, epg_offset_min, enabled, sort_order, created_at)
   VALUES ('Provider', 'xtream', 'http://ex.com', 0, 1, 0, ?)`
).run(Date.now())

db.prepare(
  `INSERT INTO categories (playlist_id, external_id, name, kind, sort_order) VALUES (1, 'c1', 'Sports', 'live', 0)`
).run()
db.prepare(
  `INSERT INTO categories (playlist_id, external_id, name, kind, sort_order) VALUES (1, 'c2', 'Action', 'movie', 0)`
).run()

const insertChannel = db.prepare(
  `INSERT INTO channels
     (playlist_id, category_id, external_id, name, name_folded, stream_url, added_at, seen_at)
   VALUES (1, ?, ?, ?, ?, ?, ?, ?)`
)
const now = Date.now()
insertChannel.run(1, '900', 'Sky Sports', 'sky sports', 'http://ex.com/live/1.ts', now, now)
insertChannel.run(2, 'vod:12', 'Some Film', 'some film', 'http://ex.com/movie/12.mp4', now, now)
// An orphan: its category was already pruned, so only the id prefix identifies it.
insertChannel.run(null, 'series:7', 'Some Show', 'some show', '', now, now)

db.prepare('INSERT INTO favorites (channel_id, added_at) VALUES (1, ?)').run(now)
db.prepare('INSERT INTO watch_history (channel_id, last_watched_at, watch_count) VALUES (1, ?, 3)').run(now)

migrate(db)

check('kind column added', hasColumn(db, 'channels', 'kind'))
check('user rows survive', (db.prepare('SELECT COUNT(*) AS n FROM channels').get() as { n: number }).n === 3)
check('favorites survive', (db.prepare('SELECT COUNT(*) AS n FROM favorites').get() as { n: number }).n === 1)
check(
  'watch history survives with its count',
  (db.prepare('SELECT watch_count AS n FROM watch_history WHERE channel_id = 1').get() as { n: number }).n === 3
)

const kinds = db.prepare('SELECT external_id, kind FROM channels ORDER BY id').all() as {
  external_id: string
  kind: string
}[]
check('live channel backfilled from its category', kinds[0]?.kind === 'live', kinds[0])
check('movie backfilled from its category', kinds[1]?.kind === 'movie', kinds[1])
check('orphan backfilled from its id prefix', kinds[2]?.kind === 'series', kinds[2])

for (const table of ['vod_info', 'series_episodes', 'playback_progress', 'epg_state']) {
  check(`${table} created`, tableExists(db, table))
}

migrate(db)
check('re-running the migration is a no-op', (db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }).n === MIGRATIONS.length)

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`)
process.exit(failures === 0 ? 0 : 1)

function hasColumn(database: Database.Database, table: string, column: string): boolean {
  const rows = database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  return rows.some((row) => row.name === column)
}

function tableExists(database: Database.Database, table: string): boolean {
  return (
    database.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !==
    undefined
  )
}
