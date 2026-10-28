import { getDb } from '@main/db'
import { importCatalog } from '@main/db/repo/import'
import { createPlaylist, listPlaylists, markSynced } from '@main/db/repo/playlists'
import * as catalog from '@main/db/repo/catalog'
import * as vod from '@main/db/repo/vod'
import * as recordings from '@main/db/repo/recordings'
import * as reminders from '@main/db/repo/reminders'
import { getSettings, setSettings } from '@main/db/repo/settings'
import { DEFAULT_SETTINGS } from '@shared/types'

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

console.log('\nSchema + playlists')
getDb()
const playlist = createPlaylist({ name: 'Test provider', kind: 'xtream', url: 'http://ex.com:8080', username: 'u' })
check('migration ran and insert works', playlist.id > 0)
check('list returns the playlist', listPlaylists().length === 1)

console.log('\nCatalog import')
const categories = [
  { externalId: 'sports', name: 'Sports' },
  { externalId: 'news', name: 'News' }
]
const channels = Array.from({ length: 5000 }, (_, i) => ({
  externalId: String(i),
  name: i % 2 === 0 ? `Harbour Sports ${i}` : `Civic News ${i}`,
  categoryExternalId: i % 2 === 0 ? 'sports' : 'news',
  number: i,
  logoUrl: null,
  epgChannelId: `ch${i}`,
  streamUrl: `http://ex.com/live/u/p/${i}.m3u8`,
  containerExtension: 'm3u8',
  isAdult: false
}))

const started = Date.now()
const counts = importCatalog(playlist.id, 'live', categories, channels)
const elapsed = Date.now() - started
check('imported 5000 channels', counts.channels === 5000)
check(`import is fast (${elapsed}ms)`, elapsed < 3000, `${elapsed}ms`)
check('categories created', catalog.listCategories(playlist.id, 'live').length === 2)

const sports = catalog.listCategories(playlist.id, 'live').find((c) => c.name === 'Sports')!
check('category counts channels', sports.channelCount === 2500, sports.channelCount)

console.log('\nQueries')
const all = catalog.queryChannels({ playlistId: playlist.id, limit: 10 })
check('query returns a page', all.length === 10)
check('sorted A-Z by folded name', all[0]!.name.startsWith('Civic'), all[0]!.name)

const search = catalog.queryChannels({ playlistId: playlist.id, search: 'harbour sports', limit: 5000 })
check('multi-token search matches', search.length === 2500, search.length)

const numbered = catalog.queryChannels({ playlistId: playlist.id, sort: 'number', limit: 3 })
check('numeric sort works', numbered[0]!.number === 0 && numbered[1]!.number === 1)

check('count matches filter', catalog.countChannels({ playlistId: playlist.id, search: 'civic' }) === 2500)

console.log('\nFavorites, history, hiding')
const target = all[0]!
check('toggle favorite on', catalog.toggleFavorite(target.id) === true)
check('favorites filter finds it', catalog.queryChannels({ playlistId: playlist.id, favoritesOnly: true }).length === 1)
check('toggle favorite off', catalog.toggleFavorite(target.id) === false)

catalog.markWatched(target.id)
catalog.markWatched(target.id)
check('recent list populated', catalog.recentChannels(5)[0]?.id === target.id)

catalog.setHidden(target.id, true)
check('hidden excluded by default', catalog.countChannels({ playlistId: playlist.id }) === 4999)
check('hidden included on request', catalog.countChannels({ playlistId: playlist.id, includeHidden: true }) === 5000)
catalog.setHidden(target.id, false)

console.log('\nRe-sync keeps ids, prunes stale rows')
catalog.toggleFavorite(target.id)
const before = target.id
const shrunk = channels.slice(0, 4000)
const second = importCatalog(playlist.id, 'live', categories, shrunk)
check('removed 1000 stale channels', second.removed === 1000, second.removed)
check('surviving channel kept its id', catalog.getChannel(before)?.externalId === target.externalId)
check('favorite survived re-sync', catalog.getChannel(before)?.favorite === true)

console.log('\nEPG join')
const db = getDb()
const now = Date.now()
db.prepare(
  'INSERT INTO epg_programs (playlist_id, epg_channel_id, title, description, category, starts_at, ends_at) VALUES (?,?,?,?,?,?,?)'
).run(playlist.id, target.epgChannelId, 'Live Match', null, 'Sports', now - 600_000, now + 600_000)
db.prepare(
  'INSERT INTO epg_programs (playlist_id, epg_channel_id, title, description, category, starts_at, ends_at) VALUES (?,?,?,?,?,?,?)'
).run(playlist.id, target.epgChannelId, 'Post Match', null, 'Sports', now + 600_000, now + 1_200_000)

