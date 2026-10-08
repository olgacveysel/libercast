import type { XtreamAccountInfo } from '@shared/types'
import type { ParsedCatalog, ParsedCategory, ParsedChannel, ParsedEpisode, ParsedVodInfo } from './types'
import { requestJson, type FetchOptions } from '@main/util/http'

export interface XtreamCredentials {
  baseUrl: string
  username: string
  password: string
}

/* ------------------------------------------------------------------ */
/* Wire shapes. Xtream panels are loosely typed — every numeric field   */
/* may arrive as a string, so nothing here is trusted directly.         */
/* ------------------------------------------------------------------ */

interface RawUserInfo {
  username?: string
  status?: string
  exp_date?: string | number | null
  is_trial?: string | number
  active_cons?: string | number
  max_connections?: string | number
}

interface RawServerInfo {
  url?: string
  port?: string | number
  https_port?: string | number
  server_protocol?: string
  timezone?: string
}

interface RawAuth {
  user_info?: RawUserInfo
  server_info?: RawServerInfo
}

interface RawCategory {
  category_id?: string | number
  category_name?: string
}

interface RawLiveStream {
  stream_id?: string | number
  name?: string
  stream_icon?: string
  epg_channel_id?: string | null
  category_id?: string | number | null
  num?: string | number
  tv_archive?: string | number
}

interface RawVodStream {
  stream_id?: string | number
  name?: string
  stream_icon?: string
  category_id?: string | number | null
  container_extension?: string
}

interface RawSeries {
  series_id?: string | number
  name?: string
  cover?: string
  category_id?: string | number | null
}

interface RawVodInfoResponse {
  info?: Record<string, unknown>
  movie_data?: Record<string, unknown>
}

interface RawSeriesInfoResponse {
  info?: Record<string, unknown>
  episodes?: Record<string, RawEpisode[]> | RawEpisode[]
}

interface RawEpisode {
  id?: string | number
  episode_num?: string | number
  season?: string | number
  title?: string
  container_extension?: string
  info?: {
    plot?: string
    duration_secs?: string | number
    duration?: string
    movie_image?: string
    cover_big?: string
  }
}

/* ------------------------------------------------------------------ */
/* Client                                                              */
/* ------------------------------------------------------------------ */

export class XtreamClient {
  constructor(
    private readonly credentials: XtreamCredentials,
    private readonly options: FetchOptions = {}
  ) {}

  /** Normalizes whatever the user typed into a clean scheme://host:port base. */
  static normalizeBaseUrl(input: string): string {
    let value = input.trim().replace(/\/+$/, '')
    if (!/^https?:\/\//i.test(value)) value = `http://${value}`
    const url = new URL(value)
    // Strip a pasted player_api path so users can paste any URL from a provider email.
    url.pathname = ''
    url.search = ''
    return url.toString().replace(/\/+$/, '')
  }

  private api(action?: string, extra: Record<string, string> = {}): string {
    const url = new URL(`${this.credentials.baseUrl}/player_api.php`)
    url.searchParams.set('username', this.credentials.username)
    url.searchParams.set('password', this.credentials.password)
    if (action) url.searchParams.set('action', action)
    for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, value)
    return url.toString()
  }

  async authenticate(): Promise<XtreamAccountInfo> {
    const raw = await requestJson<RawAuth>(this.api(), this.options)
    const user = raw.user_info

    if (!user || (user.status && String(user.status).toLowerCase() === 'disabled')) {
      throw new Error(user?.status ? `Account ${user.status}` : 'Authentication failed — check credentials')
    }
    if (!user.username) throw new Error('Server did not return account information')

    const expiry = user.exp_date ? Number(user.exp_date) : null

    return {
      username: user.username,
      status: user.status ?? 'Unknown',
      expiresAt: expiry && Number.isFinite(expiry) ? expiry * 1000 : null,
      isTrial: String(user.is_trial ?? '0') === '1',
      activeConnections: toInt(user.active_cons) ?? 0,
      maxConnections: toInt(user.max_connections) ?? 0,
      serverUrl: this.credentials.baseUrl,
      timezone: raw.server_info?.timezone ?? null
    }
  }

