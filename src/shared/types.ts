/**
 * Normalized domain model.
 *
 * Every source adapter (M3U, Xtream, Stalker) maps its wire format into these
 * shapes, so nothing above the adapter layer needs to know where data came from.
 */

export type SourceKind = 'xtream' | 'm3u' | 'stalker'

export type ContentKind = 'live' | 'movie' | 'series'

/** A configured provider. Secrets are NOT part of this object — see CredentialStore. */
export interface Playlist {
  id: number
  name: string
  kind: SourceKind
  /** Xtream base URL, M3U url, or Stalker portal URL. Empty for local files. */
  url: string
  /** Absolute path when the source is a local .m3u file. */
  filePath: string | null
  /** Xtream username. Password lives in the OS credential store, keyed by playlist id. */
  username: string | null
  /** Stalker MAC address. */
  macAddress: string | null
  /** Optional XMLTV url overriding the provider EPG. */
  epgUrl: string | null
  /** Minutes added to EPG timestamps to correct provider timezone drift. */
  epgOffsetMinutes: number
  /** Some providers reject requests without a specific UA. */
  userAgent: string | null
  referrer: string | null
  enabled: boolean
  sortOrder: number
  lastSyncedAt: number | null
  createdAt: number
}

export interface PlaylistDraft {
  name: string
  kind: SourceKind
  url?: string
  filePath?: string | null
  username?: string | null
  password?: string | null
  macAddress?: string | null
  epgUrl?: string | null
  epgOffsetMinutes?: number
  userAgent?: string | null
  referrer?: string | null
}

export interface Category {
  id: number
  playlistId: number
  /** Identifier as given by the provider — group-title for M3U, category_id for Xtream. */
  externalId: string
  name: string
  kind: ContentKind
  channelCount: number
  sortOrder: number
}

export interface Channel {
  id: number
  playlistId: number
  categoryId: number | null
  kind: ContentKind
  /** stream_id for Xtream; a stable hash of the url for M3U. */
  externalId: string
  name: string
  /** Provider channel number, when advertised via tvg-chno. */
  number: number | null
  logoUrl: string | null
  /** XMLTV channel id used to join against EPG data. */
  epgChannelId: string | null
  streamUrl: string
  /** ts, m3u8, mp4 ... used to pick a player backend hint. */
  containerExtension: string | null
  isAdult: boolean
  hidden: boolean
  addedAt: number
}

/** A channel joined with its live EPG state, which is what the list UI renders. */
export interface ChannelWithState extends Channel {
  favorite: boolean
  lastWatchedAt: number | null
  now: EpgProgram | null
  next: EpgProgram | null
}

export interface EpgProgram {
  id: number
  epgChannelId: string
  title: string
  description: string | null
  category: string | null
  /** Unix ms, already offset-corrected. */
  startsAt: number
  endsAt: number
}

/**
 * A programme the user asked to be told about.
 *
 * It carries its own copy of the title and times rather than pointing at a row
 * in the guide, because the guide table is emptied and rebuilt on every
 * refresh — a reference would make "update the guide" silently mean "delete the
 * reminders".
 */
export interface EpgReminder {
  id: number
  channelId: number
  channelName: string
  title: string
  startsAt: number
  endsAt: number
  /** Minutes before the start to notify. 0 notifies as it begins. */
  leadMinutes: number
  notifiedAt: number | null
}

export interface ReminderRequest {
  channelId: number
  title: string
  startsAt: number
  endsAt: number
  leadMinutes?: number
}

export interface XtreamAccountInfo {
  username: string
  status: string
  /** Unix ms, null when the account never expires. */
  expiresAt: number | null
  isTrial: boolean
  activeConnections: number
  maxConnections: number
  serverUrl: string
  timezone: string | null
}

export interface SyncResult {
  playlistId: number
  categories: number
  liveChannels: number
  movies: number
  series: number
  /** Channels present in the previous sync that the provider no longer returns. */
  removed: number
  durationMs: number
}

/**
 * What an automatic refresh did, so the next person to open Settings can see
 * whether it is working without watching it happen.
 */
