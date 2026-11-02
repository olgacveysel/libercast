/**
 * A stand-in bridge for the "is this your channel?" question.
 *
 * `test/failover.test.ts` settles when the main process asks. This settles
 * what the asking looks like: whether the names are shown in full, whether
 * approving one actually re-opens with it allowed, and whether refusing one
 * reaches the main process as a refusal rather than a dismissal.
 *
 * The provider answers are scripted rather than computed — the point is the
 * interface's half of the exchange.
 */
const { contextBridge } = require('electron')

let settings = {
  language: 'en', theme: 'dark', accentColor: '#46b096', uiScale: 1,
  volume: 1, muted: false, singleConnection: false, sourceFailover: 'ask',
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

const playlist = (id, name) => ({
  id, name, kind: 'm3u', url: 'http://x', filePath: null, username: null,
  macAddress: null, epgUrl: null, epgOffsetMinutes: 0, userAgent: null,
  referrer: null, enabled: true, sortOrder: id, lastSyncedAt: Date.now(),
  createdAt: Date.now(), serverTimezone: null
})

const channel = (id, playlistId, name) => ({
  id, playlistId, categoryId: null, kind: 'live', externalId: String(id), name,
  number: null, logoUrl: null, epgChannelId: null, streamUrl: 'http://x/s.ts',
  containerExtension: 'ts', isAdult: false, hidden: false, addedAt: 0,
  catchupDays: 0, favorite: false, lastWatchedAt: null, now: null, next: null,
  health: null, sources: 1
})

const WANTED = channel(1, 1, 'Alto Sports 2 HD')
/** One word different, and that word is a region. */
const VARIANT_ID = 77

const session = (switched) => ({
  id: 'session-1',
  url: 'http://127.0.0.1:1/stream.mp4',
  seekable: false,
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
  switched,
  playingChannelId: switched ? switched.alternateChannelId : WANTED.id
})

const CHOICE = {
  reason: 'The provider rejected the credentials for this item (HTTP 403).',
  channelName: 'Alto Sports 2 HD',
  fromSource: 'Main provider',
  offers: [
    {
      channelId: VARIANT_ID,
      channelName: 'Alto Sports 2 Turkey Full HD Backup Feed',
      sourceName: 'Regional provider'
    },
    { channelId: 78, channelName: 'Alto Sports 2 West', sourceName: 'Third provider' }
  ]
}

const rejected = []
const opens = []

const answers = {
  'settings:get': () => ({ ...settings }),
  'settings:set': (patch) => {
    settings = { ...settings, ...patch }
    return { ...settings }
  },
  'playlists:list': () => [playlist(1, 'Main provider')],
  'categories:list': () => [],
  'channels:query': () => [WANTED],
  'channels:count': () => 1,
  'channels:recent': () => [],
  'progress:continueWatching': () => [],
  'media:capabilities': () => ({
    ffmpeg: true, ffmpegSource: 'bundled', ffprobe: true, recordingsPath: null
  }),
  'app:version': () => '0.9.0-test',
  'epg:forChannel': () => [],
  'stream:close': () => undefined,
  'failover:reject': (payload) => {
    rejected.push(payload)
    return undefined
  },
  'stream:open': (request) => {
    opens.push(request)
    const allowed = request.allow ?? []

    // Approving an offer is the only thing that makes this play, which is the
    // behaviour being tested: an uncertain name is never played unasked.
    const approved = CHOICE.offers.find((offer) => allowed.includes(offer.channelId))
    if (approved) {
      return {
        playing: session({
          channelName: approved.channelName,
          from: 'Main provider',
          to: approved.sourceName,
          requestedChannelId: WANTED.id,
          alternateChannelId: approved.channelId
        }),
        choose: null
      }
    }

    // A refused offer is gone for good, exactly as the database makes it.
    const left = CHOICE.offers.filter(
      (offer) => !rejected.some((r) => r.alternateId === offer.channelId)
    )
    if (left.length === 0) throw new Error(CHOICE.reason)

    return { playing: null, choose: { ...CHOICE, offers: left } }
  }
}

contextBridge.exposeInMainWorld('__probe', {
  rejected: () => rejected.slice(),
  opens: () => opens.slice(),
  settings: () => ({ ...settings })
})

contextBridge.exposeInMainWorld('api', {
  invoke: (name, payload) => {
    // An unscripted channel answers null, and a screen that does `.length` on
    // it takes the whole React tree down with no error on screen — which is
    // how an earlier run of this harness looked exactly like a product bug.
    // Anything reached here is a channel this file forgot.
    if (!answers[name]) {
      console.error(`[failover-preload] no answer scripted for "${name}"`)
      return Promise.resolve(null)
    }
    try {
      return Promise.resolve(answers[name](payload))
    } catch (error) {
      return Promise.reject(error)
    }
  },
  on: () => () => undefined,
  platform: 'win32'
})
