/**
 * A stand-in bridge for the add-source dialog.
 *
 * The one answer that matters here is `app:credentialStorage`: the harness
 * seeds it per case so the dialog can be shown every machine's answer without
 * needing that machine. What the real main process answers on this machine is
 * a separate question, settled by `credentialStorage()` and its unit tests.
 *
 * `delay` holds that answer back, so the harness can look at the dialog in the
 * state every user sees first — before the round trip has come back.
 */
const { contextBridge } = require('electron')

const BASE = {
  language: 'en', theme: 'dark', accentColor: '#46b096', uiScale: 1,
  volume: 1, muted: false, singleConnection: false, sourceFailover: true,
  autoCheckUpdates: false, lastUpdateCheck: null,
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

function seed() {
  try {
    const raw = new URLSearchParams(location.search).get('seed')
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

const options = seed()
const settings = { ...BASE, ...(options.settings ?? {}) }
const storage = options.storage ?? { backend: 'dpapi', protectedByOs: true }

const answers = {
  'settings:get': () => ({ ...settings }),
  'settings:set': (patch) => Object.assign(settings, patch),
  'playlists:list': () => [],
  'channels:recent': () => [],
  'media:capabilities': () => ({
    ffmpeg: true, ffmpegSource: 'bundled', ffprobe: true, recordingsPath: null
  }),
  'app:version': () => '0.9.0-beta.3',
  'app:credentialStorage': () => storage
}

const SLOW = new Set(options.delay ? ['app:credentialStorage'] : [])

contextBridge.exposeInMainWorld('api', {
  invoke: (channel, payload) => {
    const answer = answers[channel] ? answers[channel](payload) : null
    if (!SLOW.has(channel)) return Promise.resolve(answer)
    return new Promise((resolve) => setTimeout(() => resolve(answer), 4000))
  },
  on: () => () => undefined,
  platform: options.platform ?? 'win32'
})
