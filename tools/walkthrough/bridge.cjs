/**
 * A stand-in bridge rich enough to walk the whole application through.
 *
 * Not a test fixture: a review aid. Every screen is given enough plausible
 * data to be worth looking at — a catalogue, a guide, recordings, downloads,
 * history — so that screenshots of it show what someone would actually see
 * rather than a column of empty states.
 *
 * Anything not scripted answers null and logs, because a screen that breaks
 * on a missing answer is itself worth knowing about.
 */
const { contextBridge } = require('electron')

const now = Date.now()
const HOUR = 3600_000

const BASE_SETTINGS = {
  language: 'en', theme: 'dark', accentColor: '#22b58f', uiScale: 1,
  volume: 0.8, muted: false, singleConnection: true, sourceFailover: 'ask',
  autoCheckUpdates: true, lastUpdateCheck: now - HOUR, knownUpdateVersion: null,
  knownUpdateUrl: null, dismissedUpdate: null,
  autoRefreshHours: 12, autoRefreshEpg: true,
  /* An object, not a timestamp: a report of what the last refresh did. */
  lastAutoRefresh: { at: now - 6 * HOUR, sources: [
    { playlistId: 1, name: 'Main panel', added: 12, removed: 3, error: null },
    { playlistId: 2, name: 'Backup list', added: 0, removed: 0, error: 'The provider did not answer' }
  ] },
  hardwareAcceleration: true, tvNavigation: false, showStreamStats: false,
  resumeLastChannel: true, preferredAudioLanguages: ['eng'], preferredSubtitleLanguages: [],
  recordingsPath: 'C:\\Users\\Example\\Videos\\LiberCast', recordingTemplate: '{channel} - {title} ({date} {time})',
  downloadsPath: 'C:\\Users\\Example\\Downloads', ffmpegPath: null,
  maxConcurrentDownloads: 1, videoFit: 'fit', videoZoom: 1,
  sidebarCollapsed: false, liveListsCollapsed: false,
  liveCategoryWidth: 210, liveChannelWidth: 320,
  multiViewColumns: 2, multiViewRows: 2, multiViewChannels: [null, null, null, null],
  subtitleSize: 1, subtitleScale: 1, subtitleColor: '#ffffff', subtitleBackground: '#000000',
  subtitleBackgroundOpacity: 0.6, subtitleEdge: 'shadow', subtitleFont: 'system'
}
let settings = { ...BASE_SETTINGS }

const playlists = [
  { id: 1, name: 'Main panel', kind: 'xtream', url: 'http://panel.invalid', filePath: null, username: 'example', macAddress: null, epgUrl: null, epgOffsetMinutes: 0, userAgent: null, referrer: null, enabled: true, sortOrder: 1, lastSyncedAt: now - 3 * HOUR, createdAt: now - 90 * 24 * HOUR, serverTimezone: 'Europe/Istanbul' },
  { id: 2, name: 'Backup list', kind: 'm3u', url: 'http://list.invalid/pl.m3u', filePath: null, username: null, macAddress: null, epgUrl: null, epgOffsetMinutes: 0, userAgent: null, referrer: null, enabled: true, sortOrder: 2, lastSyncedAt: now - 26 * HOUR, createdAt: now - 40 * 24 * HOUR, serverTimezone: null },
  { id: 3, name: 'Set-top portal', kind: 'stalker', url: 'http://portal.invalid/c/', filePath: null, username: null, macAddress: '00:1A:79:12:34:56', epgUrl: null, epgOffsetMinutes: 0, userAgent: null, referrer: null, enabled: true, sortOrder: 3, lastSyncedAt: now - 20 * 60_000, createdAt: now - 10 * 24 * HOUR, serverTimezone: null }
]

const CATS = [
  { id: 1, name: 'News and current affairs', channelCount: 34, kind: 'live' },
  { id: 2, name: 'Sport', channelCount: 128, kind: 'live' },
  { id: 3, name: 'Films and series, dubbed', channelCount: 61, kind: 'live' },
  { id: 4, name: 'Children', channelCount: 22, kind: 'live' },
  { id: 5, name: 'Music', channelCount: 40, kind: 'live' }
]

const liveChannel = (id, name, categoryId, extra = {}) => ({
  id, playlistId: 1, categoryId, name, number: 100 + id,
  logoUrl: null, streamUrl: `http://panel.invalid/live/${id}.ts`, kind: 'live',
  epgChannelId: `ch${id}.tv`, favorite: id % 5 === 0, hidden: false,
  rating: null, year: null, plot: null, addedAt: null, containerExtension: 'ts',
  catchupDays: id % 3 === 0 ? 7 : 0, sourceCount: id % 4 === 0 ? 2 : 1, ...extra
})