  async liveCatalog(): Promise<ParsedCatalog> {
    const [categories, streams] = await Promise.all([
      requestJson<RawCategory[]>(this.api('get_live_categories'), this.options),
      requestJson<RawLiveStream[]>(this.api('get_live_streams'), { ...this.options, timeoutMs: 120_000 })
    ])

    const channels: ParsedChannel[] = asArray<RawLiveStream>(streams).flatMap((stream) => {
      const id = str(stream.stream_id)
      if (!id) return []
      return [
        {
          externalId: id,
          name: (stream.name ?? '').trim() || `Channel ${id}`,
          categoryExternalId: str(stream.category_id),
          number: toInt(stream.num),
          logoUrl: stream.stream_icon || null,
          epgChannelId: stream.epg_channel_id || null,
          streamUrl: this.liveStreamUrl(id),
          containerExtension: 'ts',
          isAdult: false
        }
      ]
    })

    return { kind: 'live', categories: mapCategories(categories), channels }
  }

  async movieCatalog(): Promise<ParsedCatalog> {
    const [categories, streams] = await Promise.all([
      requestJson<RawCategory[]>(this.api('get_vod_categories'), this.options),
      requestJson<RawVodStream[]>(this.api('get_vod_streams'), { ...this.options, timeoutMs: 120_000 })
    ])

    const channels: ParsedChannel[] = asArray<RawVodStream>(streams).flatMap((stream) => {
      const id = str(stream.stream_id)
      if (!id) return []
      const extension = stream.container_extension || 'mp4'
      return [
        {
          externalId: `vod:${id}`,
          name: (stream.name ?? '').trim() || `Movie ${id}`,
          categoryExternalId: str(stream.category_id),
          logoUrl: stream.stream_icon || null,
          streamUrl: this.vodStreamUrl(id, extension),
          containerExtension: extension,
          isAdult: false
        }
      ]
    })

    return { kind: 'movie', categories: mapCategories(categories), channels }
  }

  /**
   * Series are listed here as one entry per show. Season and episode expansion
   * happens on demand via get_series_info, because fetching it for every show
   * up front means thousands of requests.
   */
  async seriesCatalog(): Promise<ParsedCatalog> {
    const [categories, series] = await Promise.all([
      requestJson<RawCategory[]>(this.api('get_series_categories'), this.options),
      requestJson<RawSeries[]>(this.api('get_series'), { ...this.options, timeoutMs: 120_000 })
    ])

    const channels: ParsedChannel[] = asArray<RawSeries>(series).flatMap((show) => {
      const id = str(show.series_id)
      if (!id) return []
      return [
        {
          externalId: `series:${id}`,
          name: (show.name ?? '').trim() || `Series ${id}`,
          categoryExternalId: str(show.category_id),
          logoUrl: show.cover || null,
          // Series have no single playable URL; episodes resolve individually.
          streamUrl: '',
          containerExtension: null,
          isAdult: false
        }
      ]
    })

    return { kind: 'series', categories: mapCategories(categories), channels }
  }

  /** Extended metadata for one movie. Called lazily, when a title is opened. */
  async movieInfo(streamId: string): Promise<ParsedVodInfo> {
    const raw = await requestJson<RawVodInfoResponse>(
      this.api('get_vod_info', { vod_id: streamId }),
      this.options
    )
    const info = raw.info ?? {}
    const movie = raw.movie_data ?? {}

    return {
      plot: text(info.plot ?? info.description),
      cast: text(info.cast ?? info.actors),
      director: text(info.director),
      genre: text(info.genre),
      releaseDate: text(info.releasedate ?? info.releaseDate ?? movie.added),
      rating: num(info.rating),
      durationSecs: num(info.duration_secs) ?? parseDuration(text(info.duration)),
      backdropUrl: firstImage(info.backdrop_path) ?? text(info.movie_image) ?? text(info.cover_big),
      trailerId: text(info.youtube_trailer)
    }
  }

