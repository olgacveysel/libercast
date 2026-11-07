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
  folder_id: number | null
  last_synced_at: number | null
  created_at: number
  server_timezone: string | null
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
    folderId: row.folder_id,
    lastSyncedAt: row.last_synced_at,
    createdAt: row.created_at,
    serverTimezone: row.server_timezone
  }
}

/**
 * Records the panel's own timezone, learned from its account report.
 *
 * Kept on the playlist rather than asked for each time: catch-up URLs need it
 * on every play, and asking the panel costs a request it will not thank us for.
 */
export function setServerTimezone(playlistId: number, timezone: string | null): void {
  getDb().prepare('UPDATE playlists SET server_timezone = ? WHERE id = ?').run(timezone, playlistId)
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

/**
 * Moves a source into a folder, or out of every folder when given null.
 *
 * The new position is the end of whatever it joins, not wherever its old
 * sort_order happens to land it. Dropping a source into a folder and finding
 * it third of five is the kind of small wrongness that makes an interface feel
 * unreliable, and "it went where I put it" costs one extra query.
 */
export function setPlaylistFolder(id: number, folderId: number | null): Playlist {
  const db = getDb()

  if (folderId !== null) {
    const exists = db.prepare('SELECT 1 AS ok FROM playlist_folders WHERE id = ?').get(folderId)
    if (!exists) throw new Error(`no folder ${folderId}`)
  }

  const last = db
    .prepare(
      folderId === null
        ? 'SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM playlists WHERE folder_id IS NULL'
        : 'SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM playlists WHERE folder_id = ?'
    )
    .get(...(folderId === null ? [] : [folderId])) as { n: number }

  db.prepare('UPDATE playlists SET folder_id = ?, sort_order = ? WHERE id = ?').run(folderId, last.n, id)

  const playlist = getPlaylist(id)
  if (!playlist) throw new Error(`no playlist ${id}`)
  return playlist
}

/**
 * Rewrites the running order from a list of ids, as reorderFolders does.
 *
 * Order is global rather than per folder: one number, read within whichever
 * group a source is displayed in. Two counters that have to agree is a thing
 * to keep in step forever, and nothing here needs the second one.
 */
export function reorderPlaylists(ids: number[]): Playlist[] {
  const db = getDb()
  const known = new Set(listPlaylists().map((p) => p.id))
  const ordered = ids.filter((id) => known.has(id))
  const rest = [...known].filter((id) => !ordered.includes(id))

  const update = db.prepare('UPDATE playlists SET sort_order = ? WHERE id = ?')
  db.transaction(() => {
    ;[...ordered, ...rest].forEach((id, index) => update.run(index, id))
  })()

  return listPlaylists()
}
