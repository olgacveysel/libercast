/**
 * Replaying a programme that has already been broadcast.
 *
 * Xtream panels keep a rolling archive of some channels and expose it through
 * a URL carrying a start time and a length in minutes. Everything awkward
 * about it is in here: the panel's own timestamp format, its insistence on
 * wall-clock time in its own timezone, and the question of whether a given
 * programme is still inside the window at all.
 */

export interface Replayable {
  startsAt: number
  endsAt: number
}

/** Two digits, because the panel's parser is not forgiving about one. */
function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

/**
 * The start stamp panels expect: `YYYY-MM-DD:HH-MM`.
 *
 * Not ISO 8601, not a Unix time, and not anything a date library emits — a
 * format of the panel's own invention, with a colon where the time begins and
 * a hyphen inside it.
 *
 * It is wall-clock time *on the server*. `timeZone` is the panel's own, as it
 * reported it; without one the viewer's clock is used, which is right whenever
 * the two are in the same place and is the best guess available when they are
 * not.
 */
export function formatStart(at: number | Date, timeZone?: string | null): string {
  const date = at instanceof Date ? at : new Date(at)
  if (Number.isNaN(date.getTime())) throw new Error('Invalid catch-up start time')

  const parts = partsIn(date, timeZone)
  return (
    `${parts.year}-${pad(parts.month)}-${pad(parts.day)}:` + `${pad(parts.hour)}-${pad(parts.minute)}`
  )
}

interface Parts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

function partsIn(date: Date, timeZone?: string | null): Parts {
  if (!timeZone) {
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hour: date.getHours(),
      minute: date.getMinutes()
    }
  }

  try {
    // `en-CA` gives ISO-ordered numeric parts, which is the least surprising
    // base to read fields out of.
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    })

    const found: Record<string, string> = {}
    for (const part of formatter.formatToParts(date)) found[part.type] = part.value

    return {
      year: Number(found.year),
      month: Number(found.month),
      day: Number(found.day),
      hour: Number(found.hour),
      minute: Number(found.minute)
    }
  } catch {
    // A panel reporting a timezone this engine has never heard of must not
    // stop catch-up working; the viewer's clock is the better of the two
    // remaining options.
    return partsIn(date, null)
  }
}

/**
 * The length to ask for, in whole minutes.
 *
 * Rounded up, and with a minute added: panels cut the recording at exactly the
 * length requested, and a programme that starts a few seconds late — which is
 * every programme — would otherwise lose its ending.
 */
export function durationMinutes(programme: Replayable): number {
  const span = programme.endsAt - programme.startsAt
  if (!Number.isFinite(span) || span <= 0) return 1
  return Math.max(1, Math.ceil(span / 60_000) + 1)
}

/** How far back a channel can be replayed, in milliseconds. */
export function catchupWindowMs(catchupDays: number): number {
  if (!Number.isFinite(catchupDays) || catchupDays <= 0) return 0
  return Math.trunc(catchupDays) * 24 * 60 * 60 * 1000
}

/**
 * Whether this programme can actually be replayed right now.
 *
 * Three things have to be true, and the third is the one worth being careful
 * about: the channel has an archive, the programme has finished, and it began
 * inside the window the provider keeps. Offering a replay the panel will
 * refuse spends a connection to learn what the listing already said.
 */
export function canReplay(
  programme: Replayable,
  catchupDays: number,
  now = Date.now()
): boolean {
  const window = catchupWindowMs(catchupDays)
  if (window === 0) return false
  if (programme.endsAt > now) return false

  return programme.startsAt >= now - window
}

/**
 * Whether a programme is on now, which is live rather than catch-up.
 *
 * Kept here beside `canReplay` so the two cannot drift into both being true
 * for the same programme.
 */
export function isOnNow(programme: Replayable, now = Date.now()): boolean {
  return programme.startsAt <= now && programme.endsAt > now
}
