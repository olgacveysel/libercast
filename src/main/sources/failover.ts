import { fold, getDb } from '@main/db/index'
import { normalizeName, similarity } from './epgMatch'

/**
 * The same channel, as another of the user's providers carries it.
 *
 * Failover exists because one account dying mid-match is the single most
 * common thing that goes wrong with IPTV, and the user very often already pays
 * for a second source that is carrying the same match.
 */
export interface Alternate {
  channelId: number
  playlistId: number
  playlistName: string
  name: string
  /** How confident the name match is, 0..1. */
  score: number
}

export interface AlternateCandidate {
  channelId: number
  playlistId: number
  playlistName: string
  name: string
}

/**
 * How alike two names must be before one channel is played in place of
 * another.
 *
 * Higher than the guide matcher's threshold on purpose. A wrong guide entry is
 * an annoyance you can see and correct; silently playing the wrong match
 * because the names were vaguely similar is the kind of failure that makes
 * someone stop trusting the application altogether.
 */
export const MIN_SCORE = 0.86

/**
 * Ranks candidates from other providers against the channel being played.
 *
 * The digit rule inside `similarity` does the heavy lifting: "beIN Sports 2"
 * scores zero against "beIN Sports 4", so a failover can never land on the
 * wrong match of the same competition — which would be worse than no picture.
 */
export function rankAlternates(
  name: string,
  candidates: readonly AlternateCandidate[],
  exclude: readonly number[] = []
): Alternate[] {
  const skip = new Set(exclude)

  return candidates
    .filter((candidate) => !skip.has(candidate.channelId))
    .map((candidate) => ({ ...candidate, score: similarity(name, candidate.name) }))
    .filter((candidate) => candidate.score >= MIN_SCORE)
    .sort((a, b) =>
      // Score first; then a stable order, so the same provider is tried first
      // every time rather than shuffling between attempts.
      b.score - a.score || a.playlistId - b.playlistId || a.channelId - b.channelId
    )
}

/**
 * The SQL narrowing term for a channel name.
 *
 * Scoring every channel of every other provider would mean reading tens of
 * thousands of rows for each failover, so the longest identifying word — the
 * one most likely to be spelled the same by both providers — narrows it first
 * against the folded-name index. Names made only of short words (a bare "TV 5")
 * have nothing worth narrowing on and return null, which means "score them all".
 */
export function narrowingTerm(name: string): string | null {
  const words = normalizeName(name)
    .filter((token) => !/^\d+$/.test(token) && token.length >= 4)
    .sort((a, b) => b.length - a.length)

  return words[0] ?? null
}

interface Row {
  id: number
  playlist_id: number
  playlist_name: string
  name: string
}

/** How many rows per other provider are worth scoring. */
const SCAN_LIMIT = 300

/**
 * Every other provider's version of this channel, best first.
 *
 * Hidden channels are left out: the user hid them, and a failover is not a
 * reason to put them back on screen.
 */
export function findAlternates(channelId: number, exclude: readonly number[] = []): Alternate[] {
  const db = getDb()

  const self = db
    .prepare('SELECT id, playlist_id, name, kind FROM channels WHERE id = ?')
    .get(channelId) as { id: number; playlist_id: number; name: string; kind: string } | undefined
  if (!self) return []

  const term = narrowingTerm(self.name)
  const clauses = [
    'ch.playlist_id != ?',
    'ch.kind = ?',
    'ch.hidden = 0',
    'ch.stream_url IS NOT NULL'
  ]
  const params: unknown[] = [self.playlist_id, self.kind]

  if (term !== null) {
    clauses.push('ch.name_folded LIKE ?')
    params.push(`%${fold(term)}%`)
  }

  const rows = db
    .prepare(
      `SELECT ch.id, ch.playlist_id, p.name AS playlist_name, ch.name
       FROM channels ch
       JOIN playlists p ON p.id = ch.playlist_id
       WHERE ${clauses.join(' AND ')}
       LIMIT ?`
    )
    .all(...params, SCAN_LIMIT) as Row[]

  return rankAlternates(
    self.name,
    rows.map((row) => ({
      channelId: row.id,
      playlistId: row.playlist_id,
      playlistName: row.playlist_name,
      name: row.name
    })),
    exclude
  )
}
