import type { EpgReminder, ReminderRequest } from '@shared/types'
import { getDb } from '../index'

interface Row {
  id: number
  channel_id: number
  channel_name: string
  title: string
  starts_at: number
  ends_at: number
  lead_minutes: number
  notified_at: number | null
}

function toReminder(row: Row): EpgReminder {
  return {
    id: row.id,
    channelId: row.channel_id,
    channelName: row.channel_name,
    title: row.title,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    leadMinutes: row.lead_minutes,
    notifiedAt: row.notified_at
  }
}

const SELECT = `
  SELECT r.id, r.channel_id, c.name AS channel_name, r.title,
         r.starts_at, r.ends_at, r.lead_minutes, r.notified_at
  FROM epg_reminders r
  JOIN channels c ON c.id = r.channel_id
`

/**
 * Adds a reminder, or moves an existing one to a new lead time.
 *
 * Asking twice for the same programme is a lead-time change, not a second
 * notification — the alternative is being told about one film three times.
 */
export function addReminder(request: ReminderRequest): EpgReminder {
  const db = getDb()
  const lead = Math.max(0, Math.min(120, Math.round(request.leadMinutes ?? 5)))

  db.prepare(
    `INSERT INTO epg_reminders (channel_id, title, starts_at, ends_at, lead_minutes, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(channel_id, title, starts_at)
     DO UPDATE SET lead_minutes = excluded.lead_minutes, notified_at = NULL`
  ).run(request.channelId, request.title, request.startsAt, request.endsAt, lead, Date.now())

  const row = db
    .prepare(`${SELECT} WHERE r.channel_id = ? AND r.title = ? AND r.starts_at = ?`)
    .get(request.channelId, request.title, request.startsAt) as Row

  return toReminder(row)
}

export function removeReminder(id: number): void {
  getDb().prepare('DELETE FROM epg_reminders WHERE id = ?').run(id)
}

/** Upcoming reminders, soonest first. Past ones are not shown or returned. */
export function listReminders(): EpgReminder[] {
  const rows = getDb()
    .prepare(`${SELECT} WHERE r.ends_at > ? ORDER BY r.starts_at ASC`)
    .all(Date.now()) as Row[]
  return rows.map(toReminder)
}

/** The reminder set on one programme, so the guide can show its state. */
export function findReminder(channelId: number, title: string, startsAt: number): EpgReminder | null {
  const row = getDb()
    .prepare(`${SELECT} WHERE r.channel_id = ? AND r.title = ? AND r.starts_at = ?`)
    .get(channelId, title, startsAt) as Row | undefined
  return row ? toReminder(row) : null
}

/**
 * Reminders whose moment has arrived and which have not been shown.
 *
 * A programme that already started is still worth mentioning — catching the
 * second half beats being told nothing — but one that has finished is not, so
 * those are skipped rather than fired late after the app has been closed.
 */
export function dueReminders(now: number): EpgReminder[] {
  const rows = getDb()
    .prepare(
      `${SELECT}
       WHERE r.notified_at IS NULL
         AND r.starts_at - (r.lead_minutes * 60000) <= ?
         AND r.ends_at > ?
       ORDER BY r.starts_at ASC`
    )
    .all(now, now) as Row[]
  return rows.map(toReminder)
}

export function markNotified(id: number, at = Date.now()): void {
  getDb().prepare('UPDATE epg_reminders SET notified_at = ? WHERE id = ?').run(at, id)
}

/** Clears reminders for programmes that finished, so the table cannot grow forever. */
export function pruneReminders(before = Date.now()): number {
  return getDb().prepare('DELETE FROM epg_reminders WHERE ends_at < ?').run(before).changes
}