const withEpg = catalog.getChannel(before)!
check('now programme attached', withEpg.now?.title === 'Live Match', withEpg.now)
check('next programme attached', withEpg.next?.title === 'Post Match', withEpg.next)

console.log('\nSettings')
check('defaults returned', getSettings().theme === 'dark')
setSettings({ theme: 'light', volume: 0.5 })
check('patch persisted', getSettings().theme === 'light' && getSettings().volume === 0.5)
// Compared against the shipped default rather than a literal, so changing the
// brand colour is not a test failure.
check('untouched keys keep defaults', getSettings().accentColor === DEFAULT_SETTINGS.accentColor)

markSynced(playlist.id)
check('lastSyncedAt set', listPlaylists()[0]!.lastSyncedAt !== null)

console.log('\nContent kinds are isolated (regression: movie import wiped live channels)')
const kindPlaylist = createPlaylist({ name: 'Kinds', kind: 'xtream', url: 'http://ex.com', username: 'u' })

const liveCats = [{ externalId: 'l1', name: 'Live Sports' }]
const liveChans = mk(300, 'live', 'l1', (i) => `Live Channel ${i}`)
importCatalog(kindPlaylist.id, 'live', liveCats, liveChans)

const movieCats = [{ externalId: 'm1', name: 'Action' }]
const movieChans = mk(120, 'vod', 'm1', (i) => `Movie ${i}`)
importCatalog(kindPlaylist.id, 'movie', movieCats, movieChans)

const seriesCats = [{ externalId: 's1', name: 'Drama' }]
const seriesChans = mk(40, 'series', 's1', (i) => `Show ${i}`)
importCatalog(kindPlaylist.id, 'series', seriesCats, seriesChans)

check(
  'live channels survive the movie and series imports',
  catalog.countChannels({ playlistId: kindPlaylist.id, kind: 'live' }) === 300,
  catalog.countChannels({ playlistId: kindPlaylist.id, kind: 'live' })
)
check('movies survive the series import', catalog.countChannels({ playlistId: kindPlaylist.id, kind: 'movie' }) === 120)
check('series stored', catalog.countChannels({ playlistId: kindPlaylist.id, kind: 'series' }) === 40)
check(
  'default query returns live only, never movies',
  catalog.queryChannels({ playlistId: kindPlaylist.id, limit: 500 }).every((c) => c.kind === 'live')
)
check(
  'live categories report a non-zero channel count',
  (catalog.listCategories(kindPlaylist.id, 'live')[0]?.channelCount ?? 0) === 300,
  catalog.listCategories(kindPlaylist.id, 'live')[0]?.channelCount
)
check(
  'movie category count is separate',
  (catalog.listCategories(kindPlaylist.id, 'movie')[0]?.channelCount ?? 0) === 120
)
check(
  'a live re-sync does not touch movies',
  (() => {
    importCatalog(kindPlaylist.id, 'live', liveCats, liveChans.slice(0, 250))
    return (
      catalog.countChannels({ playlistId: kindPlaylist.id, kind: 'live' }) === 250 &&
      catalog.countChannels({ playlistId: kindPlaylist.id, kind: 'movie' }) === 120
    )
  })()
)
check(
  'recent channels never include VOD items',
  (() => {
    const movie = catalog.queryChannels({ playlistId: kindPlaylist.id, kind: 'movie', limit: 1 })[0]!
    catalog.markWatched(movie.id)
    return catalog.recentChannels(20).every((c) => c.kind === 'live')
  })()
)

console.log('\nSeries episodes and playback progress')
const show = catalog.queryChannels({ playlistId: kindPlaylist.id, kind: 'series', limit: 1 })[0]!
vod.saveEpisodes(show.id, [
  ep('e3', 2, 1, 'Season two opener'),
  ep('e1', 1, 1, 'Pilot'),
  ep('e2', 1, 2, 'Second'),
  ep('e10', 1, 10, 'Finale')
])

const seasons = vod.listSeasons(show.id)
check('groups into seasons', seasons.length === 2, seasons.length)
check('season 1 has 3 episodes', seasons[0]!.episodes.length === 3)
check(
  'episodes sort numerically, not lexically',
  seasons[0]!.episodes.map((e) => e.episode).join(',') === '1,2,10',
  seasons[0]!.episodes.map((e) => e.episode).join(',')
)