export interface AutoRefreshReport {
  at: number
  /** Per source, in the order they were refreshed. */
  sources: {
    playlistId: number
    name: string
    /** Null when the sync failed; `error` says why. */
    added: number | null
    removed: number | null
    error: string | null
  }[]
  /** Programmes downloaded, or null when the guide was not refreshed. */
  programmes: number | null
  epgError: string | null
}

export interface SyncProgress {
  playlistId: number
  phase: 'connecting' | 'categories' | 'live' | 'movies' | 'series' | 'saving' | 'done' | 'error'
  message: string
  /** 0..1, or null when the total is not yet known. */
  progress: number | null
}

/** The result of checking whether one favourite still plays. */
export interface ChannelHealth {
  channelId: number
  name: string
  ok: boolean
  /** The provider's own wording where there is any, for a failure. */
  reason: string | null
  checkedAt: number
}

export interface ChannelQuery {
  playlistId: number
  /** Defaults to 'live'. Movies and series live in the same table. */
  kind?: ContentKind
  categoryId?: number | null
  /** Matches name, case-insensitive, whitespace tolerant. */
  search?: string
  favoritesOnly?: boolean
  includeHidden?: boolean
  sort?: 'name' | 'number' | 'recent'
  limit?: number
  offset?: number
}

export interface AppSettings {
  theme: 'dark' | 'light' | 'system'
  accentColor: string
  hardwareAcceleration: boolean
  /** Restore the last watched channel when the app starts. */
  resumeLastChannel: boolean
  volume: number
  muted: boolean
  recordingsPath: string | null
  downloadsPath: string | null
  /** Folder holding ffmpeg/ffprobe, when the bundled binaries do not work. */
  ffmpegPath: string | null
  /**
   * How many downloads run at once. One by default because Xtream accounts
   * commonly allow a single connection, and a second would stop playback.
   */
  maxConcurrentDownloads: number
  /** Shows resolution, frame rate and dropped frames over the picture. */
  showStreamStats: boolean
  /**
   * Spend as few provider connections as possible.
   *
   * Identifying a live stream costs one connection and playing it costs
   * another, back to back. On an account that allows a single connection the
   * second is refused, which looks like a channel that opens only sometimes.
   * With this on, a live channel that has not been identified before is played
   * on assumption instead, and corrected if the assumption turns out wrong.
   *
   * The cost is that the audio and subtitle menus stay empty for a channel
   * until it has been played once, since nothing has enumerated its tracks.
   */
  singleConnection: boolean
  /**
   * How the picture is fitted to the window. Providers frequently send content
   * pillarboxed, letterboxed, or with the wrong sample aspect ratio, and no
   * single choice is right for all of them — so it is a setting, and it sticks.
   */
  videoFit: VideoFit
  /** Extra magnification on top of the fit, 1 to 1.6. Crops burnt-in bars. */
  videoZoom: number
  /**
   * Hours between automatic source refreshes. 0 turns it off.
   *
   * Off by default: a refresh talks to the provider, and on an account with a
   * low connection limit an unattended sync that collides with playback is a
   * worse problem than a catalogue that is a day out of date.
   */
  autoRefreshHours: number
  /** Refresh the guide as part of an automatic refresh. */
  autoRefreshEpg: boolean
  /** Result of the last automatic refresh, for the Settings screen. */
  lastAutoRefresh: AutoRefreshReport | null
  /** Scales the whole interface. 1 is the design size. */
  uiScale: number
  /**
   * Sidebar reduced to a rail of icons.
   *
   * The user's own choice. A narrow window collapses the sidebar regardless,
   * without changing this — so widening the window restores what they picked.
   */
  sidebarCollapsed: boolean
  /**
   * Live TV reduced to the picture, with the category and channel lists
   * hidden.
   *
   * Clicking Live TV in the sidebar while already on it toggles this, the way
   * clicking the sidebar toggle folds the sidebar. The toolbar carries a
   * button for it too, because a gesture with no visible control is a gesture
   * nobody finds.
   */
  liveListsCollapsed: boolean
  /** Channel ids pinned to the multi-view tiles, by position. */
  multiViewChannels: (number | null)[]
  /** Tiles across and down in multi-view. */
  multiViewColumns: number
  multiViewRows: number
  /** ISO 639 codes, most preferred first, used to auto-pick an audio track. */
  preferredAudioLanguages: string[]
  /** Same for subtitles. Empty means subtitles stay off unless chosen. */
  preferredSubtitleLanguages: string[]

