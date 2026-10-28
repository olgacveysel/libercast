import type { AvailableUpdate } from '@shared/releases'
import type {
  AppSettings,
  AutoRefreshReport,
  BackupOptions,
  BackupSummary,
  Category,
  Channel,
  ChannelHealth,
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
  /**
   * Everything matching a query, across one source or all of them.
   *
   * `merge` collapses the same channel on different providers, exactly as the
   * channel list does — without it, searching with two providers connected
   * returns each channel twice.
   */
  'search:global': {
    req: { playlistId?: number; merge?: boolean; query: string; limit?: number }
    res: SearchResults
  }

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

  /**
   * Asks GitHub whether a newer release exists.
   *
   * Only ever in response to a button. `error` is set when the check could not
   * be made at all, which is worth showing and is not the same as being up to
   * date.
   */
  'app:checkUpdate': {
    req: void
    res: { update: AvailableUpdate | null; current: string; error: string | null }
  }

  /** Checks every favourite in turn and reports which no longer play. */
  'health:scanFavorites': { req: number; res: ChannelHealth[] }
  'health:cancel': { req: void; res: void }

  /**
   * Pulls one multi-view tile out into a window of its own, and puts it back.
   *
   * The tile index travels with the channel because that is what the window
   * returns to, and because the grid has to stop playing exactly that tile —
   * two windows on one channel would cost a second provider connection.
   */
  'multiview:detach': { req: { channelId: number; tile: number }; res: void }
  'multiview:attach': { req: number; res: void }
  /** Which tiles are in their own window, for a renderer that just reloaded. */
  'multiview:detached': { req: void; res: number[] }
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
  /** How far through a favourites scan we are. */
  'health:progress': { done: number; total: number; current: string }
  /**
   * A newer release was found by the once-a-day launch check.
   *
   * Pushed rather than polled because the check finishes a second or two after
   * the window opens, and a renderer that asked once at startup would always
   * ask too early.
   */
  'updates:available': AvailableUpdate

  /**
   * The tiles now in their own window.
   *
   * Pushed rather than polled because a detached window can be closed from the
   * window manager or the taskbar, where the grid would never hear about it.
   */
  'multiview:detachedChanged': number[]
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
  'app:showLogs',
  'app:checkUpdate',
  'health:scanFavorites',
  'health:cancel',
  'multiview:detach',
  'multiview:attach',
  'multiview:detached'
]

export const IPC_EVENTS: IpcEventName[] = [
  'sync:progress',
  'window:maximizedChanged',
  'recordings:changed',
  'downloads:changed',
  'reminders:tune',
  'sources:refreshed',
  'health:progress',
  'multiview:detachedChanged',
  'updates:available'
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