const pilot = seasons[0]!.episodes[0]!
check('next episode within a season', vod.nextEpisode(pilot.id)?.episode === 2)
const finale = seasons[0]!.episodes[2]!
check('next episode crosses the season boundary', vod.nextEpisode(finale.id)?.season === 2)
const lastEpisode = seasons[1]!.episodes[0]!
check('no next episode at the end', vod.nextEpisode(lastEpisode.id) === null)

check('re-saving episodes does not duplicate', (() => {
  vod.saveEpisodes(show.id, [ep('e1', 1, 1, 'Pilot (remastered)')])
  return vod.listEpisodes(show.id).length === 4
})())
check('re-saving updates the title', vod.getEpisode(pilot.id)?.title === 'Pilot (remastered)')

vod.saveProgress({ itemType: 'episode', itemId: pilot.id, channelId: show.id, positionSecs: 600, durationSecs: 2400 })
check('resume position returned', vod.getResumePosition('episode', pilot.id) === 600)

vod.saveProgress({ itemType: 'episode', itemId: pilot.id, channelId: show.id, positionSecs: 5, durationSecs: 2400 })
check('trivial position does not trigger a resume prompt', vod.getResumePosition('episode', pilot.id) === 0)

vod.saveProgress({ itemType: 'episode', itemId: pilot.id, channelId: show.id, positionSecs: 2350, durationSecs: 2400 })
check('near-end counts as completed', vod.getResumePosition('episode', pilot.id) === 0)
check('completed items leave continue watching', vod.continueWatching(10).every((i) => i.itemId !== pilot.id))

const secondEp = seasons[0]!.episodes[1]!
vod.saveProgress({ itemType: 'episode', itemId: secondEp.id, channelId: show.id, positionSecs: 300, durationSecs: 2400 })
const cw = vod.continueWatching(10)
check('in-progress item appears in continue watching', cw.some((i) => i.itemId === secondEp.id))
check(
  'episode title is formatted with the series name',
  cw.find((i) => i.itemId === secondEp.id)?.title.includes('S01E02') === true,
  cw.find((i) => i.itemId === secondEp.id)?.title
)
check('progress marks the episode watched in listings', vod.listEpisodes(show.id).find((e) => e.id === pilot.id)?.completed === true)

console.log('\nRecordings')
const liveChannel = catalog.queryChannels({ playlistId: kindPlaylist.id, kind: 'live', limit: 1 })[0]!
const base = Date.now()

const scheduled = recordings.createRecording({
  channelId: liveChannel.id,
  playlistId: kindPlaylist.id,
  title: 'The Match',
  channelName: liveChannel.name,
  startsAt: base + 60_000,
  endsAt: base + 3_600_000,
  status: 'scheduled'
})
check('scheduled recording stored', scheduled.status === 'scheduled')

check('not due before its start time', recordings.dueRecordings(base).length === 0)
check('due once the start time passes', recordings.dueRecordings(base + 120_000).length === 1)
check('not due after its window closes', recordings.dueRecordings(base + 4_000_000).length === 0)
check(
  'a window that fully elapsed counts as missed',
  recordings.missedRecordings(base + 4_000_000).some((r) => r.id === scheduled.id)
)

check(
  'an overlapping recording is detected',
  recordings.clashesWith(liveChannel.id, base + 600_000, base + 1_200_000)?.id === scheduled.id
)
check('a non-overlapping window is fine', recordings.clashesWith(liveChannel.id, base + 4_000_000, base + 5_000_000) === null)
check(
  'a different channel does not clash',
  recordings.clashesWith(
    catalog.queryChannels({ playlistId: kindPlaylist.id, kind: 'live', limit: 2 })[1]!.id,
    base + 600_000,
    base + 1_200_000
  ) === null
)

recordings.updateRecording(scheduled.id, { status: 'recording', filePath: '/tmp/x.ts', startedAt: base })
check('status transitions persist', recordings.getRecording(scheduled.id)?.status === 'recording')
check('partial update leaves other columns alone', recordings.getRecording(scheduled.id)?.title === 'The Match')

const orphaned = recordings.reconcileOnStartup()
check('a crash leaves no recording stuck in progress', orphaned === 1, orphaned)
check('the orphan is marked failed with a reason', (() => {
  const row = recordings.getRecording(scheduled.id)
  return row?.status === 'failed' && (row.error ?? '').includes('closed while recording')
})())

