import type {
  ContinueWatchingItem,
  ProgressItemType,
  ProgressPatch,
  SeriesEpisode,
  SeriesSeason,
  VodInfo
} from '@shared/types'
import type { ParsedEpisode, ParsedVodInfo } from '@main/sources/types'
import { getDb } from '../index'

/* ------------------------------------------------------------------ */
/* VOD metadata                                                        */
/* ------------------------------------------------------------------ */

interface VodInfoRow {
  channel_id: number
  plot: string | null
  cast_list: string | null
  director: string | null
  genre: string | null
  release_date: string | null
  rating: number | null
  duration_secs: number | null
  backdrop_url: string | null
  trailer_id: string | null
  fetched_at: number
}

function toVodInfo(row: VodInfoRow): VodInfo {
  return {
    channelId: row.channel_id,
    plot: row.plot,
    cast: row.cast_list,
    director: row.director,
    genre: row.genre,
    releaseDate: row.release_date,
    rating: row.rating,
    durationSecs: row.duration_secs,
    backdropUrl: row.backdrop_url,
    trailerId: row.trailer_id
  }
}

/** Cached metadata, or null when it has never been fetched for this title. */
export function getVodInfo(channelId: number): VodInfo | null {
  const row = getDb().prepare('SELECT * FROM vod_info WHERE channel_id = ?').get(channelId) as
    | VodInfoRow
    | undefined
  return row ? toVodInfo(row) : null
}

export function saveVodInfo(channelId: number, info: ParsedVodInfo): VodInfo {
  getDb()
    .prepare(
      `INSERT INTO vod_info
         (channel_id, plot, cast_list, director, genre, release_date, rating,
          duration_secs, backdrop_url, trailer_id, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(channel_id) DO UPDATE SET
         plot = excluded.plot,
         cast_list = excluded.cast_list,
         director = excluded.director,
         genre = excluded.genre,
         release_date = excluded.release_date,
         rating = excluded.rating,
         duration_secs = excluded.duration_secs,
         backdrop_url = excluded.backdrop_url,
         trailer_id = excluded.trailer_id,
         fetched_at = excluded.fetched_at`
    )
    .run(
      channelId,
      info.plot,
      info.cast,
      info.director,
      info.genre,
      info.releaseDate,
      info.rating,
      info.durationSecs,
      info.backdropUrl,
      info.trailerId,
      Date.now()
    )

  const saved = getVodInfo(channelId)
  if (!saved) throw new Error('vod_info insert did not return a row')
  return saved
}

/* ------------------------------------------------------------------ */
/* Series episodes                                                     */
/* ------------------------------------------------------------------ */

interface EpisodeRow {
  id: number
  channel_id: number
  external_id: string
  season: number
  episode: number
  title: string
  plot: string | null
  duration_secs: number | null
  container_extension: string | null
  still_url: string | null
  position_secs: number | null
  completed: number | null
}

function toEpisode(row: EpisodeRow): SeriesEpisode {
  return {
    id: row.id,
    channelId: row.channel_id,
    externalId: row.external_id,
    season: row.season,
    episode: row.episode,
    title: row.title,
    plot: row.plot,
    durationSecs: row.duration_secs,
    containerExtension: row.container_extension,
    stillUrl: row.still_url,
    positionSecs: row.position_secs ?? 0,
    completed: row.completed === 1
  }
}

export function saveEpisodes(channelId: number, episodes: ParsedEpisode[]): void {
  const db = getDb()

  const upsert = db.prepare(
    `INSERT INTO series_episodes
       (channel_id, external_id, season, episode, title, plot, duration_secs, container_extension, still_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(channel_id, external_id) DO UPDATE SET
       season = excluded.season,
       episode = excluded.episode,
       title = excluded.title,
       plot = excluded.plot,
       duration_secs = excluded.duration_secs,
       container_extension = excluded.container_extension,
       still_url = excluded.still_url`
  )

  const write = db.transaction(() => {
    for (const episode of episodes) {
      upsert.run(
        channelId,
        episode.externalId,
        episode.season,
        episode.episode,
        episode.title,
        episode.plot,
        episode.durationSecs,
        episode.containerExtension,
        episode.stillUrl
      )
    }
  })
  write()
}

export function listEpisodes(channelId: number): SeriesEpisode[] {
  const rows = getDb()
    .prepare(
      `SELECT e.*, p.position_secs, p.completed
       FROM series_episodes e
       LEFT JOIN playback_progress p ON p.item_type = 'episode' AND p.item_id = e.id
       WHERE e.channel_id = ?
       ORDER BY e.season, e.episode`
    )
    .all(channelId) as EpisodeRow[]

  return rows.map(toEpisode)
}

export function listSeasons(channelId: number): SeriesSeason[] {
  const seasons = new Map<number, SeriesEpisode[]>()
  for (const episode of listEpisodes(channelId)) {
    const bucket = seasons.get(episode.season)
    if (bucket) bucket.push(episode)
    else seasons.set(episode.season, [episode])
  }
  return [...seasons.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([season, episodes]) => ({ season, episodes }))
}