  /**
   * Seasons and episodes for one series. Xtream returns `episodes` as an object
   * keyed by season number, but a few panels return a flat array instead, so
   * both shapes are handled.
   */
  async seriesInfo(seriesId: string): Promise<{ info: ParsedVodInfo; episodes: ParsedEpisode[] }> {
    const raw = await requestJson<RawSeriesInfoResponse>(
      this.api('get_series_info', { series_id: seriesId }),
      { ...this.options, timeoutMs: 60_000 }
    )

    const info = raw.info ?? {}
    const buckets = raw.episodes ?? {}
    const flat: { season: number | null; episode: RawEpisode }[] = []

    if (Array.isArray(buckets)) {
      for (const episode of buckets) flat.push({ season: null, episode })
    } else {
      for (const [seasonKey, episodes] of Object.entries(buckets)) {
        const season = Number.parseInt(seasonKey, 10)
        for (const episode of asArray<RawEpisode>(episodes)) {
          flat.push({ season: Number.isFinite(season) ? season : null, episode })
        }
      }
    }

    const episodes: ParsedEpisode[] = flat.flatMap(({ season, episode }) => {
      const id = str(episode.id)
      if (!id) return []
      const number = toInt(episode.episode_num) ?? 0
      return [
        {
          externalId: id,
          season: season ?? toInt(episode.season) ?? 1,
          episode: number,
          title: (episode.title ?? '').trim() || `Episode ${number}`,
          plot: text(episode.info?.plot),
          durationSecs: num(episode.info?.duration_secs) ?? parseDuration(text(episode.info?.duration)),
          containerExtension: episode.container_extension || 'mp4',
          stillUrl: text(episode.info?.movie_image) ?? text(episode.info?.cover_big)
        }
      ]
    })

    return {
      info: {
        plot: text(info.plot),
        cast: text(info.cast),
        director: text(info.director),
        genre: text(info.genre),
        releaseDate: text(info.releaseDate ?? info.releasedate),
        rating: num(info.rating),
        durationSecs: null,
        backdropUrl: firstImage(info.backdrop_path) ?? text(info.cover),
        trailerId: text(info.youtube_trailer)
      },
      episodes
    }
  }

  liveStreamUrl(streamId: string, extension = 'ts'): string {
    const { baseUrl, username, password } = this.credentials
    return `${baseUrl}/live/${encode(username)}/${encode(password)}/${streamId}.${extension}`
  }

  vodStreamUrl(streamId: string, extension: string): string {
    const { baseUrl, username, password } = this.credentials
    return `${baseUrl}/movie/${encode(username)}/${encode(password)}/${streamId}.${extension}`
  }

  seriesEpisodeUrl(episodeId: string, extension: string): string {
    const { baseUrl, username, password } = this.credentials
    return `${baseUrl}/series/${encode(username)}/${encode(password)}/${episodeId}.${extension}`
  }

  /** XMLTV feed exposed by most panels. */
  xmltvUrl(): string {
    const { baseUrl, username, password } = this.credentials
    return `${baseUrl}/xmltv.php?username=${encode(username)}&password=${encode(password)}`
  }
}

/* ------------------------------------------------------------------ */

function mapCategories(raw: unknown): ParsedCategory[] {
  return asArray<RawCategory>(raw).flatMap((category) => {
    const id = str(category.category_id)
    if (!id) return []
    return [{ externalId: id, name: (category.category_name ?? '').trim() || 'Unnamed' }]
  })
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function str(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null
  return String(value)
}

function toInt(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number.parseInt(String(value), 10)
  return Number.isFinite(parsed) ? parsed : null
}

function encode(value: string): string {
  return encodeURIComponent(value)
}

function text(value: unknown): string | null {
  if (typeof value === 'number') return String(value)
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** `backdrop_path` is an array of URLs on most panels and a bare string on some. */
function firstImage(value: unknown): string | null {
  if (Array.isArray(value)) return text(value[0])
  return text(value)
}

/** Xtream durations arrive as `01:42:00`. */
function parseDuration(value: string | null): number | null {
  if (!value) return null
  const parts = value.split(':').map((part) => Number.parseInt(part, 10))
  if (parts.some((part) => !Number.isFinite(part))) return null
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!
  return null
}
