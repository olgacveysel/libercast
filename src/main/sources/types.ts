import type { ContentKind } from '@shared/types'

export interface ParsedCategory {
  externalId: string
  name: string
}

export interface ParsedChannel {
  externalId: string
  name: string
  categoryExternalId: string | null
  number?: number | null
  logoUrl?: string | null
  epgChannelId?: string | null
  streamUrl: string
  containerExtension?: string | null
  isAdult?: boolean
  /** Days of archive the provider keeps for this channel; 0 for none. */
  catchupDays?: number | null
  /**
   * Catalogue metadata a provider sends in the *list* response.
   *
   * Not to be confused with `vod_info`, which is richer and fetched one item
   * at a time when a detail page is opened — so it exists for the handful of
   * films someone has looked at and nothing else. Anything the browser has to
   * filter or sort thousands of rows by has to come from the list, or it is
   * not there when it is needed.
   *
   * All optional: M3U carries none of it, and panels disagree about the rest.
   */
  rating?: number | null
  /** Release year, where the provider gives one. */
  year?: number | null
  /** When the *provider* added it, which is not when we first saw it. */
  providerAddedAt?: number | null
  /**
   * Episode numbers a show's *listing* row already carries.
   *
   * Portals work this way and Xtream does not. An Xtream series needs a
   * second call per show to learn its episodes; a portal puts the numbers on
   * the row it already sent, and addresses each episode by the show's own
   * `cmd` plus that number. So for portals the episodes arrive with the
   * catalogue and are stored during the same sync, with no per-show call at
   * all — which also means a portal show opens to its episodes offline.
   *
   * Absent for every other kind of source.
   */
  episodeNumbers?: number[]
}

export interface ParsedCatalog {
  kind: ContentKind
  categories: ParsedCategory[]
  channels: ParsedChannel[]
}

export type ProgressFn = (phase: string, message: string, progress: number | null) => void

export interface ParsedVodInfo {
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

export interface ParsedEpisode {
  externalId: string
  season: number
  episode: number
  title: string
  plot: string | null
  durationSecs: number | null
  containerExtension: string | null
  stillUrl: string | null
}

/**
 * One recording in a portal's archive.
 *
 * Xtream has no equivalent: it builds an archive URL from a start time and a
 * length, so there is nothing to list. A portal keeps discrete recordings and
 * each carries the command that plays it, so replaying a moment means finding
 * the recording that covers it first.
 */
export interface ParsedArchiveRecord {
  /** The portal's own id for the recording. */
  externalId: string
  /** What plays it; exchanged for a URL at play time, like everything else. */
  cmd: string
  startsAt: number
  endsAt: number
  title: string | null
}

export interface ParsedProgramme {
  channelId: string
  title: string
  description: string | null
  category: string | null
  /** Unix ms, already resolved from the XMLTV timestamp and its offset. */
  startsAt: number
  endsAt: number
}
