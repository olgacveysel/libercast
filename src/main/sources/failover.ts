import { fold, getDb } from '@main/db/index'
import { rejectedAlternates } from '@main/db/repo/failoverRejects'
import { createLogger } from '@main/util/logger'
import { normalizeName, sameChannelName, similarity } from './epgMatch'

const log = createLogger('failover')

/**
 * The same channel, as another of the user's providers carries it.
 *
 * Failover exists because one account dying mid-match is the single most
 * common thing that goes wrong with IPTV, and the user very often already pays
 * for a second source that is carrying the same match.
 */
/**
 * How sure we are that an alternate is the same channel.
 *
 * `exact` means the identifying words are identical — only the feed
 * description differs, so it can be played without interrupting anyone.
 * `likely` means the name cleared the score threshold by looking similar, and
 * "looking similar" is how you end up watching a different region's feed. The
 * two are kept apart because they deserve different treatment, not because the
 * score is unreliable.
 */
export type MatchConfidence = 'exact' | 'likely'

export interface Alternate {
  channelId: number
  playlistId: number
  playlistName: string
  name: string
  /** How confident the name match is, 0..1. */
  score: number
  confidence: MatchConfidence
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
 * The digit rule inside `similarity` does the heavy lifting: "Alto Sports 2"
 * scores zero against "Alto Sports 4", so a failover can never land on the
 * wrong match of the same competition — which would be worse than no picture.
 */
/**
 * How close a candidate has to get before it is worth reporting as a near miss.
 *
 * `MIN_SCORE` cannot be tuned from a desk: whether 0.86 is right depends
 * entirely on how two particular providers spell things, and the only evidence
 * is what it is turning away on a real pair of lists. Anything in this band
 * was recognisably the same channel to the matcher and still refused, which is
 * exactly the list someone needs in order to say "that threshold is too high".
 */
export const NEAR_MISS_SCORE = 0.7

export interface RankResult {
  accepted: Alternate[]
  /** Scored well, but not well enough to play. Reported, never used. */
  nearMisses: Alternate[]
}

export function rankAlternatesDetailed(
  name: string,
  candidates: readonly AlternateCandidate[],
  exclude: readonly number[] = []
): RankResult {
  const skip = new Set(exclude)

  const scored = candidates
    .filter((candidate) => !skip.has(candidate.channelId))
    .map((candidate) => ({
      ...candidate,
      score: similarity(name, candidate.name),
      confidence: (sameChannelName(name, candidate.name) ? 'exact' : 'likely') as MatchConfidence
    }))
    .sort((a, b) =>
      // Certainty before score: an exact match that scores 1.00 and a regional
      // variant that scores 0.95 are not two points on one scale, and the
      // caller plays the first thing in this list that it is allowed to play.
      rank(a) - rank(b) ||
      // Then score; then a stable order, so the same provider is tried first
      // every time rather than shuffling between attempts.
      b.score - a.score ||
      a.playlistId - b.playlistId ||
      a.channelId - b.channelId
    )

  return {
    accepted: scored.filter((candidate) => candidate.score >= MIN_SCORE),
    nearMisses: scored.filter(
      (candidate) => candidate.score >= NEAR_MISS_SCORE && candidate.score < MIN_SCORE
    )
  }
}

export function rankAlternates(
  name: string,
  candidates: readonly AlternateCandidate[],
  exclude: readonly number[] = []
): Alternate[] {
  return rankAlternatesDetailed(name, candidates, exclude).accepted
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

/** Exact matches first; within a confidence, the usual ordering. */
function rank(candidate: { confidence: MatchConfidence }): number {
  return candidate.confidence === 'exact' ? 0 : 1
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

  // A channel the user has already said is not this one is not a candidate,
  // however well it scores — the whole point of having been asked.
  const refused = rejectedAlternates(channelId)
  const skip = refused.length > 0 ? [...exclude, ...refused] : exclude

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

  const { accepted, nearMisses } = rankAlternatesDetailed(
    self.name,
    rows.map((row) => ({
      channelId: row.id,
      playlistId: row.playlist_id,
      playlistName: row.playlist_name,
      name: row.name
    })),
    skip
  )

  // Logged, not used. The threshold is a judgement about someone else's naming
  // conventions, and this is the only way to find out whether it is the right
  // one for a particular pair of lists without guessing.
  if (accepted.length === 0 && nearMisses.length > 0) {
    const listed = nearMisses
      .slice(0, 3)
      .map((candidate) => `"${candidate.name}" (${candidate.score.toFixed(2)}, ${candidate.playlistName})`)
      .join(', ')
    log.info(
      `no alternate for "${self.name}" cleared ${MIN_SCORE}; closest was ${listed}`
    )
  }

  return accepted
}
