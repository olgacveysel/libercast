import { importCatalog } from '@main/db/repo/import'
import { createPlaylist, setServerTimezone } from '@main/db/repo/playlists'
import * as catalog from '@main/db/repo/catalog'
import { setPassword } from '@main/secure/credentials'
import { resolveProviderStream } from '@main/media/resolve'
import {
  canReplay,
  catchupWindowMs,
  durationMinutes,
  formatStart,
  isOnNow
} from '@shared/catchup'

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

console.log('\nThe stamp panels expect')

// Not ISO 8601, not a Unix time: a format of the panel's own invention, with a
// colon where the time begins and a hyphen inside it.
const noon = Date.UTC(2026, 2, 7, 12, 5)
check('it is YYYY-MM-DD:HH-MM', formatStart(noon, 'UTC') === '2026-03-07:12-05', formatStart(noon, 'UTC'))
check('single digits are padded', formatStart(Date.UTC(2026, 0, 3, 4, 7), 'UTC') === '2026-01-03:04-07')
check('midnight is 00, not 24', formatStart(Date.UTC(2026, 0, 3, 0, 0), 'UTC') === '2026-01-03:00-00')
check('a Date works as well as a number', formatStart(new Date(noon), 'UTC') === '2026-03-07:12-05')

console.log('\nThe panel’s clock, not the viewer’s')

// The single most likely thing to be wrong, and the most invisible: an hour
// out means the programme starts in the wrong place with nothing on screen to
// explain it.
check(
  'a panel three hours ahead gets its own wall clock',
  formatStart(noon, 'Europe/Istanbul') === '2026-03-07:15-05',
  formatStart(noon, 'Europe/Istanbul')
)
check(
  'and one behind gets its own too',
  formatStart(noon, 'America/New_York') === '2026-03-07:07-05',
  formatStart(noon, 'America/New_York')
)
// A stamp that crosses midnight in the panel's zone has to change date too,
// not just hour.
check(
  'crossing midnight changes the date as well',
  formatStart(Date.UTC(2026, 2, 7, 23, 30), 'Europe/Istanbul') === '2026-03-08:02-30',
  formatStart(Date.UTC(2026, 2, 7, 23, 30), 'Europe/Istanbul')
)
check(
  'a timezone this engine never heard of does not break catch-up',
  formatStart(noon, 'Mars/Olympus').length === 16,
  formatStart(noon, 'Mars/Olympus')
)
check('no timezone falls back to the viewer’s clock', formatStart(noon, null).length === 16)
check('an invalid time is refused rather than sent', (() => {
  try {
    formatStart(Number.NaN, 'UTC')
    return false
  } catch {
    return true
  }
})())

console.log('\nHow long to ask for')

const hour = { startsAt: 0, endsAt: 60 * 60_000 }
// Panels cut at exactly the length asked for, and every programme starts a few
// seconds late, so an exact request loses the ending.
check('an hour asks for a little over an hour', durationMinutes(hour) === 61)
check('a half hour asks for 31', durationMinutes({ startsAt: 0, endsAt: 30 * 60_000 }) === 31)
check('a ragged length rounds up', durationMinutes({ startsAt: 0, endsAt: 90_000 }) === 3)
check('a zero-length programme still asks for a minute', durationMinutes({ startsAt: 5, endsAt: 5 }) === 1)
check('a backwards programme does not ask for negative time',
  durationMinutes({ startsAt: 100, endsAt: 0 }) === 1)

console.log('\nHow far back the archive goes')

check('no archive is no window', catchupWindowMs(0) === 0)
check('a day is a day', catchupWindowMs(1) === 86_400_000)
check('a week is seven', catchupWindowMs(7) === 7 * 86_400_000)
check('a nonsense value is no window', catchupWindowMs(Number.NaN) === 0)
check('a negative value is no window', catchupWindowMs(-3) === 0)

console.log('\nWhether a programme can be replayed')

const now = Date.UTC(2026, 2, 7, 20, 0)
const ago = (hours: number) => ({
  startsAt: now - hours * 3_600_000,
  endsAt: now - (hours - 1) * 3_600_000
})

check('a channel with no archive can never replay', !canReplay(ago(2), 0, now))
check('a programme from two hours ago can', canReplay(ago(2), 1, now))
check('and one from six days ago, with a week kept', canReplay(ago(24 * 6), 7, now))
// Offering a replay the panel will refuse spends a connection to learn what
// the listing already said.
check('but not one from eight days ago', !canReplay(ago(24 * 8), 7, now))
check('nor one older than the single day kept', !canReplay(ago(30), 1, now))

