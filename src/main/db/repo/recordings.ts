import type { Recording, RecordingStatus } from '@shared/types'
import { getDb } from '../index'

interface RecordingRow {
  id: number
  channel_id: number | null
  playlist_id: number | null
  title: string
  channel_name: string
  file_path: string | null
  status: RecordingStatus
  error: string | null
  starts_at: number
  ends_at: number
  started_at: number | null
  finished_at: number | null
  bytes: number
  created_at: number
}

function toRecording(row: RecordingRow): Recording {
  return {
    id: row.id,
    channelId: row.channel_id,
    playlistId: row.playlist_id,
    title: row.title,
    channelName: row.channel_name,
    filePath: row.file_path,
    status: row.status,
    error: row.error,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    bytes: row.bytes,
    createdAt: row.created_at
  }
}

export function createRecording(input: {
  channelId: number
  playlistId: number
  title: string
  channelName: string
  startsAt: number
  endsAt: number
  status: RecordingStatus
}): Recording {
  const info = getDb()
    .prepare(
      `INSERT INTO recordings
         (channel_id, playlist_id, title, channel_name, status, starts_at, ends_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.channelId,
      input.playlistId,
      input.title,
      input.channelName,
      input.status,
      input.startsAt,
      input.endsAt,
      Date.now()
    )

  const created = getRecording(Number(info.lastInsertRowid))
  if (!created) throw new Error('Recording insert did not return a row')
  return created
}

export function getRecording(id: number): Recording | null {
  const row = getDb().prepare('SELECT * FROM recordings WHERE id = ?').get(id) as RecordingRow | undefined
  return row ? toRecording(row) : null
}

export function listRecordings(): Recording[] {
  return getDb()
    .prepare(
      `SELECT * FROM recordings
       ORDER BY
         CASE status
           WHEN 'recording' THEN 0
           WHEN 'scheduled' THEN 1
           ELSE 2
         END,
         starts_at DESC`
    )
    .all()
    .map((r) => toRecording(r as RecordingRow))
}

/** Scheduled recordings whose start time has arrived. */
export function dueRecordings(now: number): Recording[] {
  return getDb()
    .prepare(`SELECT * FROM recordings WHERE status = 'scheduled' AND starts_at <= ? AND ends_at > ?`)
    .all(now, now)
    .map((r) => toRecording(r as RecordingRow))
}

/** Scheduled recordings whose whole window elapsed while the app was closed. */
export function missedRecordings(now: number): Recording[] {
  return getDb()
    .prepare(`SELECT * FROM recordings WHERE status = 'scheduled' AND ends_at <= ?`)
    .all(now)
    .map((r) => toRecording(r as RecordingRow))
}

export function activeRecordings(): Recording[] {
  return getDb()
    .prepare(`SELECT * FROM recordings WHERE status = 'recording'`)
    .all()
    .map((r) => toRecording(r as RecordingRow))
}

export function updateRecording(
  id: number,
  patch: Partial<{
    status: RecordingStatus
    filePath: string | null
    error: string | null
    startedAt: number | null
    finishedAt: number | null
    endsAt: number
    bytes: number
  }>
): Recording | null {
  const columns: Record<string, string> = {
    status: 'status',
    filePath: 'file_path',
    error: 'error',
    startedAt: 'started_at',
    finishedAt: 'finished_at',
    endsAt: 'ends_at',
    bytes: 'bytes'
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
    getDb().prepare(`UPDATE recordings SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  }

  return getRecording(id)
}

export function removeRecording(id: number): void {
  getDb().prepare('DELETE FROM recordings WHERE id = ?').run(id)
}

/**
 * A crash leaves rows stuck in 'recording'. Anything still in that state at
 * startup is orphaned, since no ffmpeg process survived the restart.
 */
export function reconcileOnStartup(): number {
  const info = getDb()
    .prepare(
      `UPDATE recordings
       SET status = 'failed', error = 'Interrupted — the app closed while recording', finished_at = ?
       WHERE status = 'recording'`
    )
    .run(Date.now())
  return info.changes
}

export function clashesWith(channelId: number, startsAt: number, endsAt: number): Recording | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM recordings
       WHERE channel_id = ? AND status IN ('scheduled','recording')
         AND starts_at < ? AND ends_at > ?
       LIMIT 1`
    )
    .get(channelId, endsAt, startsAt) as RecordingRow | undefined
  return row ? toRecording(row) : null
}
