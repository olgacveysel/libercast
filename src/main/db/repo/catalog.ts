import type { Category, ChannelQuery, ChannelWithState, ContentKind, EpgProgram } from '@shared/types'
import { getRules as parentalRules, lockClause } from '@main/secure/parental'
import { EFFECTIVE_EPG_ID } from './epg'
import { fold, getDb } from '../index'

/* ------------------------------------------------------------------ */
/* Categories                                                          */
/* ------------------------------------------------------------------ */

interface CategoryRow {
  id: number
  playlist_id: number
  external_id: string
  name: string
  kind: ContentKind
  sort_order: number
  channel_count: number
}

export function listCategories(playlistId: number, kind: ContentKind): Category[] {
  const lock = lockClause('ch')
  const locked = lockedCategoryFilter()

  const rows = getDb()
    .prepare(
      `SELECT c.*, (
         SELECT COUNT(*) FROM channels ch
         WHERE ch.category_id = c.id AND ch.hidden = 0
         ${lock ? `AND ${lock.sql}` : ''}
       ) AS channel_count
       FROM categories c
       WHERE c.playlist_id = ? AND c.kind = ?
       ${locked.sql}
       ORDER BY c.sort_order, c.name`
    )
    .all(...(lock?.params ?? []), playlistId, kind, ...locked.params) as CategoryRow[]

  return rows.map((r) => ({
    id: r.id,
    playlistId: r.playlist_id,
    externalId: r.external_id,
    name: r.name,
    kind: r.kind,
    channelCount: r.channel_count,
    sortOrder: r.sort_order
  }))
}

/* ------------------------------------------------------------------ */
/* Channels                                                            */
/* ------------------------------------------------------------------ */

interface ChannelRow {
  id: number
  playlist_id: number
  category_id: number | null
  kind: ContentKind
  external_id: string
  name: string
  number: number | null
  logo_url: string | null
  epg_channel_id: string | null
  stream_url: string
  container_extension: string | null
  is_adult: number
  hidden: number
  added_at: number
  /** The override when one is set, otherwise the provider's own id. */
  effective_epg_id: string | null
  favorite: number
  last_watched_at: number | null
}

function buildWhere(query: ChannelQuery): { sql: string; params: unknown[] } {
  // Live, movies and series share the channels table, so the kind filter is
  // never optional — omitting it is what made "All channels" list movies.
  const clauses: string[] = ['ch.playlist_id = ?', 'ch.kind = ?']
  const params: unknown[] = [query.playlistId, query.kind ?? 'live']

  if (!query.includeHidden) clauses.push('ch.hidden = 0')

  if (query.categoryId != null) {
    clauses.push('ch.category_id = ?')
    params.push(query.categoryId)
  }

  if (query.favoritesOnly) clauses.push('f.channel_id IS NOT NULL')

  // Parental filtering is applied here rather than in the UI so that no hidden
  // row ever reaches the renderer, whichever screen asked for it.
  const lock = lockClause('ch')
  if (lock) {
    clauses.push(lock.sql)
    params.push(...lock.params)
  }

  const search = query.search?.trim()
  if (search) {
    // Every token must appear, so "sky sport" matches "Sky Sports UK".
    for (const token of fold(search).split(' ').filter(Boolean)) {
      clauses.push('ch.name_folded LIKE ?')
      params.push(`%${token}%`)
    }
  }

  return { sql: clauses.join(' AND '), params }
}

const ORDER_BY: Record<NonNullable<ChannelQuery['sort']>, string> = {
  name: 'ch.name_folded ASC',
  number: 'ch.number IS NULL, ch.number ASC, ch.name_folded ASC',
  recent: 'h.last_watched_at IS NULL, h.last_watched_at DESC'
}

export function queryChannels(query: ChannelQuery): ChannelWithState[] {
  const { sql, params } = buildWhere(query)
  const order = ORDER_BY[query.sort ?? 'name']
  const limit = Math.min(query.limit ?? 500, 5000)
  const offset = query.offset ?? 0

  const rows = getDb()
    .prepare(
      `SELECT ch.*,
              ${EFFECTIVE_EPG_ID} AS effective_epg_id,
              CASE WHEN f.channel_id IS NULL THEN 0 ELSE 1 END AS favorite,
              h.last_watched_at AS last_watched_at
       FROM channels ch
       LEFT JOIN favorites     f ON f.channel_id = ch.id
       LEFT JOIN watch_history h ON h.channel_id = ch.id
       WHERE ${sql}
       ORDER BY ${order}
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as ChannelRow[]

  return attachEpg(rows)
}

export function countChannels(query: ChannelQuery): number {
  const { sql, params } = buildWhere(query)
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n
       FROM channels ch
       LEFT JOIN favorites f ON f.channel_id = ch.id
       WHERE ${sql}`
    )
    .get(...params) as { n: number }
  return row.n
}

export function getChannel(id: number): ChannelWithState | null {
  const row = getDb()
    .prepare(
      `SELECT ch.*,
              ${EFFECTIVE_EPG_ID} AS effective_epg_id,
              CASE WHEN f.channel_id IS NULL THEN 0 ELSE 1 END AS favorite,
              h.last_watched_at AS last_watched_at
       FROM channels ch
       LEFT JOIN favorites     f ON f.channel_id = ch.id
       LEFT JOIN watch_history h ON h.channel_id = ch.id
       WHERE ch.id = ?`
    )
    .get(id) as ChannelRow | undefined

  if (!row) return null
  return attachEpg([row])[0] ?? null
}

