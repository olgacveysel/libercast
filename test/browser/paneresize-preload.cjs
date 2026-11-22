/**
 * A stand-in bridge for the Live TV screen, with both lists populated.
 *
 * The pane widths are what is under test, so this records every settings
 * patch the renderer sends: a drag that moves the column but never writes is
 * a drag that is forgotten on restart, and from the outside the two look
 * identical until the application is reopened.
 */
const { contextBridge } = require('electron')

const BASE_SETTINGS = {
  language: 'en', theme: 'dark', accentColor: '#46b096', uiScale: 1,
  volume: 1, muted: false, singleConnection: false, sourceFailover: 'ask',
  autoCheckUpdates: false, lastUpdateCheck: null, knownUpdateVersion: null,
  knownUpdateUrl: null, dismissedUpdate: null,
  autoRefreshHours: 0, autoRefreshEpg: true, lastAutoRefresh: null,
  hardwareAcceleration: true, tvNavigation: false, showStreamStats: false, resumeLastChannel: false,
  preferredAudioLanguages: [], preferredSubtitleLanguages: [],
  recordingsPath: null, recordingTemplate: '{channel} - {title}', downloadsPath: null, ffmpegPath: null,
  maxConcurrentDownloads: 1, videoFit: 'fit', videoZoom: 1,
  sidebarCollapsed: false, liveListsCollapsed: false,
  liveCategoryWidth: 210, liveChannelWidth: 320,
  multiViewColumns: 2, multiViewRows: 2, multiViewChannels: [],
  subtitleSize: 1, subtitleColor: '#ffffff', subtitleBackground: '#000000',
  subtitleBackgroundOpacity: 0.6, subtitleEdge: 'none', subtitleFont: 'system'
}

let settings = { ...BASE_SETTINGS }
const patches = []

const playlist = {
  id: 1, name: 'Portal', kind: 'm3u', url: 'http://x',
  filePath: null, username: null, macAddress: null, epgUrl: null,
  epgOffsetMinutes: 0, userAgent: null, referrer: null, enabled: true,
  sortOrder: 1, lastSyncedAt: Date.now(), createdAt: Date.now(), serverTimezone: null
}

/* Long names on purpose: the request this feature answers was that the lists
   truncate, which only shows up with names wider than the pane. */
const CATEGORIES = [
  { id: 1, name: 'Regional news and current affairs around the clock', channelCount: 12 },
  { id: 2, name: 'Films and series, dubbed and subtitled', channelCount: 40 },
  { id: 3, name: 'Sport', channelCount: 7 }
]

const channel = (id, name) => ({
  id, playlistId: 1, categoryId: 1, name, number: id, logoUrl: null,
  streamUrl: `http://x/${id}`, kind: 'live', epgChannelId: null, favorite: false,
  hidden: false, rating: null, year: null, plot: null, addedAt: null, containerExtension: null
})

const CHANNELS = [
  channel(1, 'First channel with a rather long provider-given name'),
  channel(2, 'Second channel'),
  channel(3, 'Third channel')
]

const answers = {
  'settings:get': () => ({ ...settings }),
  'settings:set': (patch) => {
    patches.push(patch)
    settings = { ...settings, ...patch }
    return { ...settings }
  },
  'playlists:list': () => [playlist],
  'folders:list': () => [],
  'categories:list': () => CATEGORIES,
  'channels:recent': () => [],
  'progress:continueWatching': () => [],
  'channels:query': () => CHANNELS,
  'channels:count': () => CHANNELS.length,
  'media:capabilities': () => ({
    ffmpeg: true, ffmpegSource: 'bundled', ffprobe: true, recordingsPath: null
  }),
  'app:version': () => '0.9.0-test',
  'channels:get': (id) => CHANNELS.find((c) => c.id === id) ?? null,
  'progress:get': () => null,
  'downloads:forItem': () => null,
  'channels:toggleFavorite': () => true
}

contextBridge.exposeInMainWorld('__probe', {
  patches: () => patches.slice(),
  /** The last width written for a given setting, or null if none ever was. */
  lastWidth: (key) => {
    for (let i = patches.length - 1; i >= 0; i--) {
      if (patches[i] && patches[i][key] !== undefined) return patches[i][key]
    }
    return null
  }
})

contextBridge.exposeInMainWorld('api', {
  invoke: (name, payload) => {
    if (!answers[name]) return Promise.resolve(null)
    return Promise.resolve(answers[name](payload))
  },
  on: () => () => undefined,
  platform: 'win32'
})
