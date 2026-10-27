/**
 * A stand-in for the real preload bridge, so the built renderer can be
 * rendered without a main process behind it.
 *
 * Only the handful of channels the shell touches on startup are answered;
 * everything else resolves empty, which is what an unconfigured install looks
 * like anyway. The point is to get real components, real CSS and real
 * translated strings in front of a real layout engine — not to simulate the
 * application.
 */
const { contextBridge } = require('electron')

const settings = {
  language: 'en',
  theme: 'dark',
  accentColor: '#46b096',
  uiScale: 1,
  volume: 1,
  muted: false,
  singleConnection: false,
  sourceFailover: true,
  autoRefreshHours: 24,
  autoRefreshEpg: true,
  lastAutoRefresh: null,
  hardwareAcceleration: true,
  showStreamStats: false,
  resumeLastChannel: true,
  preferredAudioLanguages: [],
  preferredSubtitleLanguages: [],
  recordingsPath: null,
  downloadsPath: null,
  ffmpegPath: null,
  maxConcurrentDownloads: 1,
  videoFit: 'fit',
  videoZoom: 1,
  sidebarCollapsed: false,
  multiViewColumns: 2,
  multiViewRows: 2,
  multiViewChannels: [],
  subtitleSize: 1,
  subtitleColor: '#ffffff',
  subtitleBackground: '#000000',
  subtitleBackgroundOpacity: 0.6,
  subtitleEdge: 'none',
  subtitleFont: 'system'
}

let current = settings

const answers = {
  'settings:get': () => ({ ...current }),
  // A fresh object, exactly as the real handler returns after writing to the
  // database. Mutating one in place instead makes the store hand React a
  // reference it has already seen, and parts of the screen quietly keep
  // rendering the previous value — which is a bug in this stub, not in the app.
  'settings:set': (patch) => {
    current = { ...current, ...patch }
    return { ...current }
  },
  'playlists:list': () => [],
  'media:capabilities': () => ({
    ffmpeg: false,
    ffmpegSource: 'bundled',
    ffprobe: false,
    recordingsPath: null
  }),
  'parental:status': () => ({
    enabled: true,
    unlocked: true,
    lockAdult: true,
    autoLockMinutes: 15,
    keywords: ['example'],
    lockedCategoryIds: []
  }),
  'categories:list': () => [],
  'app:version': () => '0.9.0-test'
}

contextBridge.exposeInMainWorld('api', {
  invoke: (channel, payload) =>
    Promise.resolve(answers[channel] ? answers[channel](payload) : null),
  on: () => () => undefined,
  platform: 'win32'
})
