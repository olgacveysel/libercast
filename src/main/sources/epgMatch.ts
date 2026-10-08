/**
 * Matching provider channels to XMLTV guide channels.
 *
 * The guide only works when a channel's `tvg-id` equals an id in the XMLTV
 * feed. Providers get this wrong constantly — empty ids, ids that changed, or a
 * feed from a different source entirely — and the symptom is an empty guide
 * with nothing to explain it. When the ids do not line up, names are the only
 * thing left to match on.
 */

export interface EpgCandidate {
  epgChannelId: string
  displayName: string
}

export interface MatchResult {
  epgChannelId: string
  displayName: string
  /** 0..1. Above ACCEPT_SCORE the match is applied without asking. */
  score: number
}

/**
 * Words that describe the feed rather than the channel. "Sky Sports HD" and
 * "Sky Sports FHD" are the same channel, so these are dropped before comparing.
 */
const NOISE = new Set([
  'hd',
  'fhd',
  'uhd',
  'sd',
  'hq',
  '4k',
  '8k',
  '1080',
  '1080p',
  '720',
  '720p',
  '576p',
  '480p',
  'hevc',
  'h264',
  'h265',
  'x264',
  'x265',
  'raw',
  'backup',
  'alt',
  'vip',
  'multi',
  'fps',
  '50fps',
  '60fps',
  'tv',
  'channel',
  'kanal'
])

/**
 * Words that introduce a *feed* number rather than a channel number. Providers
 * label duplicate streams "beIN Sports 2 (Hat 1)" — Turkish for line 1 — and
 * the 1 there says nothing about which channel it is. Both the word and the
 * number that follows it are dropped, otherwise the digit rule below reads that
 * 1 as part of the channel's identity and refuses every correct match.
 */
const FEED_QUALIFIERS = new Set([
  'hat',
  'line',
  'opt',
  'option',
  'alt',
  'backup',
  'yedek',
  'server',
  'src',
  'source',
  'feed',
  'stream',
  'mirror'
])

/** Bracketed or piped qualifiers: "beIN Sports 2 (Hat 1)", "TR | beIN 2". */
const SEPARATORS = /[|/\\[\](){}:;,_]+/g

/**
 * Reduces a channel name to the tokens that identify it.
 *
 * Digits are kept and matter: "beIN Sports 2" and "beIN Sports 4" differ by one
 * character and must never be treated as the same channel.
 */
export function normalizeName(value: string): string[] {
  const raw = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(SEPARATORS, ' ')
    .replace(/[^a-z0-9\s+]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 0)

  const tokens: string[] = []
  for (let i = 0; i < raw.length; i++) {
    const token = raw[i]!

    if (FEED_QUALIFIERS.has(token)) {
      // Skip the qualifier, and the number after it when there is one.
      if (i + 1 < raw.length && /^\d+$/.test(raw[i + 1]!)) i += 1
      continue
    }

    if (!NOISE.has(token)) tokens.push(token)
  }

  return tokens
}

export function normalizedKey(value: string): string {
  return normalizeName(value).join(' ')
}

/** Character bigrams, used for the fallback similarity score. */
function bigrams(value: string): Set<string> {
  const set = new Set<string>()
  const text = value.replace(/\s+/g, '')
  for (let i = 0; i < text.length - 1; i++) set.add(text.slice(i, i + 2))
  return set
}

/** Sørensen–Dice coefficient: shared bigrams over the total, 0..1. */
export function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1
  const left = bigrams(a)
  const right = bigrams(b)
  if (left.size === 0 || right.size === 0) return 0

  let shared = 0
  for (const gram of left) if (right.has(gram)) shared += 1
  return (2 * shared) / (left.size + right.size)
}

/**
 * How alike two channel names are.
 *
 * The digit rule comes first and overrides everything: if both names contain
 * numbers and those numbers differ, they are different channels no matter how
 * similar the words are. Without it "beIN Sports 2" happily matches "beIN
 * Sports 4", which is worse than no guide at all.
 */
export function similarity(a: string, b: string): number {
  const left = normalizeName(a)
  const right = normalizeName(b)
  if (left.length === 0 || right.length === 0) return 0

  const leftDigits = left.filter((token) => /\d/.test(token)).join(' ')
  const rightDigits = right.filter((token) => /\d/.test(token)).join(' ')
  if (leftDigits !== '' && rightDigits !== '' && leftDigits !== rightDigits) return 0

  const leftKey = left.join(' ')
  const rightKey = right.join(' ')
  if (leftKey === rightKey) return 1

  const leftSet = new Set(left)
  const rightSet = new Set(right)

  let shared = 0
  for (const token of leftSet) if (rightSet.has(token)) shared += 1

  // One name being a complete subset of the other is a strong signal:
  // "beIN Sports 2" inside "beIN Sports 2 Turkey".
  const smaller = Math.min(leftSet.size, rightSet.size)
  if (shared === smaller && smaller > 0) {
    const coverage = shared / Math.max(leftSet.size, rightSet.size)
    return 0.8 + 0.2 * coverage
  }

  const jaccard = shared / (leftSet.size + rightSet.size - shared)
  const dice = diceCoefficient(leftKey, rightKey)

  // Token overlap and character similarity disagree in different ways — the
  // first misses spelling variants, the second misses word order — so the
  // score leans on whichever is more confident.
  return Math.max(jaccard, dice * 0.9)
}

/** At or above this, a match is applied without asking the user. */
export const ACCEPT_SCORE = 0.82

/**
 * The best candidate must beat the runner-up by this much. Two channels scoring
 * 0.84 and 0.83 means the name is ambiguous, and guessing there produces a
 * guide that is confidently wrong — worse to debug than one that is empty.
 */
export const AMBIGUITY_MARGIN = 0.06

export function bestMatch(name: string, candidates: EpgCandidate[]): MatchResult | null {
  let best: MatchResult | null = null
  let runnerUp = 0

  for (const candidate of candidates) {
    const score = similarity(name, candidate.displayName)
    if (score <= 0) continue

    if (!best || score > best.score) {
      if (best) runnerUp = best.score
      best = { epgChannelId: candidate.epgChannelId, displayName: candidate.displayName, score }
    } else if (score > runnerUp) {
      runnerUp = score
    }
  }

  if (!best) return null

  // A perfect match cannot be ambiguous, however many others tie with it.
  if (best.score < 1 && best.score - runnerUp < AMBIGUITY_MARGIN) return null

  return best
}

/** Candidates ordered by how well they match, for the manual override list. */
export function rankCandidates(
  name: string,
  candidates: EpgCandidate[],
  limit = 20
): MatchResult[] {
  return candidates
    .map((candidate) => ({
      epgChannelId: candidate.epgChannelId,
      displayName: candidate.displayName,
      score: similarity(name, candidate.displayName)
    }))
    .filter((result) => result.score > 0.1)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}
