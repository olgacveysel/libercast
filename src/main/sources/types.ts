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

export interface ParsedProgramme {
  channelId: string
  title: string
  description: string | null
  category: string | null
  /** Unix ms, already resolved from the XMLTV timestamp and its offset. */
  startsAt: number
  endsAt: number
}
