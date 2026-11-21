import type { TmdbMeta } from '@shared/types'
import { app } from 'electron'
import { requestRaw } from '@main/util/http'
import { APP_NAME } from '@shared/app'

export const TMDB_BASE = 'https://api.themoviedb.org/3'

/**
 * Where images come from.
 *
 * TMDB serves metadata and images from different hosts, and the image host
 * takes a size as a path segment. These are the two sizes worth asking for: a
 * poster for a grid, and a backdrop behind a detail sheet. Asking for the
 * original of either means downloading several megabytes to draw at 300px.
 */
const IMAGE_BASE = 'https://image.tmdb.org/t/p'
const POSTER_SIZE = 'w500'
const BACKDROP_SIZE = 'w1280'

interface TmdbSearchRow {
  id?: number
  title?: string
  name?: string
  overview?: string
  poster_path?: string | null
  backdrop_path?: string | null
  release_date?: string
  first_air_date?: string
  vote_average?: number
  genre_ids?: number[]
}

interface TmdbDetail extends TmdbSearchRow {
  runtime?: number
  episode_run_time?: number[]
  genres?: { id?: number; name?: string }[]
  credits?: { cast?: { name?: string }[]; crew?: { name?: string; job?: string }[] }
}

/**
 * The Movie Database, for titles a provider described poorly or not at all.
 *
 * The key belongs to the user, not to LiberCast. The reasoning is the same as
 * for subtitle search: this source is public, so a key shipped inside it is a
 * key anybody can extract, and the account suspended over somebody else's use
 * of it would be the maintainer's. TMDB's own terms are not the deciding
 * factor here — the deciding factor is that it would be someone else's key
 * being spent.
 *
 * Nothing here is cached or stored; that is the service's job. This is only
 * the shape of the API.
 */
export class TmdbClient {
  constructor(
    private readonly apiKey: string,
    private readonly timeoutMs = 15_000,
    private readonly base = TMDB_BASE
  ) {}

  private get userAgent(): string {
    return `${APP_NAME} v${app.getVersion()}`
  }

  private async call(path: string, params: Record<string, string> = {}): Promise<unknown> {
    const query = new URLSearchParams({ api_key: this.apiKey, ...params })
    const response = await requestRaw(`${this.base}${path}?${query.toString()}`, {
      userAgent: this.userAgent,
      headers: { Accept: 'application/json' },
      timeoutMs: this.timeoutMs
    })

    if (!response.ok) throw await describeFailure(response)

    const text = await response.text()
    try {
      return JSON.parse(text) as unknown
    } catch {
      throw new Error('TMDB answered with something that is not JSON.')
    }
  }

  /**
   * Checks a key with the cheapest real call there is.
   *
   * A search, because it is what the feature depends on: a key that
   * authenticates and cannot search is of no use, and finding that out at the
   * moment somebody opens a film is worse than finding it out here.
   */
  async testKey(): Promise<void> {
    await this.call('/search/movie', { query: 'test', page: '1' })
  }

  /**
   * The best match for a title, or nothing.
   *
   * Nothing is a perfectly good answer and is returned as such. A provider's
   * catalogue is full of titles that are not films — a 24/7 channel, a
   * category header that became a row — and inventing a plot for one of those
   * is worse than leaving it blank.
   */
  async find(kind: 'movie' | 'series', title: string, year: number | null): Promise<TmdbMeta | null> {
    const path = kind === 'movie' ? '/search/movie' : '/search/tv'
    const params: Record<string, string> = { query: title, page: '1' }

    // The year narrows a search that would otherwise match a remake, and is
    // only sent when the provider actually gave one.
    if (year !== null) params[kind === 'movie' ? 'year' : 'first_air_date_year'] = String(year)

    const found = asRows(await this.call(path, params))
    const best = found[0]
    if (!best?.id) return null

    const detailPath = kind === 'movie' ? `/movie/${best.id}` : `/tv/${best.id}`
    const detail = (await this.call(detailPath, { append_to_response: 'credits' })) as TmdbDetail

    return toMeta(kind, best.id, detail)
  }
}

function asRows(payload: unknown): TmdbSearchRow[] {
  const results = (payload as { results?: unknown })?.results
  return Array.isArray(results) ? (results as TmdbSearchRow[]) : []
}

/** A year out of "2018-06-20", or null when the field is absent or odd. */
export function yearOf(date: string | undefined): number | null {
  const year = Number.parseInt((date ?? '').slice(0, 4), 10)
  return Number.isFinite(year) && year > 1870 && year < 2200 ? year : null
}

export function toMeta(kind: 'movie' | 'series', id: number, detail: TmdbDetail): TmdbMeta {
  const cast = (detail.credits?.cast ?? [])
    .map((person) => person.name)
    .filter((name): name is string => typeof name === 'string' && name.length > 0)
    .slice(0, 8)

  const director = (detail.credits?.crew ?? []).find((person) => person.job === 'Director')?.name ?? null

  const genres = (detail.genres ?? [])
    .map((genre) => genre.name)
    .filter((name): name is string => typeof name === 'string' && name.length > 0)

  // A series reports per-episode runtimes as a list; a film reports one
  // number. Both are stored as seconds, because that is what the rest of the
  // application uses.
  const minutes = kind === 'movie' ? detail.runtime : detail.episode_run_time?.[0]

  const rating = typeof detail.vote_average === 'number' ? Math.round(detail.vote_average * 10) / 10 : null

  return {
    tmdbId: id,
    title: (detail.title ?? detail.name ?? '').trim() || null,
    plot: (detail.overview ?? '').trim() || null,
    posterUrl: detail.poster_path ? `${IMAGE_BASE}/${POSTER_SIZE}${detail.poster_path}` : null,
    backdropUrl: detail.backdrop_path ? `${IMAGE_BASE}/${BACKDROP_SIZE}${detail.backdrop_path}` : null,
    year: yearOf(detail.release_date ?? detail.first_air_date),
    rating: rating !== null && rating > 0 ? rating : null,
    genres,
    cast,
    director,
    runtimeSecs: typeof minutes === 'number' && minutes > 0 ? minutes * 60 : null
  }
}

/**
 * Turns a refusal into a sentence worth showing someone.
 *
 * The status alone is not enough to act on: a 401 here means the key is wrong
 * and a 429 means it is fine and being used too fast, and those call for
 * opposite responses from the person reading the message.
 */
export async function describeFailure(response: Response): Promise<Error> {
  let detail = ''
  try {
    const body = (await response.json()) as { status_message?: string }
    detail = (body.status_message ?? '').trim()
  } catch {
    // An error page rather than an error object. The status still says enough.
  }

  if (response.status === 401) {
    return new Error('TMDB rejected that API key. Check it was copied in full.')
  }
  if (response.status === 404) {
    return new Error('TMDB has nothing under that title.')
  }
  if (response.status === 429) {
    return new Error('TMDB is rate-limiting this key. Try again in a moment.')
  }

  return new Error(detail || `TMDB answered ${response.status}.`)
}
