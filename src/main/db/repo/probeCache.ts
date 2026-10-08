import { getDb } from '../index'

/**
 * Remembers what ffprobe found, between runs of the app.
 *
 * Every playback costs two connections to the provider in quick succession:
 * ffprobe to identify the stream, then ffmpeg to play it. On an account that
 * allows one at a time — which is most of them — the second request is the one
 * that gets refused, and the symptom is a channel that opens sometimes.
 *
 * A film's codecs do not change, so the second and later plays of anything can
 * skip the probe entirely and spend a single connection. Only the first play
 * of each item pays for two.
 */

/** A film is what it is. Live can be re-encoded by the provider at any time. */
const VOD_TTL_MS = 30 * 24 * 3600_000
const LIVE_TTL_MS = 12 * 3600_000

export function readProbe<T>(key: string): T | null {
  const row = getDb()
    .prepare('SELECT payload, is_live, updated_at FROM stream_probes WHERE key = ?')
    .get(key) as { payload: string; is_live: number; updated_at: number } | undefined

  if (!row) return null

  const ttl = row.is_live === 1 ? LIVE_TTL_MS : VOD_TTL_MS
  if (Date.now() - row.updated_at > ttl) return null

  try {
    return JSON.parse(row.payload) as T
  } catch {
    // A corrupt row must not stop playback; it will be overwritten below.
    return null
  }
}

export function writeProbe(key: string, value: unknown, isLive: boolean): void {
  getDb()
    .prepare(
      `INSERT INTO stream_probes (key, payload, is_live, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         payload = excluded.payload,
         is_live = excluded.is_live,
         updated_at = excluded.updated_at`
    )
    .run(key, JSON.stringify(value), isLive ? 1 : 0, Date.now())
}

/** Forgets one entry, after the stream turned out not to match what was stored. */
export function forgetProbe(key: string): void {
  getDb().prepare('DELETE FROM stream_probes WHERE key = ?').run(key)
}

/** Drops entries nothing will read again. Called after a sync. */
export function pruneProbes(): number {
  const now = Date.now()
  return getDb()
    .prepare(
      `DELETE FROM stream_probes
       WHERE (is_live = 1 AND updated_at < ?) OR (is_live = 0 AND updated_at < ?)`
    )
    .run(now - LIVE_TTL_MS, now - VOD_TTL_MS).changes
}
