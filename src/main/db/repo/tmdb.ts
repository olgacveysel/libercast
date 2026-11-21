import type { TmdbMeta } from '@shared/types'
import { getDb } from '@main/db'

/**
 * What TMDB said, cached against the channel it was said about.
 *
 * Two things this has to distinguish that a naive cache does not: a title
 * that was looked up and found, and a title that was looked up and *not*
 * found. The second is a real answer — a provider's VOD category is full of
 * rows that are not films — and without recording it, every one of them is
 * searched for again on every visit, spending somebody's rate limit on a
 * question already answered.
 */

interface Row {
  channel_id: number
  tmdb_id: number | null
  title: string | null
  plot: string | null
  poster_url: string | null
  backdrop_url: string | null
  year: number | null
  rating: number | null
  genres: string | null
  cast_names: string | null
  director: string | null
  runtime_secs: number | null
  fetched_at: number
}

/** How long a miss is believed before it is worth asking again. */
export const MISS_TTL_MS = 30 * 24 * 60 * 60_000

function toMeta(row: Row): TmdbMeta | null {
  if (row.tmdb_id === null) return null
  return {
    tmdbId: row.tmdb_id,
    title: row.title,
    plot: row.plot,
    posterUrl: row.poster_url,
    backdropUrl: row.backdrop_url,
    year: row.year,
    rating: row.rating,
    genres: row.genres ? (JSON.parse(row.genres) as string[]) : [],
    cast: row.cast_names ? (JSON.parse(row.cast_names) as string[]) : [],
    director: row.director,
    runtimeSecs: row.runtime_secs
  }
}

export interface CachedLookup {
  /** Null when the title was looked up and nothing matched. */
  meta: TmdbMeta | null
  fetchedAt: number
}

/** What is already known, or undefined when this title has never been asked about. */
export function getCached(channelId: number): CachedLookup | undefined {
  const row = getDb().prepare('SELECT * FROM tmdb_meta WHERE channel_id = ?').get(channelId) as
    | Row
    | undefined
  if (!row) return undefined
  return { meta: toMeta(row), fetchedAt: row.fetched_at }
}

/** Records a match, or a miss when `meta` is null. */
export function remember(channelId: number, meta: TmdbMeta | null): void {
  getDb()
    .prepare(
      `INSERT INTO tmdb_meta
         (channel_id, tmdb_id, title, plot, poster_url, backdrop_url, year, rating,
          genres, cast_names, director, runtime_secs, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(channel_id) DO UPDATE SET
         tmdb_id = excluded.tmdb_id, title = excluded.title, plot = excluded.plot,
         poster_url = excluded.poster_url, backdrop_url = excluded.backdrop_url,
         year = excluded.year, rating = excluded.rating, genres = excluded.genres,
         cast_names = excluded.cast_names, director = excluded.director,
         runtime_secs = excluded.runtime_secs, fetched_at = excluded.fetched_at`
    )
    .run(
      channelId,
      meta?.tmdbId ?? null,
      meta?.title ?? null,
      meta?.plot ?? null,
      meta?.posterUrl ?? null,
      meta?.backdropUrl ?? null,
      meta?.year ?? null,
      meta?.rating ?? null,
      meta ? JSON.stringify(meta.genres) : null,
      meta ? JSON.stringify(meta.cast) : null,
      meta?.director ?? null,
      meta?.runtimeSecs ?? null,
      Date.now()
    )
}

/**
 * Whether a recorded answer is still worth believing.
 *
 * A match never expires: a film's plot does not change, and re-fetching it
 * spends the user's rate limit to learn the same thing. A miss does expire —
 * TMDB gains titles, and a film missing today may be there in a month.
 */
export function isStale(cached: CachedLookup, now = Date.now()): boolean {
  if (cached.meta !== null) return false
  return now - cached.fetchedAt > MISS_TTL_MS
}

/** Used when the user clears their key, so nothing of theirs is left behind. */
export function forgetAll(): number {
  return getDb().prepare('DELETE FROM tmdb_meta').run().changes
}
