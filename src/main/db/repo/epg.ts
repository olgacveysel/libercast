import type { EpgProgram, EpgState, GuideRow, GuideWindow, ChannelQuery } from '@shared/types'
import type { ParsedProgramme } from '@main/sources/types'
import { getDb } from '../index'
import { queryChannels } from './catalog'

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

/** Drops a playlist's guide data before a refresh writes the new set. */
export function clearPrograms(playlistId: number): void {
  getDb().prepare('DELETE FROM epg_programs WHERE playlist_id = ?').run(playlistId)
}

export function insertPrograms(playlistId: number, programmes: ParsedProgramme[]): number {
  const db = getDb()
  const insert = db.prepare(
    `INSERT INTO epg_programs
       (playlist_id, epg_channel_id, title, description, category, starts_at, ends_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )

  const write = db.transaction(() => {
    for (const programme of programmes) {
      insert.run(
        playlistId,
        programme.channelId,
        programme.title,
        programme.description,
        programme.category,
        programme.startsAt,
        programme.endsAt
      )
    }
  })
  write()

  return programmes.length
}

/** Guide data older than the cutoff is dead weight; drop it after a refresh. */
export function prunePrograms(before: number): number {
  return getDb().prepare('DELETE FROM epg_programs WHERE ends_at < ?').run(before).changes
}

/**
 * How many of a playlist's channels have at least one programme.
 * The usual EPG complaint is a `tvg-id` mismatch, and this is what surfaces it.
 */
export function coverage(playlistId: number): { matched: number; total: number } {
  const row = getDb()
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM channels ch
          WHERE ch.playlist_id = ? AND ch.kind = 'live'
            AND ${EFFECTIVE_EPG_ID} IN (
              SELECT DISTINCT epg_channel_id FROM epg_programs WHERE playlist_id = ?
            )
         ) AS matched,
         (SELECT COUNT(*) FROM channels WHERE playlist_id = ? AND kind = 'live') AS total`
    )
    .get(playlistId, playlistId, playlistId) as { matched: number; total: number }
  return row
}

export function saveState(
  playlistId: number,
  programmeCount: number,
  matchedChannels: number,
  sourceUrl: string
): void {
  getDb()
    .prepare(
      `INSERT INTO epg_state (playlist_id, refreshed_at, programme_count, matched_channels, source_url)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(playlist_id) DO UPDATE SET
         refreshed_at = excluded.refreshed_at,
         programme_count = excluded.programme_count,
         matched_channels = excluded.matched_channels,
         source_url = excluded.source_url`
    )
    .run(playlistId, Date.now(), programmeCount, matchedChannels, sourceUrl)
}

export function getState(playlistId: number): EpgState | null {
  const row = getDb().prepare('SELECT * FROM epg_state WHERE playlist_id = ?').get(playlistId) as
    | { refreshed_at: number; programme_count: number; matched_channels: number; source_url: string | null }
    | undefined

  if (!row) return null
  return {
    refreshedAt: row.refreshed_at,
    programmeCount: row.programme_count,
    matchedChannels: row.matched_channels,
    sourceUrl: row.source_url
  }
}

/**
 * One window of the guide grid: a page of channels and every programme that
 * overlaps the window, fetched in two queries rather than one per row.
 */
export function guideWindow(
  query: ChannelQuery,
  startsAt: number,
  endsAt: number
): GuideWindow {
  const channels = queryChannels({ ...query, kind: 'live' })
  const epgIds = [...new Set(channels.map((c) => c.epgChannelId).filter((v): v is string => !!v))]

  const byChannel = new Map<string, EpgProgram[]>()

  if (epgIds.length > 0) {
    const placeholders = epgIds.map(() => '?').join(',')
    const rows = getDb()
      .prepare(
        `SELECT * FROM epg_programs
         WHERE epg_channel_id IN (${placeholders})
           AND starts_at < ? AND ends_at > ?
         ORDER BY starts_at`
      )
      .all(...epgIds, endsAt, startsAt) as EpgRow[]

    for (const row of rows) {
      const program = toProgram(row)
      const bucket = byChannel.get(program.epgChannelId)
      if (bucket) bucket.push(program)
      else byChannel.set(program.epgChannelId, [program])
    }
  }

  const rows: GuideRow[] = channels.map((channel) => ({
    channel,
    programmes: channel.epgChannelId ? byChannel.get(channel.epgChannelId) ?? [] : []
  }))

  return { startsAt, endsAt, rows, totalChannels: rows.length }
}