export function recentChannels(limit: number): ChannelWithState[] {
  const recentLock = lockClause('ch')
  const rows = getDb()
    .prepare(
      `SELECT ch.*,
              ${EFFECTIVE_EPG_ID} AS effective_epg_id,
              CASE WHEN f.channel_id IS NULL THEN 0 ELSE 1 END AS favorite,
              h.last_watched_at AS last_watched_at
       FROM watch_history h
       JOIN channels ch ON ch.id = h.channel_id
       LEFT JOIN favorites f ON f.channel_id = ch.id
       WHERE ch.hidden = 0 AND ch.kind = 'live'
       ${recentLock ? `AND ${recentLock.sql}` : ''}
       ORDER BY h.last_watched_at DESC
       LIMIT ?`
    )
    .all(...(recentLock?.params ?? []), limit) as ChannelRow[]

  return attachEpg(rows)
}

/**
 * Fills now/next for a page of channels with two queries instead of 2N.
 */
function attachEpg(rows: ChannelRow[]): ChannelWithState[] {
  const epgIds = [...new Set(rows.map((r) => r.effective_epg_id).filter((v): v is string => !!v))]
  const nowMap = new Map<string, EpgProgram>()
  const nextMap = new Map<string, EpgProgram>()

  if (epgIds.length > 0) {
    const now = Date.now()
    const placeholders = epgIds.map(() => '?').join(',')

    const current = getDb()
      .prepare(
        `SELECT * FROM epg_programs
         WHERE epg_channel_id IN (${placeholders}) AND starts_at <= ? AND ends_at > ?`
      )
      .all(...epgIds, now, now) as EpgRow[]

    for (const p of current) nowMap.set(p.epg_channel_id, toProgram(p))

    const upcoming = getDb()
      .prepare(
        `SELECT p.* FROM epg_programs p
         WHERE p.epg_channel_id IN (${placeholders}) AND p.starts_at > ?
         AND p.starts_at = (
           SELECT MIN(q.starts_at) FROM epg_programs q
           WHERE q.epg_channel_id = p.epg_channel_id AND q.starts_at > ?
         )`
      )
      .all(...epgIds, now, now) as EpgRow[]

    for (const p of upcoming) nextMap.set(p.epg_channel_id, toProgram(p))
  }

  return rows.map((r) => ({
    id: r.id,
    playlistId: r.playlist_id,
    categoryId: r.category_id,
    kind: r.kind,
    externalId: r.external_id,
    name: r.name,
    number: r.number,
    logoUrl: r.logo_url,
    // The id in use, not necessarily what the provider advertised.
    epgChannelId: r.effective_epg_id,
    streamUrl: r.stream_url,
    containerExtension: r.container_extension,
    isAdult: r.is_adult === 1,
    hidden: r.hidden === 1,
    addedAt: r.added_at,
    favorite: r.favorite === 1,
    lastWatchedAt: r.last_watched_at,
    now: r.effective_epg_id ? nowMap.get(r.effective_epg_id) ?? null : null,
    next: r.effective_epg_id ? nextMap.get(r.effective_epg_id) ?? null : null
  }))
}

interface EpgRow {
  id: number
  epg_channel_id: string
  title: string
  description: string | null
  category: string | null
  starts_at: number
  ends_at: number
}

function toProgram(row: EpgRow): EpgProgram {
  return {
    id: row.id,
    epgChannelId: row.epg_channel_id,
    title: row.title,
    description: row.description,
    category: row.category,
    startsAt: row.starts_at,
    endsAt: row.ends_at
  }
}

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

export function toggleFavorite(channelId: number): boolean {
  const db = getDb()
  const existing = db.prepare('SELECT 1 FROM favorites WHERE channel_id = ?').get(channelId)
  if (existing) {
    db.prepare('DELETE FROM favorites WHERE channel_id = ?').run(channelId)
    return false
  }
  db.prepare('INSERT INTO favorites (channel_id, added_at) VALUES (?, ?)').run(channelId, Date.now())
  return true
}

export function setHidden(channelId: number, hidden: boolean): void {
  getDb().prepare('UPDATE channels SET hidden = ? WHERE id = ?').run(hidden ? 1 : 0, channelId)
}

export function markWatched(channelId: number): void {
  getDb()
    .prepare(
      `INSERT INTO watch_history (channel_id, last_watched_at, watch_count)
       VALUES (?, ?, 1)
       ON CONFLICT(channel_id) DO UPDATE SET
         last_watched_at = excluded.last_watched_at,
         watch_count = watch_count + 1`
    )
    .run(channelId, Date.now())
}

/** Hides a locked category from the sidebar entirely, not just its channels. */
function lockedCategoryFilter(): { sql: string; params: unknown[] } {
  const lock = lockClause('ch')
  if (!lock) return { sql: '', params: [] }

  const { lockedCategoryIds } = parentalRules()
  if (lockedCategoryIds.length === 0) return { sql: '', params: [] }

  return {
    sql: `AND c.id NOT IN (${lockedCategoryIds.map(() => '?').join(',')})`,
    params: lockedCategoryIds
  }
}
