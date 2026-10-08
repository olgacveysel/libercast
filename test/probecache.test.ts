import { getDb } from '@main/db'
import { forgetProbe, pruneProbes, readProbe, writeProbe } from '@main/db/repo/probeCache'

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

getDb()

console.log('\nRemembering what a stream turned out to be')

const answer = { video: 'h264', audio: 'aac', durationSecs: 5400, container: 'matroska,webm' }

writeProbe('provider.example/movie/123.mkv', answer, false)
const back = readProbe<typeof answer>('provider.example/movie/123.mkv')
check('an answer comes back intact', JSON.stringify(back) === JSON.stringify(answer), back)
check('an unknown stream has no answer', readProbe('provider.example/nothing.mkv') === null)

// Re-probing must replace, not accumulate: a provider that re-encodes a channel
// would otherwise be described by whatever it used to be.
writeProbe('provider.example/movie/123.mkv', { ...answer, audio: 'eac3' }, false)
const updated = readProbe<typeof answer>('provider.example/movie/123.mkv')
check('a later answer replaces the earlier one', updated?.audio === 'eac3', updated)
check(
  'and does not leave a duplicate behind',
  (getDb().prepare('SELECT COUNT(*) AS n FROM stream_probes').get() as { n: number }).n === 1
)

console.log('\nExpiry is different for live and for film')

const db = getDb()
const age = (key: string, ms: number): void => {
  db.prepare('UPDATE stream_probes SET updated_at = ? WHERE key = ?').run(Date.now() - ms, key)
}

const DAY = 24 * 3600_000

// A live encode can change at any time; a film cannot.
writeProbe('provider.example/live/9.ts', answer, true)
age('provider.example/live/9.ts', 13 * 3600_000)
check('a live answer older than half a day is not reused', readProbe('provider.example/live/9.ts') === null)

writeProbe('provider.example/live/9.ts', answer, true)
age('provider.example/live/9.ts', 2 * 3600_000)
check('a live answer from two hours ago still is', readProbe('provider.example/live/9.ts') !== null)

age('provider.example/movie/123.mkv', 20 * DAY)
check('a film from three weeks ago is still trusted', readProbe('provider.example/movie/123.mkv') !== null)
age('provider.example/movie/123.mkv', 45 * DAY)
check('a film from six weeks ago is not', readProbe('provider.example/movie/123.mkv') === null)

console.log('\nHousekeeping')

const before = (db.prepare('SELECT COUNT(*) AS n FROM stream_probes').get() as { n: number }).n
check('expired rows are still on disk until pruned', before === 2, before)
check('pruning removes exactly the expired ones', pruneProbes() === 1)
check(
  'and keeps the rest',
  (db.prepare('SELECT COUNT(*) AS n FROM stream_probes').get() as { n: number }).n === 1
)

forgetProbe('provider.example/live/9.ts')
check('an answer can be forgotten outright', readProbe('provider.example/live/9.ts') === null)

// A row written by an older version, or truncated, must not break playback.
db.prepare('INSERT INTO stream_probes (key, payload, is_live, updated_at) VALUES (?, ?, 0, ?)').run(
  'provider.example/broken.mkv',
  '{not json',
  Date.now()
)
check('a corrupt row reads as no answer rather than throwing', readProbe('provider.example/broken.mkv') === null)

// The key is host and path only — the Xtream password is a path segment in the
// real URL and must never reach the database.
const keys = db.prepare('SELECT key FROM stream_probes').all() as { key: string }[]
check('no stored key carries a scheme or credentials', keys.every((row) => !row.key.includes('://')), keys)

console.log(failures === 0 ? '\nprobecache: all passed' : `\nprobecache: ${failures} failed`)
if (failures > 0) process.exitCode = 1
