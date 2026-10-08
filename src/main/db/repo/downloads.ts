import type { Download, DownloadStatus, ProgressItemType } from '@shared/types'
import { getDb } from '../index'

interface DownloadRow {
  id: number
  item_type: ProgressItemType
  item_id: number
  channel_id: number | null
  playlist_id: number | null
  title: string
  subtitle: string | null
  poster_url: string | null
  file_path: string | null
  status: DownloadStatus
  error: string | null
  bytes_total: number
  bytes_done: number
  created_at: number
  finished_at: number | null
}

function toDownload(row: DownloadRow): Download {
  return {
    id: row.id,
    itemType: row.item_type,
    itemId: row.item_id,
    channelId: row.channel_id,
    playlistId: row.playlist_id,
    title: row.title,
    subtitle: row.subtitle,
    posterUrl: row.poster_url,
    filePath: row.file_path,
    status: row.status,
    error: row.error,
    bytesTotal: row.bytes_total,
    bytesDone: row.bytes_done,
    createdAt: row.created_at,
    finishedAt: row.finished_at
  }
}

export function createDownload(input: {
  itemType: ProgressItemType
  itemId: number
  channelId: number
  playlistId: number
  title: string
  subtitle: string | null
  posterUrl: string | null
}): Download {
  const db = getDb()

  // One row per item. Queueing something already downloaded, or already in the
  // queue, revives that row rather than creating a duplicate file on disk.
  const existing = getByItem(input.itemType, input.itemId)
  if (existing) {
    if (existing.status === 'completed') return existing
    return (
      updateDownload(existing.id, { status: 'queued', error: null, finishedAt: null }) ?? existing
    )
  }

  const info = db
    .prepare(
      `INSERT INTO downloads
         (item_type, item_id, channel_id, playlist_id, title, subtitle, poster_url, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?)`
    )
    .run(
      input.itemType,
      input.itemId,
      input.channelId,
      input.playlistId,
      input.title,
      input.subtitle,
      input.posterUrl,
      Date.now()
    )

  const created = getDownload(Number(info.lastInsertRowid))
  if (!created) throw new Error('Download insert did not return a row')
  return created
}

export function getDownload(id: number): Download | null {
  const row = getDb().prepare('SELECT * FROM downloads WHERE id = ?').get(id) as DownloadRow | undefined
  return row ? toDownload(row) : null
}

export function getByItem(itemType: ProgressItemType, itemId: number): Download | null {
  const row = getDb()
    .prepare('SELECT * FROM downloads WHERE item_type = ? AND item_id = ?')
    .get(itemType, itemId) as DownloadRow | undefined
  return row ? toDownload(row) : null
}

export function listDownloads(): Download[] {
  return getDb()
    .prepare(
      `SELECT * FROM downloads
       ORDER BY
         CASE status
           WHEN 'downloading' THEN 0
           WHEN 'queued'      THEN 1
           WHEN 'paused'      THEN 2
           ELSE 3
         END,
         created_at DESC`
    )
    .all()
    .map((r) => toDownload(r as DownloadRow))
}

/** The oldest queued rows, up to `limit`, for the queue runner to pick up. */
export function nextQueued(limit: number): Download[] {
  return getDb()
    .prepare(`SELECT * FROM downloads WHERE status = 'queued' ORDER BY created_at LIMIT ?`)
    .all(limit)
    .map((r) => toDownload(r as DownloadRow))
}

export function countRunning(): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM downloads WHERE status = 'downloading'`)
    .get() as { n: number }
  return row.n
}

export function updateDownload(
  id: number,
  patch: Partial<{
    status: DownloadStatus
    filePath: string | null
    error: string | null
    bytesTotal: number
    bytesDone: number
    finishedAt: number | null
  }>
): Download | null {
  const columns: Record<string, string> = {
    status: 'status',
    filePath: 'file_path',
    error: 'error',
    bytesTotal: 'bytes_total',
    bytesDone: 'bytes_done',
    finishedAt: 'finished_at'
  }

  const sets: string[] = []
  const values: unknown[] = []

  for (const [field, column] of Object.entries(columns)) {
    const value = (patch as Record<string, unknown>)[field]
    if (value === undefined) continue
    sets.push(`${column} = ?`)
    values.push(value)
  }

  if (sets.length > 0) {
    values.push(id)
    getDb().prepare(`UPDATE downloads SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  }

  return getDownload(id)
}

export function removeDownload(id: number): void {
  getDb().prepare('DELETE FROM downloads WHERE id = ?').run(id)
}

/**
 * A crash leaves rows marked as downloading with no process behind them.
 * They are moved back to paused rather than failed, because the partial file is
 * still on disk and resuming from it is exactly what should happen next.
 */
export function reconcileOnStartup(): number {
  return getDb()
    .prepare(`UPDATE downloads SET status = 'paused' WHERE status IN ('downloading', 'queued')`)
    .run().changes
}

/** File paths of finished downloads, so playback can prefer the local copy. */
export function completedPaths(): Map<string, string> {
  const rows = getDb()
    .prepare(`SELECT item_type, item_id, file_path FROM downloads WHERE status = 'completed' AND file_path IS NOT NULL`)
    .all() as { item_type: string; item_id: number; file_path: string }[]

  return new Map(rows.map((row) => [`${row.item_type}:${row.item_id}`, row.file_path]))
}
