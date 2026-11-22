/**
 * How wide the Live TV lists are allowed to be.
 *
 * Shared rather than written into the component because the same numbers have
 * to hold in two places that never run together: the drag, which clamps as
 * the pointer moves, and the read on startup, which clamps a number that came
 * out of the database. A settings file is editable, and a backup restored
 * from a wider screen can carry widths this one cannot afford, so the value
 * is bounded wherever it enters rather than only where it is set.
 */
export type PaneKind = 'category' | 'channel'

export const PANE_WIDTHS: Record<PaneKind, { min: number; max: number; preset: number }> = {
  /* A category name is a provider's own label, often prefixed with a country
     and a separator before anything distinguishing arrives. */
  category: { min: 140, max: 440, preset: 210 },
  /* Channel rows carry a number, a logo, the name and the programme under it,
     so they need more than the categories do and benefit more from the drag. */
  channel: { min: 200, max: 600, preset: 320 }
}

/** The picture never goes below this, whatever the lists are dragged to. */
export const MIN_PLAYER_WIDTH = 320

/**
 * Bounds a width, optionally against the space actually available.
 *
 * `room` is what the lists and the picture have to share. Passing it keeps a
 * drag from pushing the player off the screen on a narrow window; leaving it
 * out applies only the fixed bounds, which is what a read from the database
 * wants before anything has been laid out.
 */
export function clampPaneWidth(kind: PaneKind, width: number, room?: number): number {
  const { min, max, preset } = PANE_WIDTHS[kind]
  if (!Number.isFinite(width)) return preset
  const ceiling = room === undefined ? max : Math.min(max, Math.max(min, room - MIN_PLAYER_WIDTH))
  return Math.round(Math.min(Math.max(width, min), ceiling))
}
