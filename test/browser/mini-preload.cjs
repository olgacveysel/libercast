/**
 * A stand-in bridge for the corner player.
 *
 * `stream:open` answers with a real playable file, because the claim under
 * test is that one video element keeps playing across a route change — which
 * can only be shown by watching its clock. Every open is counted, so the
 * harness can tell "kept playing" from "closed and reopened", which look
 * identical on screen and are not the same thing at all: reopening costs a
 * provider connection and a few seconds of black.
 */
const { contextBridge } = require('electron')

const BASE_SETTINGS = {
  language: 'en', theme: 'dark', accentColor: '#46b096', uiScale: 1,
  volume: 0, muted: true, singleConnection: false, sourceFailover: 'ask',
  autoCheckUpdates: false, lastUpdateCheck: null, knownUpdateVersion: null,
  knownUpdateUrl: null, dismissedUpdate: null,
  autoRefreshHours: 0, autoRefreshEpg: true, lastAutoRefresh: null,
  hardwareAcceleration: true, tvNavigation: false, showStreamStats: false, resumeLastChannel: true,
  preferredAudioLanguages: [], preferredSubtitleLanguages: [],
  recordingsPath: null, recordingTemplate: '{channel} - {title} ({date} {time})', downloadsPath: null, ffmpegPath: null,
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

let opens = 0
let closes = 0

const answers = {
  'settings:get': () => ({ ...settings }),
  'settings:set': (patch) => {
    settings = { ...settings, ...patch }
    return { ...settings }
  },
  'playlists:list': () => [playlist],
  'folders:list': () => [],
  'categories:list': () => [],
  'channels:query': () => [channel],
  'channels:count': () => 1,
  'channels:recent': () => [],
  'progress:continueWatching': () => [],
  'epg:forChannel': () => [],
  'stream:close': () => {
    closes += 1
    return undefined
  },
  'media:capabilities': () => ({
    ffmpeg: true, ffmpegSource: 'bundled', ffprobe: true, recordingsPath: null
  }),
  'app:version': () => '0.9.0-test',
  'stream:open': () => {
    opens += 1
    return {
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
    }
  }
}

contextBridge.exposeInMainWorld('__probe', {
  opens: () => opens,
  closes: () => closes
})

contextBridge.exposeInMainWorld('api', {
  invoke: (name, payload) => {
    if (!answers[name]) {
      console.error(`[mini-preload] no answer scripted for "${name}"`)
      return Promise.resolve(null)
    }
    return Promise.resolve(answers[name](payload))
  },
  on: () => () => undefined,
  platform: 'win32'
})
