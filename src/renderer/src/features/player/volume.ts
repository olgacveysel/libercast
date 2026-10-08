/** One press of the volume keys, and one notch of the sliders. */
export const VOLUME_STEP = 0.05

/**
 * Moves the level by a delta, kept in range and off the floating-point fringe.
 *
 * Rounding matters: repeatedly adding 0.05 to 0 lands on 0.35000000000000003,
 * which then shows as "35%" in one place and "35.000000000000004%" in another,
 * and is written to the settings file that way.
 */
export function stepVolume(current: number, delta: number): number {
  const from = Number.isFinite(current) ? current : 1
  return clampVolume(from + delta)
}

export function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100
}

/** For a label or a tooltip. Whole percent — nobody needs 72.5%. */
export function formatVolume(value: number): string {
  return `${Math.round(clampVolume(value) * 100)}%`
}

/**
 * Which speaker icon to draw.
 *
 * A level of zero is silent whether or not mute is on, so it draws as muted:
 * an icon showing sound coming out of a speaker that is producing none is worse
 * than no icon.
 */
export function volumeLevel(value: number, muted: boolean): 'muted' | 'low' | 'high' {
  if (muted || clampVolume(value) === 0) return 'muted'
  return clampVolume(value) < 0.5 ? 'low' : 'high'
}
