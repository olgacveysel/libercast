/**
 * A stand-in bridge for remote navigation.
 *
 * Serves a long channel list, because the case most likely to fail is a
 * virtualised one: only a window of rows exists in the DOM at a time, and
 * focus cannot move to an element that is not there. Fifty is enough to be
 * sure the list is windowed.
 */
const { contextBridge } = require('electron')

const { defaults } = require('./settings-stub.cjs')

const BASE_SETTINGS = {
  ...defaults(),
  // What this harness needs on top of the real defaults.
  tvNavigation: true,
  // Stated rather than relied on: the channel lists must be open, because
  // navigating them is the whole point of this harness.
  liveListsCollapsed: false,
  muted: true,
  volume: 0
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

const CHANNELS = Array.from({ length: 50 }, (_, i) => ({
  ...channel,
  id: i + 1,
  externalId: String(i + 1),
  name: `Channel ${String(i + 1).padStart(2, '0')}`,
  number: i + 1
}))

const answers = {
  'settings:get': () => ({ ...settings }),
  'settings:set': (patch) => {
    settings = { ...settings, ...patch }
    return { ...settings }
  },
  'playlists:list': () => [playlist],
  'folders:list': () => [],
  'categories:list': () => [],
  'channels:query': () => CHANNELS,
  'channels:count': () => CHANNELS.length,
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
