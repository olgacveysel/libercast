import { getDb } from '../index'

/**
 * Alternates the user has said are not the channel they asked for.
 *
 * The matcher cannot settle this on its own. "Alto Sports 2" and "Alto Sports
 * 2 Turkey" differ by one word, exactly like "Alto Sports 2" and "Alto Sports
 * 2 HD" — one is a different region's feed and the other is the same channel,
 * and nothing in the strings says which. The person watching knows, so once
 * they have said it, it is remembered rather than asked again every time their
 * provider has a bad evening.
 */

/** Records that `alternateId` is not the same channel as `channelId`. */
export function rejectAlternate(channelId: number, alternateId: number): void {
  getDb()
    .prepare(
      `INSERT INTO failover_rejects (channel_id, alternate_id, rejected_at)
       VALUES (?, ?, ?)
       ON CONFLICT(channel_id, alternate_id) DO UPDATE SET rejected_at = excluded.rejected_at`
    )
    .run(channelId, alternateId, Date.now())
}

/**
 * Everything refused for this channel.
 *
 * Both directions: the user judged a pair of names, not an ordering, and
 * asking them again with the roles reversed would be the same question.
 */
export function rejectedAlternates(channelId: number): number[] {
  const rows = getDb()
    .prepare(
      `SELECT alternate_id AS other FROM failover_rejects WHERE channel_id = ?
       UNION
       SELECT channel_id AS other FROM failover_rejects WHERE alternate_id = ?`
    )
    .all(channelId, channelId) as { other: number }[]

  return rows.map((row) => row.other)
}

/** Undoes a rejection, for a settings screen that lets someone change their mind. */
export function unrejectAlternate(channelId: number, alternateId: number): void {
  getDb()
    .prepare(
      `DELETE FROM failover_rejects
       WHERE (channel_id = ? AND alternate_id = ?) OR (channel_id = ? AND alternate_id = ?)`
    )
    .run(channelId, alternateId, alternateId, channelId)
}