// A programme still running is live, not catch-up: the two must never both be
// true for the same entry.
const onAir = { startsAt: now - 600_000, endsAt: now + 600_000 }
check('a programme on now is not replayed', !canReplay(onAir, 7, now))
check('it is simply on', isOnNow(onAir, now))
check('a finished programme is not on now', !isOnNow(ago(2), now))
check('a programme yet to start is neither',
  !canReplay({ startsAt: now + 3_600_000, endsAt: now + 7_200_000 }, 7, now) &&
    !isOnNow({ startsAt: now + 3_600_000, endsAt: now + 7_200_000 }, now))
check('one that ended a second ago can be replayed',
  canReplay({ startsAt: now - 3_600_000, endsAt: now - 1000 }, 1, now))
check('the far edge of the window is still inside it',
  canReplay({ startsAt: now - 86_400_000, endsAt: now - 80_000_000 }, 1, now))

/* ------------------------------------------------------------------ */
/* Against a real catalogue                                            */
/* ------------------------------------------------------------------ */

console.log('\nThe URL a panel is actually asked for')

const playlist = createPlaylist({
  name: 'Panel',
  kind: 'xtream',
  url: 'http://panel.example.com:8080',
  username: 'joe'
})
setPassword(playlist.id, 's3cr3t')
// The panel is three hours ahead of UTC; its archive URLs must say so.
setServerTimezone(playlist.id, 'Europe/Istanbul')

const liveChannel = (externalId: string, name: string, catchupDays: number) => ({
  externalId,
  name,
  categoryExternalId: null,
  number: null,
  logoUrl: null,
  epgChannelId: null,
  streamUrl: `http://panel.example.com:8080/live/joe/s3cr3t/${externalId}.ts`,
  containerExtension: 'ts',
  isAdult: false,
  catchupDays
})

importCatalog(playlist.id, 'live', [], [
  liveChannel('501', 'Archive Channel', 7),
  liveChannel('502', 'No Archive Channel', 0)
])

const live = catalog.queryChannels({ playlistId: playlist.id, kind: 'live', limit: 10 })
const archived = live.find((c) => c.name === 'Archive Channel')!
const plain = live.find((c) => c.name === 'No Archive Channel')!

check('the archive length survives the import', archived.catchupDays === 7, archived.catchupDays)
check('and a channel without one keeps zero', plain.catchupDays === 0, plain.catchupDays)

const started = Date.now() - 3 * 3_600_000
const window = { startsAt: started, endsAt: started + 3_600_000 }
const resolved = resolveProviderStream({ type: 'catchup', id: archived.id, ...window })

check('it asks the timeshift endpoint', resolved.url.includes('timeshift.php'), resolved.url)
check('with the stream id', resolved.url.includes('stream=501'), resolved.url)
check('and the length in minutes', resolved.url.includes('duration=61'), resolved.url)
check(
  'the start is the panel’s own wall clock',
  resolved.url.includes(`start=${encodeURIComponent(formatStart(started, 'Europe/Istanbul'))}`),
  resolved.url
)
// Panels are split between the query form and the path form, and the one that
// is not supported answers with an error page rather than a redirect.
check('the path form is offered as an alternate',
  resolved.alternates.some((u) => u.includes('/timeshift/')), resolved.alternates)
check('the alternate carries the same window',
  resolved.alternates[0]?.includes('/61/') === true, resolved.alternates)
check('a replay is not treated as live', resolved.isLive === false)
check('and its length is known up front', resolved.durationSecs === 3600, resolved.durationSecs)
check('the label says what it is', resolved.label.includes('catch-up'), resolved.label)

console.log('\nWhat it refuses')

const refuses = (source: Parameters<typeof resolveProviderStream>[0]): string | null => {
  try {
    resolveProviderStream(source)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

check('a channel with no archive is refused',
  refuses({ type: 'catchup', id: plain.id, ...window })?.includes('no catch-up') === true,
  refuses({ type: 'catchup', id: plain.id, ...window }))

const tooOld = Date.now() - 9 * 24 * 3_600_000
check('a programme older than the window is refused',
  refuses({ type: 'catchup', id: archived.id, startsAt: tooOld, endsAt: tooOld + 3_600_000 })
    ?.includes('outside the archive') === true)

const future = Date.now() + 3_600_000
check('a programme that has not finished is refused',
  refuses({ type: 'catchup', id: archived.id, startsAt: future, endsAt: future + 3_600_000 }) !== null)

console.log(failures === 0 ? '\ncatchup: all passed' : `\ncatchup: ${failures} failed`)
process.exit(failures === 0 ? 0 : 1)
