/**
 * A stand-in bridge for the update prompt and banner.
 *
 * Records every channel the renderer invokes, so the harness can assert the
 * thing the installer's notice actually promises: that nothing is asked of
 * GitHub before the user has said it may be.
 *
 * The starting settings come from the page's query string, so each case opens
 * a fresh install in a known state rather than depending on what the last one
 * left behind.
 */
const { contextBridge } = require('electron')

const BASE = {
  language: 'en', theme: 'dark', accentColor: '#46b096', uiScale: 1,
  volume: 1, muted: false, singleConnection: false, sourceFailover: true,
  autoCheckUpdates: null, lastUpdateCheck: null,
  knownUpdateVersion: null, knownUpdateUrl: null, dismissedUpdate: null,
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

function seeded() {
  try {
    const raw = new URLSearchParams(location.search).get('seed')
    return raw ? { ...BASE, ...JSON.parse(raw) } : { ...BASE }
  } catch {
    return { ...BASE }
  }
}

let settings = null
const invoked = []

const answers = {
  'settings:get': () => ({ ...settings }),
  'settings:set': (patch) => {
    settings = { ...settings, ...patch }
    return { ...settings }
  },
  'playlists:list': () => [],
  'media:capabilities': () => ({ ffmpeg: true, ffmpegSource: 'bundled', ffprobe: true, recordingsPath: null }),
  'app:version': () => '0.9.0-beta.2',
  'channels:recent': () => []
}

// Exposed as functions, not values: `exposeInMainWorld` copies what it is
// given and may only be called once per name, so a plain object would freeze
// at whatever it held when the page loaded.
contextBridge.exposeInMainWorld('__probe', {
  settings: () => ({ ...(settings ?? seeded()) }),
  invoked: () => invoked.slice()
})

contextBridge.exposeInMainWorld('api', {
  invoke: (channel, payload) => {
    if (settings === null) settings = seeded()
    invoked.push(channel)
    const answer = answers[channel] ? answers[channel](payload) : null
    return Promise.resolve(answer)
  },
  on: () => () => undefined,
  platform: 'win32'
})