  /**
   * How subtitles look. The browser draws cues itself and only honours a short
   * list of properties on them, so these are exactly the ones it honours —
   * there is deliberately no vertical position here, because where a line sits
   * is decided by the subtitle file, not by CSS.
   */
  subtitleScale: number
  subtitleColor: string
  subtitleBackground: string
  subtitleBackgroundOpacity: number
  /** What keeps the text readable with no box behind it. */
  subtitleEdge: 'none' | 'shadow' | 'outline'
  subtitleFont: 'sans' | 'serif' | 'mono'

  language: 'en' | 'de' | 'tr'
}

/**
 * `fit` letterboxes and never distorts — the safe default. `fill` crops to
 * cover the window, which is how you get rid of black bars baked into the
 * stream. `stretch` distorts. The two ratios force a display aspect for
 * providers that declare the wrong one.
 */
export type VideoFit = 'fit' | 'fill' | 'stretch' | '16:9' | '4:3'

export const VIDEO_FITS: { value: VideoFit; label: string; hint: string }[] = [
  { value: 'fit', label: 'Fit', hint: 'Show the whole picture. Never distorts.' },
  { value: 'fill', label: 'Fill', hint: 'Crop to fill the window. Removes baked-in black bars.' },
  { value: 'stretch', label: 'Stretch', hint: 'Fill the window exactly. Distorts the picture.' },
  { value: '16:9', label: '16:9', hint: 'Force widescreen, for a stream that declares the wrong shape.' },
  { value: '4:3', label: '4:3', hint: 'Force the old TV shape.' }
]

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  // The teal from the mark, so a fresh install matches its own icon.
  accentColor: '#22b58f',
  hardwareAcceleration: true,
  resumeLastChannel: true,
  volume: 0.8,
  muted: false,
  recordingsPath: null,
  downloadsPath: null,
  ffmpegPath: null,
  maxConcurrentDownloads: 1,
  showStreamStats: false,
  singleConnection: false,
  autoRefreshHours: 0,
  autoRefreshEpg: true,
  lastAutoRefresh: null,
  videoFit: 'fit',
  videoZoom: 1,
  uiScale: 1,
  sidebarCollapsed: false,
  liveListsCollapsed: false,
  multiViewChannels: [null, null, null, null],
  multiViewColumns: 2,
  multiViewRows: 2,
  preferredAudioLanguages: [],
  preferredSubtitleLanguages: [],
  subtitleScale: 1,
  subtitleColor: '#ffffff',
  subtitleBackground: '#000000',
  subtitleBackgroundOpacity: 0.72,
  subtitleEdge: 'shadow',
  subtitleFont: 'sans',
  language: 'en'
}

/* ------------------------------------------------------------------ */
/* VOD                                                                 */
/* ------------------------------------------------------------------ */

export interface VodInfo {
  channelId: number
  plot: string | null
  cast: string | null
  director: string | null
  genre: string | null
  releaseDate: string | null
  rating: number | null
  durationSecs: number | null
  backdropUrl: string | null
  trailerId: string | null
}

export interface SeriesEpisode {
  id: number
  channelId: number
  externalId: string
  season: number
  episode: number
  title: string
  plot: string | null
  durationSecs: number | null
  containerExtension: string | null
  stillUrl: string | null
  /** Joined playback state. */
  positionSecs: number
  completed: boolean
}

export interface SeriesSeason {
  season: number
  episodes: SeriesEpisode[]
}

export type ProgressItemType = 'movie' | 'episode'

export interface ProgressPatch {
  itemType: ProgressItemType
  itemId: number
  channelId: number
  positionSecs: number
  durationSecs: number
}

