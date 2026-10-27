import { getDb } from '@main/db'
import { importCatalog } from '@main/db/repo/import'
import { createPlaylist } from '@main/db/repo/playlists'
import * as catalog from '@main/db/repo/catalog'
import {
  clearHealth,
  healthFor,
  HEALTH_TTL_MS,
  pruneHealth,
  recordHealth
} from '@main/db/repo/health'

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

const channel = (externalId: string, name: string) => ({
  externalId,
  name,
  categoryExternalId: null,
  number: null,
  logoUrl: null,
  epgChannelId: null,
  streamUrl: `http://x/${externalId}.ts`,
  containerExtension: 'ts',
  isAdult: false
})

getDb()
const playlist = createPlaylist({ name: 'Provider', kind: 'm3u', url: 'http://m3u' })
importCatalog(playlist.id, 'live', [], [
  channel('a', 'Alive Channel'),
  channel('b', 'Dead Channel'),
  channel('c', 'Never Scanned')
])

const all = catalog.queryChannels({ playlistId: playlist.id, kind: 'live', limit: 10 })
const alive = all.find((c) => c.name === 'Alive Channel')!
const dead = all.find((c) => c.name === 'Dead Channel')!
const unscanned = all.find((c) => c.name === 'Never Scanned')!

console.log('\nBefore anything has been scanned')

check('a channel carries no verdict', alive.health === null, alive.health)
check('and asking for one returns nothing', healthFor([alive.id]).size === 0)
check('asking about nothing is not an error', healthFor([]).size === 0)

console.log('\nAfter a scan')

const now = Date.now()
recordHealth([
  { channelId: alive.id, name: 'Alive Channel', ok: true, reason: null, checkedAt: now },
  { channelId: dead.id, name: 'Dead Channel', ok: false, reason: 'HTTP 404', checkedAt: now }
])

const scanned = catalog.queryChannels({ playlistId: playlist.id, kind: 'live', limit: 10 })
const alive2 = scanned.find((c) => c.id === alive.id)!
const dead2 = scanned.find((c) => c.id === dead.id)!

check('the verdict survives the panel closing', dead2.health?.ok === false, dead2.health)
check('and carries the provider’s own wording', dead2.health?.reason === 'HTTP 404', dead2.health)
check('a channel that answered is marked as such', alive2.health?.ok === true, alive2.health)
check(
  'one never scanned still has no verdict',
  scanned.find((c) => c.id === unscanned.id)?.health === null
)
check('a single channel lookup carries it too', catalog.getChannel(dead.id)?.health?.ok === false)

// Re-running a scan must correct a verdict rather than add a second one.
recordHealth([{ channelId: dead.id, name: 'Dead Channel', ok: true, reason: null, checkedAt: now + 1 }])
const rescanned = catalog.getChannel(dead.id)
check('a later scan replaces the earlier verdict', rescanned?.health?.ok === true, rescanned?.health)
check(
  'and leaves exactly one row behind',
  (getDb().prepare('SELECT COUNT(*) AS n FROM channel_health WHERE channel_id = ?').get(dead.id) as {
    n: number
  }).n === 1
)

console.log('\nVerdicts go stale')

// A channel that was dead last week says nothing about today. A stale red mark
// on a channel that works again is worse than no mark, because it stops the
// user trying it.
const old = now - HEALTH_TTL_MS - 60_000
recordHealth([{ channelId: dead.id, name: 'Dead Channel', ok: false, reason: 'HTTP 404', checkedAt: old }])
check('an expired verdict is not shown', catalog.getChannel(dead.id)?.health === null)
check('nor handed out directly', healthFor([dead.id]).size === 0)
check('but it is still on disk until pruned',
  (getDb().prepare('SELECT COUNT(*) AS n FROM channel_health').get() as { n: number }).n === 2)
check('pruning removes exactly the expired one', pruneHealth() === 1)
check('and keeps the fresh one',
  (getDb().prepare('SELECT COUNT(*) AS n FROM channel_health').get() as { n: number }).n === 1)

console.log('\nPlaying a channel clears its mark')

recordHealth([
  { channelId: dead.id, name: 'Dead Channel', ok: false, reason: 'HTTP 404', checkedAt: Date.now() }
])
check('the mark is there to begin with', catalog.getChannel(dead.id)?.health?.ok === false)
clearHealth(dead.id)
check('and playing it takes the mark away', catalog.getChannel(dead.id)?.health === null)
check('clearing a channel that has no mark is harmless', (clearHealth(unscanned.id), true))

console.log('\nWhen a channel goes away')

getDb().prepare('DELETE FROM channels WHERE id = ?').run(alive.id)
check(
  'its verdict goes with it',
  (getDb().prepare('SELECT COUNT(*) AS n FROM channel_health WHERE channel_id = ?').get(alive.id) as {
    n: number
  }).n === 0
)

console.log(failures === 0 ? '\nhealth: all passed' : `\nhealth: ${failures} failed`)
process.exit(failures === 0 ? 0 : 1)