const LIVE = [
  liveChannel(1, 'Vale News HD', 1),
  liveChannel(2, 'Vale News 24', 1),
  liveChannel(3, 'Crest Sport 1 FHD', 2),
  liveChannel(4, 'Crest Sport 2 FHD', 2),
  liveChannel(5, 'Harbour Cinema', 3),
  liveChannel(6, 'Harbour Cinema Action', 3),
  liveChannel(7, 'Lumen Kids', 4),
  liveChannel(8, 'Orion Music Box', 5),
  liveChannel(9, 'Vale Documentary', 1),
  liveChannel(10, 'Civic One', 1)
]

const film = (id, name, rating, year) => ({
  id, playlistId: 1, categoryId: 10, name, number: null, logoUrl: null,
  streamUrl: `http://panel.invalid/movie/${id}.mp4`, kind: 'movie', epgChannelId: null,
  favorite: false, hidden: false, rating, year,
  plot: 'A short description of the film, as the provider sent it.',
  addedAt: now - id * 86400_000, containerExtension: 'mp4', sourceCount: 1
})
const FILMS = [
  film(101, 'The Quiet Harbour', 7.8, 2021),
  film(102, 'Crest of the Wave', 6.2, 2019),
  film(103, 'Lumen', 8.4, 2024),
  film(104, 'Orion Rising', null, null),
  film(105, 'Vale of Shadows', 5.9, 2015),
  film(106, 'Orion Dawn', 7.1, 2022)
]
const SERIES = [
  { ...film(201, 'The Long Watch', 8.1, 2023), kind: 'series' },
  { ...film(202, 'Harbour Lights', 7.4, 2020), kind: 'series' }
]

const programmes = (channelId) =>
  Array.from({ length: 8 }, (_, i) => ({
    id: channelId * 100 + i,
    channelId,
    epgChannelId: `ch${channelId}.tv`,
    title: ['The News at Six', 'Afternoon Film', 'Match of the Day', 'Documentary Hour'][i % 4],
    description: 'What the guide says about this programme.',
    category: 'General',
    startsAt: now - 2 * HOUR + i * HOUR,
    endsAt: now - HOUR + i * HOUR
  }))

const recordings = [
  { id: 1, channelId: 3, channelName: 'Crest Sport 1 FHD', title: 'Match of the Day', filePath: 'C:\\Users\\Example\\Videos\\LiberCast\\Crest Sport 1 - Match of the Day.mp4', status: 'completed', startsAt: now - 30 * HOUR, endsAt: now - 28 * HOUR, bytes: 2_400_000_000, error: null },
  { id: 2, channelId: 1, channelName: 'Vale News HD', title: 'The News at Six', filePath: 'C:\\Users\\Example\\Videos\\LiberCast\\Vale News - The News at Six.mp4', status: 'recording', startsAt: now - 20 * 60_000, endsAt: now + 40 * 60_000, bytes: 180_000_000, error: null },
  { id: 3, channelId: 5, channelName: 'Harbour Cinema', title: 'Afternoon Film', filePath: null, status: 'scheduled', startsAt: now + 4 * HOUR, endsAt: now + 6 * HOUR, bytes: 0, error: null },
  { id: 4, channelId: 9, channelName: 'Vale Documentary', title: 'Documentary Hour', filePath: null, status: 'failed', startsAt: now - 50 * HOUR, endsAt: now - 49 * HOUR, bytes: 0, error: 'The file did not open afterwards' }
]

const downloads = [
  { id: 1, channelId: 103, name: 'Lumen', state: 'downloading', bytes: 820_000_000, totalBytes: 2_100_000_000, filePath: 'C:\\Users\\Example\\Downloads\\Lumen.mp4', error: null, addedAt: now - HOUR },
  { id: 2, channelId: 101, name: 'The Quiet Harbour', status: 'completed', bytes: 1_600_000_000, totalBytes: 1_600_000_000, filePath: 'C:\\Users\\Example\\Downloads\\The Quiet Harbour.mp4', error: null, addedAt: now - 20 * HOUR },
  { id: 3, channelId: 105, name: 'Vale of Shadows', state: 'paused', bytes: 240_000_000, totalBytes: 1_900_000_000, filePath: null, error: null, addedAt: now - 2 * HOUR }
]

