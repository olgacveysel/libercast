/**
 * A stand-in bridge for the picture-in-picture control.
 *
 * `stream:open` answers with a real playable file rather than a loopback
 * session, because what is being tested is the video element and the browser's
 * own floating window — not the remux pipeline, which `verify-player` covers.
 *
 * The file is passed in on the query string by the harness, which makes it.
 */
const { contextBridge } = require('electron')

const BASE_SETTINGS = {
  language: 'en', theme: 'dark', accentColor: '#46b096', uiScale: 1,
  volume: 0, muted: true, singleConnection: false, sourceFailover: 'ask',
  autoCheckUpdates: false, lastUpdateCheck: null, knownUpdateVersion: null,
  knownUpdateUrl: null, dismissedUpdate: null,
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

const clipUrl = new URLSearchParams(location.search).get('clip') ?? ''
let settings = { ...BASE_SETTINGS }

const playlist = {
  id: 1, name: 'Source', kind: 'm3u', url: 'http://x', filePath: null,
  username: null, macAddress: null, epgUrl: null, epgOffsetMinutes: 0,
  userAgent: null, referrer: null, enabled: true, sortOrder: 1,
  lastSyncedAt: Date.now(), createdAt: Date.now(), serverTimezone: null
}

const channel = {
  id: 1, playlistId: 1, categoryId: null, kind: 'live', externalId: '1',
  name: 'Alto Sports 2', number: 1, logoUrl: null, epgChannelId: null,
  streamUrl: 'http://x/1.ts', containerExtension: 'ts', isAdult: false,
  rating: null, year: null, hidden: false, addedAt: 0, catchupDays: 0,
  favorite: false, lastWatchedAt: null, now: null, next: null,
  health: null, sources: 1
}

const answers = {
  'settings:get': () => ({ ...settings }),
  'settings:set': (patch) => {
    settings = { ...settings, ...patch }
    return { ...settings }
  },
  'playlists:list': () => [playlist],
  'categories:list': () => [],
  'channels:query': () => [channel],
  'channels:count': () => 1,
  'channels:recent': () => [],
  'progress:continueWatching': () => [],
  'epg:forChannel': () => [],
  'stream:close': () => undefined,
  'media:capabilities': () => ({
    ffmpeg: true, ffmpegSource: 'bundled', ffprobe: true, recordingsPath: null
  }),
  'app:version': () => '0.9.0-test',
  'stream:open': () => ({
    playing: {
      id: 'pip-session',
      url: clipUrl,
      seekable: true,
      durationSecs: null,
      pipeline: 'direct copy',
      tracks: { audio: [], subtitle: [] },
      video: null,
      audioTrack: null,
      subtitleTrack: null,
      subtitlesUrl: null,
      subtitlesBurnedIn: false,
      absoluteTimeline: false,
      warning: null,
      switched: null,
      playingChannelId: 1
    },
    choose: null
  })
}

contextBridge.exposeInMainWorld('api', {
  invoke: (name, payload) => {
    if (!answers[name]) {
      console.error(`[pip-preload] no answer scripted for "${name}"`)
      return Promise.resolve(null)
    }
    return Promise.resolve(answers[name](payload))
  },
  on: () => () => undefined,
  platform: 'win32'
})