export function getEpisode(id: number): SeriesEpisode | null {
  const row = getDb()
    .prepare(
      `SELECT e.*, p.position_secs, p.completed
       FROM series_episodes e
       LEFT JOIN playback_progress p ON p.item_type = 'episode' AND p.item_id = e.id
       WHERE e.id = ?`
    )
    .get(id) as EpisodeRow | undefined
  return row ? toEpisode(row) : null
}

/** The episode after this one in season/episode order, or null at the end. */
export function nextEpisode(id: number): SeriesEpisode | null {
  const current = getEpisode(id)
  if (!current) return null

  const row = getDb()
    .prepare(
      `SELECT e.*, p.position_secs, p.completed
       FROM series_episodes e
       LEFT JOIN playback_progress p ON p.item_type = 'episode' AND p.item_id = e.id
       WHERE e.channel_id = ?
         AND (e.season > ? OR (e.season = ? AND e.episode > ?))
       ORDER BY e.season, e.episode
       LIMIT 1`
    )
    .get(current.channelId, current.season, current.season, current.episode) as EpisodeRow | undefined

  return row ? toEpisode(row) : null
}

/** The episode before this one in season/episode order, or null at the start. */
export function previousEpisode(id: number): SeriesEpisode | null {
  const current = getEpisode(id)
  if (!current) return null

  const row = getDb()
    .prepare(
      `SELECT e.*, p.position_secs, p.completed
       FROM series_episodes e
       LEFT JOIN playback_progress p ON p.item_type = 'episode' AND p.item_id = e.id
       WHERE e.channel_id = ?
         AND (e.season < ? OR (e.season = ? AND e.episode < ?))
       ORDER BY e.season DESC, e.episode DESC
       LIMIT 1`
    )
    .get(current.channelId, current.season, current.season, current.episode) as EpisodeRow | undefined

  return row ? toEpisode(row) : null
}

export function hasEpisodes(channelId: number): boolean {
  const row = getDb()
    .prepare('SELECT 1 AS present FROM series_episodes WHERE channel_id = ? LIMIT 1')
    .get(channelId) as { present: number } | undefined
  return row !== undefined
}

/* ------------------------------------------------------------------ */
/* Playback progress                                                   */
/* ------------------------------------------------------------------ */

/** Past this fraction an item counts as finished and leaves Continue Watching. */
const COMPLETION_THRESHOLD = 0.92

/** Below this, resuming is more annoying than starting over. */
const MIN_RESUME_SECS = 15

export function saveProgress(patch: ProgressPatch): void {
  const completed =
    patch.durationSecs > 0 && patch.positionSecs / patch.durationSecs >= COMPLETION_THRESHOLD

  getDb()
    .prepare(
      `INSERT INTO playback_progress
         (item_type, item_id, channel_id, position_secs, duration_secs, completed, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(item_type, item_id) DO UPDATE SET
         position_secs = excluded.position_secs,
         duration_secs = excluded.duration_secs,
         completed = excluded.completed,
         updated_at = excluded.updated_at`
    )
    .run(
      patch.itemType,
      patch.itemId,
      patch.channelId,
      patch.positionSecs,
      patch.durationSecs,
      completed ? 1 : 0,
      Date.now()
    )
}

export function getResumePosition(itemType: ProgressItemType, itemId: number): number {
  const row = getDb()
    .prepare('SELECT position_secs, completed FROM playback_progress WHERE item_type = ? AND item_id = ?')
    .get(itemType, itemId) as { position_secs: number; completed: number } | undefined

  if (!row || row.completed === 1) return 0
  return row.position_secs >= MIN_RESUME_SECS ? row.position_secs : 0
}

export function clearProgress(itemType: ProgressItemType, itemId: number): void {
  getDb().prepare('DELETE FROM playback_progress WHERE item_type = ? AND item_id = ?').run(itemType, itemId)
}

interface ContinueRow {
  item_type: ProgressItemType
  item_id: number
  channel_id: number
  position_secs: number
  duration_secs: number
  updated_at: number
  channel_name: string
  logo_url: string | null
  season: number | null
  episode: number | null
  episode_title: string | null
}

export function continueWatching(limit: number): ContinueWatchingItem[] {
  const rows = getDb()
    .prepare(
      `SELECT p.item_type, p.item_id, p.channel_id, p.position_secs, p.duration_secs, p.updated_at,
              ch.name AS channel_name, ch.logo_url,
              e.season, e.episode, e.title AS episode_title
       FROM playback_progress p
       JOIN channels ch ON ch.id = p.channel_id
       LEFT JOIN series_episodes e ON p.item_type = 'episode' AND e.id = p.item_id
       WHERE p.completed = 0 AND ch.hidden = 0
       ORDER BY p.updated_at DESC
       LIMIT ?`
    )
    .all(limit) as ContinueRow[]

  return rows.map((row) => ({
    itemType: row.item_type,
    itemId: row.item_id,
    channelId: row.channel_id,
    title:
      row.item_type === 'episode' && row.season != null
        ? `${row.channel_name} — S${pad(row.season)}E${pad(row.episode ?? 0)}${
            row.episode_title ? ` ${row.episode_title}` : ''
          }`
        : row.channel_name,
    posterUrl: row.logo_url,
    positionSecs: row.position_secs,
    durationSecs: row.duration_secs,
    updatedAt: row.updated_at
  }))
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}
