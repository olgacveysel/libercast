import type { Category, ChannelQuery, ChannelWithState, ContentKind, EpgProgram } from '@shared/types'
import { getRules as parentalRules, lockClause } from '@main/secure/parental'
import { EFFECTIVE_EPG_ID } from './epg'
import { fold, getDb } from '../index'
import { HEALTH_TTL_MS } from './health'

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
  catchup_days: number | null
  hidden: number
  added_at: number
  /** The override when one is set, otherwise the provider's own id. */
  effective_epg_id: string | null
  favorite: number
  last_watched_at: number | null
  health_ok: number | null
  health_reason: string | null
  health_checked_at: number | null
  source_count: number | null
}

/**
 * Joins the last scan's verdict, but only while it is still fresh.
 *
 * Bound in the join rather than filtered afterwards so a stale row simply does
 * not arrive, instead of arriving and having to be remembered to ignore.
 */
const HEALTH_JOIN = 'LEFT JOIN channel_health hh ON hh.channel_id = ch.id AND hh.checked_at >= ?'

function healthCutoff(): number {
  return Date.now() - HEALTH_TTL_MS
}

function buildWhere(query: ChannelQuery): { sql: string; params: unknown[] } {
  // Live, movies and series share the channels table, so the kind filter is
  // never optional — omitting it is what made "All channels" list movies.
  const clauses: string[] = ['ch.kind = ?']
  const params: unknown[] = [query.kind ?? 'live']

  // Without a playlist the query spans every source. Only a merged list asks
  // for that; a single-source screen always names one.
  if (query.playlistId != null) {
    clauses.push('ch.playlist_id = ?')
    params.push(query.playlistId)
  }

  // A source the user disabled is not in the list, however it is queried.
  clauses.push('ch.playlist_id IN (SELECT id FROM playlists WHERE enabled = 1)')

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
    // Every token must appear, so "harbour sport" matches "Harbour Sports UK".
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

/**
 * The grouping key for a merged list.
 *
 * A name that normalises to nothing — a channel called "4K" or "|||" — must
 * not be grouped with every other such name, so those fall back to their own
 * row id and group only with themselves.
 */
const GROUP_KEY = "CASE WHEN ch.match_key = '' THEN 'id:' || ch.id ELSE ch.match_key END"

/**
 * One row per channel across every source.
 *
 * The copy that represents a group is a favourite first, then whichever source
 * the user put higher in their own ordering. Favourite first matters: starring
 * the copy on your backup provider and then seeing an unstarred row — which
 * un-stars the *other* copy when clicked — is the kind of bug that makes
 * favourites feel broken.
 *
 * `COUNT(DISTINCT …)` is not allowed in a window function in SQLite, and
 * counting rows instead would say "3 sources" for a provider that simply lists
 * the same channel three times. So the sources are counted in their own pass.
 */
function mergedQuery(where: string, order: string): string {
  return `WITH visible AS (
            SELECT ch.id,
                   ${GROUP_KEY} AS gkey,
                   ch.playlist_id,
                   p.sort_order,
                   CASE WHEN f.channel_id IS NULL THEN 1 ELSE 0 END AS unstarred
            FROM channels ch
            JOIN playlists p ON p.id = ch.playlist_id
            LEFT JOIN favorites f ON f.channel_id = ch.id
            WHERE ${where}
          ),
          groups AS (
            SELECT gkey, COUNT(DISTINCT playlist_id) AS source_count
            FROM visible GROUP BY gkey
          ),
          chosen AS (
            SELECT gkey, id FROM (
              SELECT gkey, id,
                     ROW_NUMBER() OVER (
                       PARTITION BY gkey ORDER BY unstarred, sort_order, id
                     ) AS rn
              FROM visible
            ) WHERE rn = 1
          )
          SELECT ch.*,
                 ${EFFECTIVE_EPG_ID} AS effective_epg_id,
                 CASE WHEN f.channel_id IS NULL THEN 0 ELSE 1 END AS favorite,
                 h.last_watched_at AS last_watched_at,
                 hh.ok AS health_ok, hh.reason AS health_reason, hh.checked_at AS health_checked_at,
                 g.source_count AS source_count
          FROM chosen
          JOIN channels ch        ON ch.id = chosen.id
          JOIN groups g           ON g.gkey = chosen.gkey
          LEFT JOIN favorites     f ON f.channel_id = ch.id
          LEFT JOIN watch_history h ON h.channel_id = ch.id
          ${HEALTH_JOIN}
          ORDER BY ${order}
          LIMIT ? OFFSET ?`
}

function plainQuery(where: string, order: string): string {
  return `SELECT ch.*,
                 ${EFFECTIVE_EPG_ID} AS effective_epg_id,
                 CASE WHEN f.channel_id IS NULL THEN 0 ELSE 1 END AS favorite,
                 h.last_watched_at AS last_watched_at,
                 hh.ok AS health_ok, hh.reason AS health_reason, hh.checked_at AS health_checked_at,
                 1 AS source_count
          FROM channels ch
          LEFT JOIN favorites     f ON f.channel_id = ch.id
          LEFT JOIN watch_history h ON h.channel_id = ch.id
          ${HEALTH_JOIN}
          WHERE ${where}
          ORDER BY ${order}
          LIMIT ? OFFSET ?`
}

export function queryChannels(query: ChannelQuery): ChannelWithState[] {
  const { sql, params } = buildWhere(query)
  const order = ORDER_BY[query.sort ?? 'name']
  const limit = Math.min(query.limit ?? 500, 5000)
  const offset = query.offset ?? 0

  // The health join's cutoff is bound before the WHERE parameters in the plain
  // query and after them in the merged one, because the join sits in a
  // different place in each.
  const rows = query.merge
    ? (getDb()
        .prepare(mergedQuery(sql, order))
        .all(...params, healthCutoff(), limit, offset) as ChannelRow[])
    : (getDb()
        .prepare(plainQuery(sql, order))
        .all(healthCutoff(), ...params, limit, offset) as ChannelRow[])

  return attachEpg(rows)
}

export function countChannels(query: ChannelQuery): number {
  const { sql, params } = buildWhere(query)

  // A merged list counts groups, not rows — otherwise the header promises
  // eight thousand channels and the list shows five thousand.
  const count = query.merge
    ? `SELECT COUNT(DISTINCT ${GROUP_KEY}) AS n
       FROM channels ch
       LEFT JOIN favorites f ON f.channel_id = ch.id
       WHERE ${sql}`
    : `SELECT COUNT(*) AS n
       FROM channels ch
       LEFT JOIN favorites f ON f.channel_id = ch.id
       WHERE ${sql}`

  const row = getDb().prepare(count).get(...params) as { n: number }
  return row.n
}

export function getChannel(id: number): ChannelWithState | null {
  const row = getDb()
    .prepare(
      `SELECT ch.*,
              ${EFFECTIVE_EPG_ID} AS effective_epg_id,
              CASE WHEN f.channel_id IS NULL THEN 0 ELSE 1 END AS favorite,
              h.last_watched_at AS last_watched_at,
              hh.ok AS health_ok, hh.reason AS health_reason, hh.checked_at AS health_checked_at,
              (SELECT COUNT(DISTINCT other.playlist_id)
               FROM channels other
               JOIN playlists op ON op.id = other.playlist_id AND op.enabled = 1
               WHERE other.kind = ch.kind
                 AND other.hidden = 0
                 AND other.match_key <> ''
                 AND other.match_key = ch.match_key) AS source_count
       FROM channels ch
       LEFT JOIN favorites     f ON f.channel_id = ch.id
       LEFT JOIN watch_history h ON h.channel_id = ch.id
       ${HEALTH_JOIN}
       WHERE ch.id = ?`
    )
    .get(healthCutoff(), id) as ChannelRow | undefined

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
    catchupDays: r.catchup_days ?? 0,
    hidden: r.hidden === 1,
    addedAt: r.added_at,
    favorite: r.favorite === 1,
    lastWatchedAt: r.last_watched_at,
    now: r.effective_epg_id ? nowMap.get(r.effective_epg_id) ?? null : null,
    next: r.effective_epg_id ? nextMap.get(r.effective_epg_id) ?? null : null,
    health:
      r.health_checked_at === null || r.health_ok === null
        ? null
        : { ok: r.health_ok === 1, reason: r.health_reason, checkedAt: r.health_checked_at },
    sources: r.source_count ?? 1
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
