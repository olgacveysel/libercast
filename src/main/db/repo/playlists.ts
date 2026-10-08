import type { Playlist, PlaylistDraft } from '@shared/types'
import { getDb } from '../index'

interface PlaylistRow {
  id: number
  name: string
  kind: Playlist['kind']
  url: string
  file_path: string | null
  username: string | null
  mac_address: string | null
  epg_url: string | null
  epg_offset_min: number
  user_agent: string | null
  referrer: string | null
  enabled: number
  sort_order: number
  last_synced_at: number | null
  created_at: number
}

function toPlaylist(row: PlaylistRow): Playlist {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    url: row.url,
    filePath: row.file_path,
    username: row.username,
    macAddress: row.mac_address,
    epgUrl: row.epg_url,
    epgOffsetMinutes: row.epg_offset_min,
    userAgent: row.user_agent,
    referrer: row.referrer,
    enabled: row.enabled === 1,
    sortOrder: row.sort_order,
    lastSyncedAt: row.last_synced_at,
    createdAt: row.created_at
  }
}

export function listPlaylists(): Playlist[] {
  return getDb()
    .prepare('SELECT * FROM playlists ORDER BY sort_order, id')
    .all()
    .map((r) => toPlaylist(r as PlaylistRow))
}

export function getPlaylist(id: number): Playlist | null {
  const row = getDb().prepare('SELECT * FROM playlists WHERE id = ?').get(id) as PlaylistRow | undefined
  return row ? toPlaylist(row) : null
}

export function createPlaylist(draft: PlaylistDraft): Playlist {
  const db = getDb()
  const next = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM playlists').get() as { n: number }

  const info = db
    .prepare(
      `INSERT INTO playlists
         (name, kind, url, file_path, username, mac_address, epg_url, epg_offset_min,
          user_agent, referrer, enabled, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    )
    .run(
      draft.name,
      draft.kind,
      draft.url ?? '',
      draft.filePath ?? null,
      draft.username ?? null,
      draft.macAddress ?? null,
      draft.epgUrl ?? null,
      draft.epgOffsetMinutes ?? 0,
      draft.userAgent ?? null,
      draft.referrer ?? null,
      next.n,
      Date.now()
    )

  const created = getPlaylist(Number(info.lastInsertRowid))
  if (!created) throw new Error('Playlist insert did not return a row')
  return created
}

const COLUMN_BY_FIELD: Record<string, string> = {
  name: 'name',
  url: 'url',
  filePath: 'file_path',
  username: 'username',
  macAddress: 'mac_address',
  epgUrl: 'epg_url',
  epgOffsetMinutes: 'epg_offset_min',
  userAgent: 'user_agent',
  referrer: 'referrer'
}

export function updatePlaylist(id: number, patch: Partial<PlaylistDraft>): Playlist {
  const sets: string[] = []
  const values: unknown[] = []

  for (const [field, column] of Object.entries(COLUMN_BY_FIELD)) {
    const value = (patch as Record<string, unknown>)[field]
    if (value === undefined) continue
    sets.push(`${column} = ?`)
    values.push(value)
  }

  if (sets.length > 0) {
    values.push(id)
    getDb().prepare(`UPDATE playlists SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  }

  const updated = getPlaylist(id)
  if (!updated) throw new Error(`Playlist ${id} not found`)
  return updated
}

export function removePlaylist(id: number): void {
  getDb().prepare('DELETE FROM playlists WHERE id = ?').run(id)
}

export function markSynced(id: number): void {
  getDb().prepare('UPDATE playlists SET last_synced_at = ? WHERE id = ?').run(Date.now(), id)
}
