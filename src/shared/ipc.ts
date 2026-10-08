import type {
  AppSettings,
  AutoRefreshReport,
  BackupOptions,
  BackupSummary,
  Category,
  Channel,
  ChannelQuery,
  ChannelWithState,
  ContentKind,
  ContinueWatchingItem,
  Download,
  DownloadRequest,
  EpgAutoMatchResult,
  EpgGuideChannel,
  EpgMatchRow,
  EpgMatchSuggestion,
  EpgProgram,
  EpgRefreshResult,
  EpgReminder,
  EpgState,
  ExternalSubtitle,
  GuideWindow,
  MediaCapabilities,
  MediaTrack,
  MediaTracks,
  Playlist,
  PlaylistDraft,
  ParentalRules,
  ParentalStatus,
  ProgressItemType,
  ProgressPatch,
  Recording,
  RestoreOptions,
  RestoreSummary,
  RecordingRequest,
  ReminderRequest,
  SearchResults,
  SeriesEpisode,
  SeriesSeason,
  StreamRequest,
  StreamSession,
  StreamSource,
  SyncProgress,
  SyncResult,
  VideoInfo,
  VodInfo,
  XtreamAccountInfo
} from './types'

/**
 * The full surface the renderer may call. Keeping it in one map means the
 * preload bridge, the main-process router and the renderer client all derive
 * from a single declaration, so a typo fails at compile time.
 */
export interface IpcContract {
  'playlists:list': { req: void; res: Playlist[] }
  'playlists:create': { req: PlaylistDraft; res: Playlist }
  'playlists:update': { req: { id: number; patch: Partial<PlaylistDraft> }; res: Playlist }
  'playlists:remove': { req: number; res: void }
  'playlists:test': { req: PlaylistDraft; res: XtreamAccountInfo | null }
  'playlists:sync': { req: number; res: SyncResult }
  /** The provider's own account report for a saved source. */
  'playlists:account': { req: number; res: XtreamAccountInfo | null }

  'categories:list': { req: { playlistId: number; kind: ContentKind }; res: Category[] }

  'channels:query': { req: ChannelQuery; res: ChannelWithState[] }
  'channels:count': { req: ChannelQuery; res: number }
  'channels:get': { req: number; res: ChannelWithState | null }
  'channels:toggleFavorite': { req: number; res: boolean }
  'channels:setHidden': { req: { id: number; hidden: boolean }; res: void }
  'channels:markWatched': { req: number; res: void }
  'channels:recent': { req: { limit: number }; res: ChannelWithState[] }

  'vod:movieInfo': { req: { channelId: number; force?: boolean }; res: VodInfo | null }
  'vod:seriesDetail': {
    req: { channelId: number; force?: boolean }
    res: { info: VodInfo | null; seasons: SeriesSeason[] }
  }
  'vod:nextEpisode': { req: number; res: SeriesEpisode | null }
  'vod:previousEpisode': { req: number; res: SeriesEpisode | null }

  /**
   * Opens a playback session. The renderer receives only a loopback URL — the
   * provider URL, which carries the Xtream password, stays in the main process.
   */
  'stream:open': { req: StreamRequest; res: StreamSession }
  'stream:close': { req: string; res: void }

  'media:capabilities': { req: void; res: MediaCapabilities }

  /** Opens a file picker and returns the chosen subtitle converted to WebVTT. */
  'subtitles:pickFile': { req: void; res: ExternalSubtitle | null }
  'subtitles:loadFile': { req: string; res: ExternalSubtitle }

  'downloads:list': { req: void; res: Download[] }
  'downloads:enqueue': { req: DownloadRequest; res: Download }
  'downloads:forItem': { req: { itemType: ProgressItemType; itemId: number }; res: Download | null }
  'downloads:pause': { req: number; res: Download | null }
  'downloads:resume': { req: number; res: Download | null }
  'downloads:cancel': { req: number; res: Download | null }
  'downloads:remove': { req: { id: number; deleteFile: boolean }; res: void }
  'downloads:reveal': { req: number; res: void }

  'recordings:list': { req: void; res: Recording[] }
  'recordings:startNow': { req: RecordingRequest; res: Recording }
  'recordings:schedule': { req: RecordingRequest; res: Recording }
  'recordings:stop': { req: number; res: Recording | null }
  'recordings:remove': { req: { id: number; deleteFile: boolean }; res: void }
  'recordings:reveal': { req: number; res: void }

  'progress:save': { req: ProgressPatch; res: void }
  'progress:resume': { req: { itemType: ProgressItemType; itemId: number }; res: number }
  'progress:clear': { req: { itemType: ProgressItemType; itemId: number }; res: void }
  'progress:continueWatching': { req: { limit: number }; res: ContinueWatchingItem[] }

  'epg:refresh': { req: number; res: EpgRefreshResult }
  'epg:state': { req: number; res: EpgState | null }
  'epg:matchRows': { req: { playlistId: number; onlyUnmatched: boolean }; res: EpgMatchRow[] }
  'epg:suggestions': { req: { playlistId: number; channelName: string }; res: EpgMatchSuggestion[] }
  'epg:setOverride': { req: { channelId: number; epgChannelId: string | null }; res: void }
  'epg:autoMatch': { req: number; res: EpgAutoMatchResult }
  'epg:guideChannels': { req: number; res: EpgGuideChannel[] }
  'epg:guide': {
    req: { query: ChannelQuery; startsAt: number; endsAt: number }
    res: GuideWindow
  }
  'epg:channelProgrammes': {
    req: { epgChannelId: string; from: number; to: number }
    res: EpgProgram[]
  }

  /** One query across live, movies and series, for the command palette. */
  'search:global': { req: { playlistId: number; query: string; limit?: number }; res: SearchResults }

