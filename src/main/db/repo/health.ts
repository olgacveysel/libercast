import type { ChannelHealth } from '@shared/types'
import { getDb } from '../index'

/**
 * How long a scan result is worth showing.
 *
 * A channel that was dead last week says nothing about today — provider lists
 * rot in both directions, and a stale red mark on a channel that works again
 * is worse than no mark at all, because it stops the user trying it. A week is
 * about how long one of these lists stays the same.
 */
export const HEALTH_TTL_MS = 7 * 24 * 60 * 60 * 1000

interface Row {
  channel_id: number
  ok: number
  reason: string | null
  checked_at: number
}

export function recordHealth(results: readonly ChannelHealth[]): void {
  if (results.length === 0) return

  const db = getDb()
  const upsert = db.prepare(
    `INSERT INTO channel_health (channel_id, ok, reason, checked_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(channel_id) DO UPDATE SET
       ok = excluded.ok, reason = excluded.reason, checked_at = excluded.checked_at`
  )

  // One transaction: a scan of thirty favourites is thirty writes, and a crash
  // partway through should not leave half a verdict.
  db.transaction(() => {
    for (const result of results) {
      upsert.run(result.channelId, result.ok ? 1 : 0, result.reason, result.checkedAt)
    }
  })()
}

/** Fresh results for the given channels, keyed by channel id. */
export function healthFor(channelIds: readonly number[]): Map<number, ChannelHealth> {
  const map = new Map<number, ChannelHealth>()
  if (channelIds.length === 0) return map

  const cutoff = Date.now() - HEALTH_TTL_MS
  const rows = getDb()
    .prepare(
      `SELECT h.channel_id, h.ok, h.reason, h.checked_at
       FROM channel_health h
       WHERE h.channel_id IN (${channelIds.map(() => '?').join(',')}) AND h.checked_at >= ?`
    )
    .all(...channelIds, cutoff) as Row[]

  for (const row of rows) {
    map.set(row.channel_id, {
      channelId: row.channel_id,
      // The name is the caller's to supply: it has the channel row already,
      // and storing a second copy here would let the two drift apart after a
      // provider renames something.
      name: '',
      ok: row.ok === 1,
      reason: row.reason,
      checkedAt: row.checked_at
    })
  }

  return map
}

/** Drops results nobody will be shown again. */
export function pruneHealth(): number {
  return getDb()
    .prepare('DELETE FROM channel_health WHERE checked_at < ?')
    .run(Date.now() - HEALTH_TTL_MS).changes
}

/** Forgets one channel's verdict — used when it plays after all. */
export function clearHealth(channelId: number): void {
  getDb().prepare('DELETE FROM channel_health WHERE channel_id = ?').run(channelId)
}
