/**
 * A stand-in bridge for the film browser's filters.
 *
 * `test/vodfilters.test.ts` settles the query. This settles the controls, and
 * in particular the thing a unit test cannot see: that a source carrying no
 * ratings offers no rating filter. Offering one there is offering a control
 * whose only possible effect is to empty the screen.
 *
 * `seed.metadata` decides whether the catalogue has ratings and years, so the
 * same page can be opened as an Xtream panel and as an M3U playlist.
 */
const { contextBridge } = require('electron')

const BASE_SETTINGS = {
  language: 'en', theme: 'dark', accentColor: '#46b096', uiScale: 1,
  volume: 1, muted: false, singleConnection: false, sourceFailover: 'ask',
  autoCheckUpdates: false, lastUpdateCheck: null, knownUpdateVersion: null,
  knownUpdateUrl: null, dismissedUpdate: null,
  autoRefreshHours: 0, autoRefreshEpg: true, lastAutoRefresh: null,
  hardwareAcceleration: true, showStreamStats: false, resumeLastChannel: true,
  preferredAudioLanguages: [], preferredSubtitleLanguages: [],
  recordingsPath: null, recordingTemplate: '{channel} - {title} ({date} {time})', downloadsPath: null, ffmpegPath: null,
  maxConcurrentDownloads: 1, videoFit: 'fit', videoZoom: 1,
  sidebarCollapsed: false, multiViewColumns: 2, multiViewRows: 2,
  multiViewChannels: [], subtitleSize: 1, subtitleColor: '#ffffff',
  subtitleBackground: '#000000', subtitleBackgroundOpacity: 0.6,
  subtitleEdge: 'none', subtitleFont: 'system'
}

function seed() {
  try {
    const raw = new URLSearchParams(location.search).get('seed')
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

const options = seed()
const withMetadata = options.metadata !== false
let settings = { ...BASE_SETTINGS }

const playlist = {
  id: 1, name: 'Films', kind: withMetadata ? 'xtream' : 'm3u', url: 'http://x',
  filePath: null, username: null, macAddress: null, epgUrl: null,
  epgOffsetMinutes: 0, userAgent: null, referrer: null, enabled: true,
  sortOrder: 1, lastSyncedAt: Date.now(), createdAt: Date.now(), serverTimezone: null
}

const film = (id, name, rating, year, added) => ({
  id, playlistId: 1, categoryId: null, kind: 'movie', externalId: `vod:${id}`,
  name, number: null, logoUrl: null, epgChannelId: null,
  streamUrl: `http://x/${id}.mp4`, containerExtension: 'mp4', isAdult: false,
  rating: withMetadata ? rating : null,
  year: withMetadata ? year : null,
  hidden: false, addedAt: 0, catchupDays: 0, favorite: false,
  lastWatchedAt: null, now: null, next: null, health: null, sources: 1
})

const FILMS = [
  film(1, 'Alpha', 8.5, 2021, 3000),
  film(2, 'Bravo', 6.0, 1998, 5000),
  film(3, 'Charlie', 9.1, 2015, 1000),
  film(4, 'Delta', null, null, null),
  film(5, 'Echo', 7.0, 2021, 4000)
]

const queries = []

function applyQuery(q) {
  let rows = FILMS.filter((f) => f.kind === (q.kind ?? 'live'))
  if (q.minRating != null) rows = rows.filter((f) => f.rating != null && f.rating >= q.minRating)
  if (q.yearFrom != null) rows = rows.filter((f) => f.year != null && f.year >= q.yearFrom)
  if (q.yearTo != null) rows = rows.filter((f) => f.year != null && f.year <= q.yearTo)
  return rows
}

const answers = {
  'settings:get': () => ({ ...settings }),
  'settings:set': (patch) => {
    settings = { ...settings, ...patch }
    return { ...settings }
  },
  'playlists:list': () => [playlist],
  'categories:list': () => [],
  'channels:recent': () => [],
  'progress:continueWatching': () => [],
  'channels:query': (q) => {
    queries.push(q)
    return applyQuery(q)
  },
  'channels:count': (q) => applyQuery(q).length,
  'media:capabilities': () => ({
    ffmpeg: true, ffmpegSource: 'bundled', ffprobe: true, recordingsPath: null
  }),
  'app:version': () => '0.9.0-test'
}

contextBridge.exposeInMainWorld('__probe', {
  queries: () => queries.slice(),
  lastQuery: () => queries[queries.length - 1] ?? null
})

contextBridge.exposeInMainWorld('api', {
  invoke: (name, payload) => {
    if (!answers[name]) {
      console.error(`[vodfilters-preload] no answer scripted for "${name}"`)
      return Promise.resolve(null)
    }
    return Promise.resolve(answers[name](payload))
  },
  on: () => () => undefined,
  platform: 'win32'
})