  'parental:status': { req: void; res: ParentalStatus }
  'parental:setPin': { req: { currentPin: string | null; newPin: string }; res: ParentalStatus }
  'parental:unlock': { req: string; res: boolean }
  'parental:lock': { req: void; res: void }
  'parental:disable': { req: string; res: ParentalStatus }
  'parental:setRules': { req: ParentalRules; res: ParentalStatus }

  'backup:export': { req: BackupOptions; res: BackupSummary }
  'backup:import': { req: RestoreOptions; res: RestoreSummary }
  'backup:pickFile': { req: void; res: string | null }

  'settings:get': { req: void; res: AppSettings }
  'settings:set': { req: Partial<AppSettings>; res: AppSettings }

  'dialog:pickM3uFile': { req: void; res: string | null }
  'dialog:pickFolder': { req: void; res: string | null }

  'window:minimize': { req: void; res: void }
  'window:toggleMaximize': { req: void; res: boolean }
  'window:close': { req: void; res: void }
  'window:isMaximized': { req: void; res: boolean }

  'reminders:list': { req: void; res: EpgReminder[] }
  'reminders:add': { req: ReminderRequest; res: EpgReminder }
  'reminders:remove': { req: number; res: void }
  'reminders:find': {
    req: { channelId: number; title: string; startsAt: number }
    res: EpgReminder | null
  }

  /** Runs the scheduled refresh immediately. */
  'sources:refreshNow': { req: void; res: AutoRefreshReport }

  'app:version': { req: void; res: string }

  /**
   * Opens the folder holding the log file, and selects it.
   *
   * Returns the path, or null if there is no log file yet, so the interface can
   * tell the difference between "opened it" and "nothing to open".
   */
  'app:showLogs': { req: void; res: string | null }
}

export type IpcChannel = keyof IpcContract
export type IpcRequest<C extends IpcChannel> = IpcContract[C]['req']
export type IpcResponse<C extends IpcChannel> = IpcContract[C]['res']

/** Main -> renderer pushes. */
export interface IpcEvents {
  'sync:progress': SyncProgress
  'window:maximizedChanged': boolean
  'recordings:changed': Recording
  'downloads:changed': Download
  /** The user clicked a reminder toast; the renderer should tune to it. */
  'reminders:tune': EpgReminder
  /** An automatic refresh finished; screens showing catalogue data should reload. */
  'sources:refreshed': AutoRefreshReport
}

export type IpcEventName = keyof IpcEvents

export const IPC_CHANNELS: IpcChannel[] = [
  'playlists:list',
  'playlists:create',
  'playlists:update',
  'playlists:remove',
  'playlists:test',
  'playlists:account',
  'playlists:sync',
  'categories:list',
  'channels:query',
  'channels:count',
  'channels:get',
  'channels:toggleFavorite',
  'channels:setHidden',
  'channels:markWatched',
  'channels:recent',
  'vod:movieInfo',
  'vod:seriesDetail',
  'vod:nextEpisode',
  'vod:previousEpisode',
  'stream:open',
  'stream:close',
  'media:capabilities',
  'downloads:list',
  'downloads:enqueue',
  'downloads:forItem',
  'downloads:pause',
  'downloads:resume',
  'downloads:cancel',
  'downloads:remove',
  'downloads:reveal',
  'recordings:list',
  'recordings:startNow',
  'recordings:schedule',
  'recordings:stop',
  'recordings:remove',
  'recordings:reveal',
  'progress:save',
  'progress:resume',
  'progress:clear',
  'progress:continueWatching',
  'epg:refresh',
  'epg:state',
  'epg:matchRows',
  'epg:suggestions',
  'epg:setOverride',
  'epg:autoMatch',
  'epg:guideChannels',
  'epg:guide',
  'epg:channelProgrammes',
  'search:global',
  'parental:status',
  'parental:setPin',
  'parental:unlock',
  'parental:lock',
  'parental:disable',
  'parental:setRules',
  'backup:export',
  'backup:import',
  'backup:pickFile',
  'settings:get',
  'settings:set',
  'dialog:pickM3uFile',
  'dialog:pickFolder',
  'window:minimize',
  'window:toggleMaximize',
  'window:close',
  'window:isMaximized',
  'reminders:list',
  'reminders:add',
  'reminders:remove',
  'reminders:find',
  'sources:refreshNow',
  'app:version',
  'app:showLogs'
]

export const IPC_EVENTS: IpcEventName[] = [
  'sync:progress',
  'window:maximizedChanged',
  'recordings:changed',
  'downloads:changed',
  'reminders:tune',
  'sources:refreshed'
]

// Re-exported so the renderer can import everything from one module.
export type {
  AppSettings,
  AutoRefreshReport,
  BackupOptions,
  BackupSummary,
  Category,
  Channel,
  ChannelQuery,
  ChannelWithState,
  ContentKind,
  ContinueWatchingItem,
  Download,
  DownloadRequest,
  EpgProgram,
  EpgReminder,
  EpgAutoMatchResult,
  EpgGuideChannel,
  EpgMatchRow,
  EpgMatchSuggestion,
  EpgRefreshResult,
  EpgState,
  ExternalSubtitle,
  GuideWindow,
  MediaCapabilities,
  MediaTrack,
  MediaTracks,
  Playlist,
  PlaylistDraft,
  ParentalRules,
  ParentalStatus,
  ProgressItemType,
  ProgressPatch,
  Recording,
  RestoreOptions,
  RestoreSummary,
  RecordingRequest,
  ReminderRequest,
  SeriesEpisode,
  SeriesSeason,
  StreamRequest,
  StreamSession,
  StreamSource,
  SyncProgress,
  SyncResult,
  VideoInfo,
  VodInfo,
  XtreamAccountInfo
}