const answers = {
  'settings:get': () => ({ ...settings }),
  'settings:set': (patch) => { settings = { ...settings, ...patch }; return { ...settings } },
  'playlists:list': () => playlists,
  'playlists:account': () => ({ status: 'Active', expiresAt: now + 60 * 24 * HOUR, maxConnections: 1, activeConnections: 1 }),
  'folders:list': () => [],
  'categories:list': (q) => (q && q.kind === 'live' ? CATS : []),
  'channels:query': (q) => {
    const kind = (q && q.kind) || 'live'
    const rows = kind === 'live' ? LIVE : kind === 'movie' ? FILMS : SERIES
    if (q && q.favoritesOnly) return rows.filter((r) => r.favorite)
    if (q && q.search) return rows.filter((r) => r.name.toLowerCase().includes(String(q.search).toLowerCase()))
    return rows
  },
  'channels:count': (q) => answers['channels:query'](q).length,
  'channels:get': (id) => [...LIVE, ...FILMS, ...SERIES].find((c) => c.id === id) ?? null,
  'channels:recent': () => LIVE.slice(0, 4),
  'channels:toggleFavorite': () => true,
  'channels:setHidden': () => undefined,
  'channels:markWatched': () => undefined,
  'progress:continueWatching': () => [
    { ...FILMS[0], positionSecs: 1820, durationSecs: 6900 },
    { ...SERIES[0], positionSecs: 600, durationSecs: 2700 }
  ],
  'progress:get': () => null,
  'progress:resume': () => null,
  'epg:state': () => ({ lastRefreshedAt: now - 5 * HOUR, programmeCount: 48_210, channelCount: 310, matchedCount: 268, refreshing: false }),
  'epg:guideChannels': () => LIVE.map((c) => ({ id: c.id, name: c.name, epgChannelId: c.epgChannelId, logoUrl: null })),
  'epg:guide': () => LIVE.flatMap((c) => programmes(c.id)),
  'epg:channelProgrammes': (p) => programmes((p && p.channelId) || 1),
  'epg:matchRows': () => LIVE.slice(0, 5).map((c) => ({ channelId: c.id, channelName: c.name, epgChannelId: c.epgChannelId, matchedName: c.name, score: 1, overridden: false })),
  'epg:suggestions': () => [],
  'recordings:list': () => recordings,
  'downloads:list': () => downloads,
  'downloads:forItem': (id) => downloads.find((d) => d.channelId === id) ?? null,
  'reminders:list': () => [{ id: 1, channelId: 3, channelName: 'Crest Sport 1 FHD', title: 'Match of the Day', startsAt: now + 3 * HOUR }],
  'reminders:find': () => null,
  'media:capabilities': () => ({ ffmpeg: true, ffmpegSource: 'bundled', ffprobe: true, recordingsPath: settings.recordingsPath }),
  'app:version': () => '0.9.0-beta.8',
  'app:credentialStorage': () => ({ available: true, backend: 'DPAPI' }),
  'app:checkUpdate': () => ({ version: null, url: null }),
  'app:diagnostics': () => ({ report: 'Diagnostics would appear here.' }),
  'parental:status': () => ({ enabled: true, unlocked: true, lockedCategoryIds: [4], keywords: ['poker'], lockAdult: true, autoLockMinutes: 30 }),
  'subtitles:searchStatus': () => ({ hasKey: false, hasAccount: false, remaining: null }),
  'tmdb:status': () => ({ hasKey: false }),
  'vod:movieInfo': () => ({ plot: 'A longer plot, fetched when the sheet opens.', cast: 'A Name, Another Name', director: 'A Director', genre: 'Drama', runtimeSecs: 6900 }),
  'vod:seriesDetail': () => ({ seasons: [1, 2], episodes: [
    { id: 9001, seriesId: 201, season: 1, episode: 1, title: 'First Light', plot: 'The opening episode.', durationSecs: 2700, streamUrl: 'http://panel.invalid/series/9001.mp4', containerExtension: 'mp4' },
    { id: 9002, seriesId: 201, season: 1, episode: 2, title: 'Second Watch', plot: 'And the next.', durationSecs: 2700, streamUrl: 'http://panel.invalid/series/9002.mp4', containerExtension: 'mp4' }
  ] }),
  'multiview:detached': () => [],
  'search:global': (q) => ({ live: LIVE.slice(0, 2), movie: FILMS.slice(0, 2), series: SERIES.slice(0, 1), query: q })
}

const missing = []
contextBridge.exposeInMainWorld('__walk', { missing: () => missing.slice() })
contextBridge.exposeInMainWorld('api', {
  invoke: (name, payload) => {
    if (!answers[name]) {
      if (!missing.includes(name)) missing.push(name)
      return Promise.resolve(null)
    }
    return Promise.resolve(answers[name](payload))
  },
  on: () => () => undefined,
  platform: 'win32'
})