export function programmesForChannel(epgChannelId: string, from: number, to: number): EpgProgram[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM epg_programs
       WHERE epg_channel_id = ? AND starts_at < ? AND ends_at > ?
       ORDER BY starts_at`
    )
    .all(epgChannelId, to, from) as EpgRow[]
  return rows.map(toProgram)
}

/* ------------------------------------------------------------------ */
/* Guide channel matching                                              */
/* ------------------------------------------------------------------ */

import type { EpgGuideChannel, EpgMatchRow } from '@shared/types'
import { fold } from '../index'

/**
 * The id a channel actually uses for the guide.
 *
 * A manual or automatic correction wins over whatever the provider advertised,
 * and this expression is spliced into every query that joins guide data so the
 * correction cannot be forgotten in one of them.
 */
export const EFFECTIVE_EPG_ID = "COALESCE(NULLIF(ch.epg_override_id, ''), NULLIF(ch.epg_channel_id, ''))"

export function replaceGuideChannels(playlistId: number, channels: EpgGuideChannel[]): number {
  const db = getDb()

  const insert = db.prepare(
    `INSERT INTO epg_channels (playlist_id, epg_channel_id, display_name, name_folded, icon_url)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(playlist_id, epg_channel_id) DO UPDATE SET
       display_name = excluded.display_name,
       name_folded = excluded.name_folded,
       icon_url = excluded.icon_url`
  )

  const write = db.transaction(() => {
    db.prepare('DELETE FROM epg_channels WHERE playlist_id = ?').run(playlistId)
    for (const channel of channels) {
      insert.run(playlistId, channel.epgChannelId, channel.displayName, fold(channel.displayName), channel.iconUrl)
    }
  })
  write()

  return channels.length
}

export function listGuideChannels(playlistId: number): EpgGuideChannel[] {
  return (
    getDb()
      .prepare(
        `SELECT epg_channel_id AS epgChannelId, display_name AS displayName, icon_url AS iconUrl
         FROM epg_channels WHERE playlist_id = ? ORDER BY display_name`
      )
      .all(playlistId) as EpgGuideChannel[]
  )
}

/**
 * Every live channel with its current matching state.
 *
 * `matched` is computed against real programme rows rather than against the
 * channel list, because a feed can declare a channel and then carry no
 * programmes for it — which looks identical to a broken match from the guide.
 */
export function matchRows(playlistId: number, onlyUnmatched: boolean): EpgMatchRow[] {
  const rows = getDb()
    .prepare(
      `SELECT ch.id AS channelId,
              ch.name AS channelName,
              ch.logo_url AS logoUrl,
              NULLIF(ch.epg_channel_id, '') AS providerEpgId,
              NULLIF(ch.epg_override_id, '') AS overrideId,
              ch.epg_override_auto AS overrideAuto,
              gc.display_name AS matchedName,
              CASE WHEN EXISTS (
                SELECT 1 FROM epg_programs p
                WHERE p.playlist_id = ch.playlist_id
                  AND p.epg_channel_id = ${EFFECTIVE_EPG_ID}
              ) THEN 1 ELSE 0 END AS matched
       FROM channels ch
       LEFT JOIN epg_channels gc
              ON gc.playlist_id = ch.playlist_id
             AND gc.epg_channel_id = ${EFFECTIVE_EPG_ID}
       WHERE ch.playlist_id = ? AND ch.kind = 'live' AND ch.hidden = 0
       ORDER BY ch.name_folded`
    )
    .all(playlistId) as (Omit<EpgMatchRow, 'overrideAuto' | 'matched'> & {
    overrideAuto: number
    matched: number
  })[]

  const mapped = rows.map((row) => ({
    ...row,
    overrideAuto: row.overrideAuto === 1,
    matched: row.matched === 1
  }))

  return onlyUnmatched ? mapped.filter((row) => !row.matched) : mapped
}

export function setOverride(channelId: number, epgChannelId: string | null, auto: boolean): void {
  getDb()
    .prepare('UPDATE channels SET epg_override_id = ?, epg_override_auto = ? WHERE id = ?')
    .run(epgChannelId, auto ? 1 : 0, channelId)
}

/** Clears only the matcher's own choices, leaving manual ones intact. */
export function clearAutoOverrides(playlistId: number): number {
  return getDb()
    .prepare(
      `UPDATE channels SET epg_override_id = NULL, epg_override_auto = 0
       WHERE playlist_id = ? AND epg_override_auto = 1`
    )
    .run(playlistId).changes
}
