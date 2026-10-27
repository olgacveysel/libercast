/**
 * A stand-in bridge serving two providers with overlapping catalogues, so the
 * merged list can be rendered without a main process behind it.
 *
 * The channel rows are shaped exactly as `queryChannels` returns them,
 * including the `sources` count the merge adds — the question here is whether
 * the interface does the right thing with that number, not whether the SQL
 * produces it. `test/merged.test.ts` covers the SQL.
 */
const { contextBridge } = require('electron')

let settings = {
  language: 'en', theme: 'dark', accentColor: '#46b096', uiScale: 1,
  volume: 1, muted: false, singleConnection: false, sourceFailover: true,
  autoRefreshHours: 0, autoRefreshEpg: true, lastAutoRefresh: null,
  hardwareAcceleration: true, showStreamStats: false, resumeLastChannel: true,
  preferredAudioLanguages: [], preferredSubtitleLanguages: [],
  recordingsPath: null, downloadsPath: null, ffmpegPath: null,
  maxConcurrentDownloads: 1, videoFit: 'fit', videoZoom: 1,
  sidebarCollapsed: false, multiViewColumns: 2, multiViewRows: 2,
  multiViewChannels: [], subtitleSize: 1, subtitleColor: '#ffffff',
  subtitleBackground: '#000000', subtitleBackgroundOpacity: 0.6,
  subtitleEdge: 'none', subtitleFont: 'system'
}

const playlist = (id, name) => ({
  id, name, kind: 'm3u', url: 'http://x', filePath: null, username: null,
  macAddress: null, epgUrl: null, epgOffsetMinutes: 0, userAgent: null,
  referrer: null, enabled: true, sortOrder: id, lastSyncedAt: Date.now(),
  createdAt: Date.now(), serverTimezone: null
})

const channel = (id, playlistId, name, sources) => ({
  id, playlistId, categoryId: null, kind: 'live', externalId: String(id), name,
  number: null, logoUrl: null, epgChannelId: null, streamUrl: 'http://x/s.ts',
  containerExtension: 'ts', isAdult: false, hidden: false, addedAt: 0,
  catchupDays: 0, favorite: false, lastWatchedAt: null, now: null, next: null,
  health: null, sources
})

// What the merged query returns for two providers: beIN 2 on both, the rest
// on one each.
const MERGED = [
  channel(1, 1, 'beIN Sports 2 HD', 2),
  channel(2, 1, 'beIN Sports 4 HD', 1),
  channel(3, 2, 'Only On Backup', 1)
]
// What a single-source query returns for provider one.
const SINGLE = [
  channel(1, 1, 'beIN Sports 2 HD', 1),
  channel(2, 1, 'beIN Sports 4 HD', 1)
]

const answers = {
  'settings:get': () => ({ ...settings }),
  'settings:set': (patch) => {
    settings = { ...settings, ...patch }
    return { ...settings }
  },
  'playlists:list': () => [playlist(1, 'Main'), playlist(2, 'Backup')],
  'media:capabilities': () => ({ ffmpeg: true, ffmpegSource: 'bundled', ffprobe: true, recordingsPath: null }),
  'categories:list': () => [{ id: 9, playlistId: 1, externalId: 'c', name: 'Sports', kind: 'live', channelCount: 2 }],
  'channels:query': (q) => (q.merge ? MERGED : SINGLE),
  'channels:count': (q) => (q.merge ? MERGED.length : SINGLE.length),
  'channels:recent': () => [],
  'app:version': () => '0.9.0-test'
}

contextBridge.exposeInMainWorld('api', {
  invoke: (channelName, payload) =>
    Promise.resolve(answers[channelName] ? answers[channelName](payload) : null),
  on: () => () => undefined,
  platform: 'win32'
})
