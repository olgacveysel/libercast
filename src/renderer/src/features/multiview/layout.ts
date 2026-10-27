/**
 * How the grid is shaped, and how it changes when one tile is promoted.
 *
 * Separated from the component because the awkward part is arithmetic — what
 * the track list should be for a given tile count — and that is worth checking
 * without a browser.
 */

export interface GridStyle {
  gridTemplateColumns: string
  gridTemplateRows: string
}

/** The ordinary grid: every tile the same size. */
export function evenGrid(columns: number, rows: number): GridStyle {
  return {
    gridTemplateColumns: `repeat(${Math.max(1, columns)}, 1fr)`,
    gridTemplateRows: `repeat(${Math.max(1, rows)}, 1fr)`
  }
}

/**
 * The spotlight: one tile across the top, the rest in a strip beneath it.
 *
 * The strip has exactly one column per remaining tile, so they fit on one row
 * whatever the layout was — promoting inside a 3x3 leaves eight thumbnails
 * rather than overflowing the grid, which is what happens if you try to do
 * this by giving the promoted tile a span inside the original tracks.
 *
 * The strip is sized as a fraction rather than a fixed height so it stays
 * sensible from a laptop screen to a television, with a floor so it cannot
 * collapse to nothing when the window is short.
 */
export function spotlightGrid(tileCount: number): GridStyle {
  const strip = Math.max(1, tileCount - 1)
  return {
    gridTemplateColumns: `repeat(${strip}, 1fr)`,
    gridTemplateRows: `1fr minmax(76px, 0.26fr)`
  }
}

/**
 * The grid for the current state.
 *
 * `focused` is an index into the tiles, or null for the even grid.
 */
export function gridStyle(
  columns: number,
  rows: number,
  focused: number | null
): GridStyle {
  const tileCount = Math.max(1, columns) * Math.max(1, rows)
  return focused === null ? evenGrid(columns, rows) : spotlightGrid(tileCount)
}

/**
 * Keeps the promoted tile inside the layout.
 *
 * Changing from 3x3 to 1x2 while tile 7 was promoted would otherwise leave the
 * spotlight pointing at a tile that no longer exists: an empty big cell and a
 * strip missing one of its own.
 */
export function clampFocus(focused: number | null, tileCount: number): number | null {
  if (focused === null) return null
  if (!Number.isInteger(focused) || focused < 0 || focused >= tileCount) return null
  return focused
}

/**
 * What a click on an already-promoted tile should do.
 *
 * Promoting is a toggle: the same gesture that enlarges a tile puts it back,
 * so there is nothing extra to learn and no state you can get stuck in.
 */
export function nextFocus(current: number | null, clicked: number): number | null {
  return current === clicked ? null : clicked
}
