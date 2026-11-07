/**
 * Reading the metadata a provider puts in a *list* response.
 *
 * Shared between the Xtream and portal clients because the problem is the
 * same in both: browsing twenty thousand films by rating or year needs those
 * values on every row, so they have to be taken from the listing rather than
 * from the per-title detail call, and every provider writes them differently.
 *
 * Kept apart from either client so neither has to import the other.
 */

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * A rating on a 0-10 scale, whatever scale the provider used.
 *
 * Providers send `rating` on either a 5- or a 10-point scale and often send
 * `rating_5based` alongside it. A 5-point value read as a 10-point one turns
 * an excellent film into a middling one, so the two are reconciled rather than
 * whichever arrives first being trusted.
 */
export function vodRating(raw: unknown, fiveBased: unknown): number | null {
  const ten = num(raw)
  const five = num(fiveBased)

  // When both are present and the first really is on the 5-point scale, the
  // provider has told us so by sending the same number twice.
  if (ten !== null && five !== null && Math.abs(ten - five) < 0.01 && ten <= 5) {
    return round1(ten * 2)
  }
  if (ten !== null && ten > 0 && ten <= 10) return round1(ten)
  if (five !== null && five > 0 && five <= 5) return round1(five * 2)
  return null
}

/** A four-digit year, from a year field or the front or back of a date. */
export function vodYear(...values: unknown[]): number | null {
  for (const value of values) {
    const asNumber = num(value)
    if (asNumber !== null && asNumber >= 1870 && asNumber <= 2200) return Math.trunc(asNumber)

    const asText = typeof value === 'string' ? value : null
    const match = asText?.match(/\b(1[89]\d{2}|20\d{2}|21\d{2})\b/)
    if (match) return Number(match[1])
  }
  return null
}

/**
 * When the provider added it, in milliseconds.
 *
 * Xtream sends unix seconds as a string. This is deliberately separate from
 * the row's own `added_at`: ours is when *this installation* first saw the
 * item, which on a first sync is every title at once and sorts by nothing.
 */
export function vodAddedAt(value: unknown): number | null {
  const seconds = num(value)
  if (seconds === null || seconds <= 0) return null
  return seconds > 1e12 ? Math.trunc(seconds) : Math.trunc(seconds * 1000)
}

/**
 * The same thing, for providers that write a date instead of a number.
 *
 * Portals send `added` as `2020-01-31 18:04:00` — local to the portal, with
 * no zone on it. There is nothing to resolve that against, so it is read as
 * UTC: the value is only ever used to sort "recently added" against other
 * rows from the same portal, where a few hours of shared skew changes no
 * ordering. Pretending to know the zone would be a worse answer, not a
 * better one.
 *
 * A bare number is passed through to `vodAddedAt`, because some portals send
 * a timestamp here after all.
 */
export function vodAddedAtText(value: unknown): number | null {
  if (typeof value === 'number') return vodAddedAt(value)
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (trimmed === '' || /^0[\d\- :]*$/.test(trimmed)) return null

  if (/^\d+$/.test(trimmed)) return vodAddedAt(trimmed)

  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/)
  if (!match) return null

  const ms = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4] ?? '0'),
    Number(match[5] ?? '0'),
    Number(match[6] ?? '0')
  )
  return Number.isFinite(ms) ? ms : null
}