export interface ContinueWatchingItem {
  itemType: ProgressItemType
  itemId: number
  channelId: number
  /** Movie title, or "Series — S02E05 Title". */
  title: string
  posterUrl: string | null
  positionSecs: number
  durationSecs: number
  updatedAt: number
}

/* ------------------------------------------------------------------ */
/* EPG                                                                 */
/* ------------------------------------------------------------------ */

export interface EpgRefreshResult {
  playlistId: number
  programmes: number
  matchedChannels: number
  unmatchedChannels: number
  sourceUrl: string
  durationMs: number
}

export interface EpgGuideChannel {
  epgChannelId: string
  displayName: string
  iconUrl: string | null
}

export interface EpgMatchRow {
  channelId: number
  channelName: string
  logoUrl: string | null
  /** What the provider advertised, which may be empty or wrong. */
  providerEpgId: string | null
  /** The correction in force, if any. */
  overrideId: string | null
  /** True when the matcher chose the override rather than the user. */
  overrideAuto: boolean
  /** Name of the guide channel currently in use. */
  matchedName: string | null
  /** Whether the effective id resolves to guide data at all. */
  matched: boolean
}

export interface EpgMatchSuggestion {
  epgChannelId: string
  displayName: string
  score: number
}

export interface EpgAutoMatchResult {
  examined: number
  matched: number
  ambiguous: number
}

export interface EpgState {
  refreshedAt: number
  programmeCount: number
  matchedChannels: number
  sourceUrl: string | null
}

export interface GuideRow {
  channel: Channel
  programmes: EpgProgram[]
}

export interface GuideWindow {
  startsAt: number
  endsAt: number
  rows: GuideRow[]
  totalChannels: number
}

/* ------------------------------------------------------------------ */
/* Recording                                                           */
/* ------------------------------------------------------------------ */

export type RecordingStatus = 'scheduled' | 'recording' | 'completed' | 'failed' | 'cancelled'

export interface Recording {
  id: number
  channelId: number | null
  playlistId: number | null
  title: string
  channelName: string
  filePath: string | null
  status: RecordingStatus
  error: string | null
  startsAt: number
  endsAt: number
  startedAt: number | null
  finishedAt: number | null
  bytes: number
  createdAt: number
}

export interface RecordingRequest {
  channelId: number
  title: string
  /** Omitted for "record now". */
  startsAt?: number
  endsAt: number
  /** Minutes added before and after a scheduled programme. */
  padBeforeMinutes?: number
  padAfterMinutes?: number
}

export type DownloadStatus =
  | 'queued'
  | 'downloading'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface Download {
  id: number
  itemType: ProgressItemType
  itemId: number
  channelId: number | null
  playlistId: number | null
  title: string
  /** "S02E05 - The Escape" for episodes, null for films. */
  subtitle: string | null
  posterUrl: string | null
  filePath: string | null
  status: DownloadStatus
  error: string | null
  bytesTotal: number
  bytesDone: number
  createdAt: number
  finishedAt: number | null
  /** Bytes per second, present only while running. */
  speed?: number
}

export interface DownloadRequest {
  itemType: ProgressItemType
  /** Movie: the channel id. Episode: the series_episodes row id. */
  itemId: number
  channelId: number
  title: string
  subtitle?: string | null
  posterUrl?: string | null
}

/* ------------------------------------------------------------------ */
/* Parental controls                                                   */
/* ------------------------------------------------------------------ */

export interface ParentalStatus {
  /** A PIN has been set. The PIN itself never leaves the main process. */
  enabled: boolean
  /** Locked content is visible right now because the PIN was entered. */
  unlocked: boolean
  lockedCategoryIds: number[]
  /** Titles containing any of these words are hidden while locked. */
  keywords: string[]
  /** Hide anything the provider or the parser marked as adult. */
  lockAdult: boolean
  /** Minutes of inactivity before the lock re-engages. 0 keeps it open. */
  autoLockMinutes: number
}

export interface ParentalRules {
  lockedCategoryIds: number[]
  keywords: string[]
  lockAdult: boolean
  autoLockMinutes: number
}

/* ------------------------------------------------------------------ */
/* Backup                                                              */
/* ------------------------------------------------------------------ */