const completed = recordings.createRecording({
  channelId: liveChannel.id,
  playlistId: kindPlaylist.id,
  title: 'Finished',
  channelName: liveChannel.name,
  startsAt: base - 7_200_000,
  endsAt: base - 3_600_000,
  status: 'completed'
})
recordings.updateRecording(completed.id, { bytes: 5_000_000 })
check('completed recordings keep their size', recordings.getRecording(completed.id)?.bytes === 5_000_000)
check(
  'active recordings sort above finished ones',
  (() => {
    recordings.updateRecording(scheduled.id, { status: 'recording' })
    return recordings.listRecordings()[0]?.id === scheduled.id
  })()
)

recordings.removeRecording(completed.id)
check('removal works', recordings.getRecording(completed.id) === null)

console.log('\nEPG reminders')

const anyChannel = catalog.queryChannels({ playlistId: playlist.id, limit: 1 })[0]!
const soon = Date.now() + 20 * 60_000

const set = reminders.addReminder({
  channelId: anyChannel.id,
  title: 'The Nine O\'Clock News',
  startsAt: soon,
  endsAt: soon + 30 * 60_000,
  leadMinutes: 5
})
check('a reminder is stored with its channel name', set.channelName === anyChannel.name, set)
check('the lead time is kept', set.leadMinutes === 5)
check('a new reminder has not fired', set.notifiedAt === null)

// Asking again is a change of mind about the lead time, not a second alert.
const again = reminders.addReminder({
  channelId: anyChannel.id,
  title: 'The Nine O\'Clock News',
  startsAt: soon,
  endsAt: soon + 30 * 60_000,
  leadMinutes: 15
})
check('asking twice does not duplicate', reminders.listReminders().length === 1, reminders.listReminders())
check('asking twice updates the lead time', again.leadMinutes === 15)
check('the same row is reused', again.id === set.id)

check(
  'a reminder can be found from the guide',
  reminders.findReminder(anyChannel.id, 'The Nine O\'Clock News', soon)?.id === set.id
)
check('a programme with no reminder returns null', reminders.findReminder(anyChannel.id, 'Something else', soon) === null)

// 20 minutes away with a 15-minute lead: not yet.
check('a reminder does not fire early', reminders.dueReminders(Date.now()).length === 0)
// Six minutes later it is inside the lead time.
check('a reminder fires inside its lead time', reminders.dueReminders(Date.now() + 6 * 60_000).length === 1)

reminders.markNotified(set.id)
check('a fired reminder does not fire again', reminders.dueReminders(Date.now() + 6 * 60_000).length === 0)
check('the list shows it as notified', reminders.listReminders()[0]?.notifiedAt !== null)

// The guide is emptied and rebuilt on every refresh; reminders must not be
// collateral damage.
epgSurvivalCheck()
function epgSurvivalCheck(): void {
  getDb().prepare('DELETE FROM epg_programs').run()
  check('reminders survive a guide refresh', reminders.listReminders().length === 1)
}

const stale = reminders.addReminder({
  channelId: anyChannel.id,
  title: 'Last week',
  startsAt: Date.now() - 3 * 3600_000,
  endsAt: Date.now() - 2 * 3600_000
})
check('a finished programme is not listed', !reminders.listReminders().some((r) => r.id === stale.id))
check('a finished programme never fires', !reminders.dueReminders(Date.now()).some((r) => r.id === stale.id))
check('pruning clears it', reminders.pruneReminders() >= 1)

reminders.removeReminder(set.id)
check('a reminder can be cancelled', reminders.listReminders().length === 0)

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`)
process.exit(failures === 0 ? 0 : 1)

function mk(
  count: number,
  prefix: string,
  categoryExternalId: string,
  name: (i: number) => string
): Parameters<typeof importCatalog>[3] {
  return Array.from({ length: count }, (_, i) => ({
    externalId: `${prefix}:${i}`,
    name: name(i),
    categoryExternalId,
    number: i,
    logoUrl: null,
    epgChannelId: `${prefix}${i}`,
    streamUrl: `http://ex.com/${prefix}/${i}.m3u8`,
    containerExtension: 'm3u8',
    isAdult: false
  }))
}

function ep(externalId: string, season: number, episode: number, title: string) {
  return {
    externalId,
    season,
    episode,
    title,
    plot: null,
    durationSecs: 2400,
    containerExtension: 'mp4',
    stillUrl: null
  }
}
