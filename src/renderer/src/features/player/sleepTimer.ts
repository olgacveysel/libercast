/**
 * The sleep timer.
 *
 * Kept apart from the component that draws it so the arithmetic — which is all
 * this really is — can be checked without a clock or a DOM.
 */

/** What the menu offers, in minutes. */
export const SLEEP_OPTIONS = [15, 30, 45, 60, 90, 120]

/**
 * When a timer started now should fire.
 *
 * An absolute deadline rather than a countdown, because a countdown has to be
 * decremented by something, and anything that decrements it stops while the
 * machine sleeps or the tab is throttled. A deadline survives both.
 */
export function sleepDeadline(minutes: number, now: number): number {
  return now + Math.max(1, Math.round(minutes)) * 60_000
}

/** Milliseconds left, never negative. */
export function remaining(deadline: number | null, now: number): number {
  if (deadline === null || !Number.isFinite(deadline)) return 0
  return Math.max(0, deadline - now)
}

export function hasExpired(deadline: number | null, now: number): boolean {
  return deadline !== null && Number.isFinite(deadline) && now >= deadline
}

/**
 * The countdown as it appears on screen.
 *
 * Minutes while there is more than one left, then seconds — the last minute is
 * the only one where the seconds matter, and showing them earlier makes a
 * quiet control twitch once a second for two hours.
 */
export function formatRemaining(ms: number): string {
  const seconds = Math.ceil(Math.max(0, ms) / 1000)
  if (seconds > 60) return `${Math.ceil(seconds / 60)} min`
  return `0:${String(seconds).padStart(2, '0')}`
}