export interface BackupOptions {
  /** Include provider passwords. Requires a passphrase, and encrypts the file. */
  includeCredentials: boolean
  passphrase?: string
}

export interface BackupSummary {
  filePath: string
  playlists: number
  favorites: number
  history: number
  progress: number
  encrypted: boolean
  bytes: number
}

export interface RestoreOptions {
  filePath: string
  passphrase?: string
  /** 'merge' keeps what is already there; 'replace' clears it first. */
  mode: 'merge' | 'replace'
}

export interface RestoreSummary {
  playlists: number
  favorites: number
  history: number
  progress: number
  settingsRestored: boolean
  /** Sources whose password was not in the backup and must be re-entered. */
  needCredentials: string[]
}

export interface SearchResults {
  live: ChannelWithState[]
  movies: ChannelWithState[]
  series: ChannelWithState[]
  /** Total matches before the per-section cap, so the UI can say "of 340". */
  totals: { live: number; movies: number; series: number }
}

export interface MediaCapabilities {
  /** False when no working ffmpeg was found; MPEG-TS and recording are then unavailable. */
  ffmpeg: boolean
  /** Where the working binary came from: bundled, system PATH, or a configured folder. */
  ffmpegSource: string
  ffprobe: boolean
  recordingsPath: string | null
}

export interface MediaTrack {
  /** Position among tracks of this type, which is what ffmpeg's -map 0:a:N wants. */
  index: number
  codec: string
  /** ISO 639 code as the container declares it, e.g. "ger", "eng", "tur". */
  language: string | null
  /** Human-readable name for the picker: "German", "English (Commentary)". */
  label: string
  title: string | null
  /** Audio only. */
  channels: number | null
  isDefault: boolean
  isForced: boolean
  /**
   * Subtitles only. Text subtitles convert to WebVTT; bitmap ones (PGS, DVB,
   * VobSub) can only be burned into the picture.
   */
  isTextBased: boolean
}

export interface MediaTracks {
  audio: MediaTrack[]
  subtitle: MediaTrack[]
}

/** What the provider declares about the picture, read during the probe. */
export interface VideoInfo {
  codec: string | null
  width: number | null
  height: number | null
  /** Frames per second as declared by the container. */
  fps: number | null
  /** Bits per second, when the container states one. */
  bitrate: number | null
}

/** A subtitle file the user opened themselves, already converted to WebVTT. */
export interface ExternalSubtitle {
  label: string
  filePath: string
  vtt: string
  /** Cue count, so the UI can say when a file parsed to nothing. */
  cues: number
}

export interface StreamSession {
  id: string
  url: string
  seekable: boolean
  durationSecs: number | null
  pipeline: string
  tracks: MediaTracks
  video: VideoInfo | null
  /** Selections actually applied, after preferred-language matching. */
  audioTrack: number | null
  subtitleTrack: number | null
  /** Loopback URL streaming WebVTT cues, when a text subtitle is selected. */
  subtitlesUrl: string | null
  /** True when the subtitle had to be rendered into the picture. */
  subtitlesBurnedIn: boolean
  /**
   * True when the element's clock is a position in the source rather than time
   * since this stream started.
   *
   * Seeking with a stream copy can only begin at a keyframe, so a stream opened
   * at 30:00 really starts a little before it. On an absolute timeline the
   * player reports where it actually is instead of where it asked to be.
   */
  absoluteTimeline: boolean
  /**
   * A problem found before playback started, which the app decided to play
   * through anyway. Shown only if playback then fails.
   */
  warning: string | null
}

export interface StreamRequest {
  source: StreamSource
  seekSecs?: number
  /** Identifies the calling player, so its previous session can be retired. */
  owner?: string
  /** Index within the audio tracks. Omitted means "pick by preference". */
  audioTrack?: number
  /** Index within the subtitle tracks, or null for none. */
  subtitleTrack?: number | null
}

export type StreamSource =
  | { type: 'channel'; id: number }
  | { type: 'episode'; id: number }
  | { type: 'recording'; id: number }
  | { type: 'download'; id: number }

export interface Result<T> {
  ok: boolean
  data?: T
  error?: string
}
