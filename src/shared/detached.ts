/**
 * The arithmetic behind a detached multi-view tile.
 *
 * Kept away from Electron on purpose: placing a window on the right monitor
 * and deciding where the sound goes afterwards are the two things most likely
 * to be wrong, and neither needs a screen to be checked.
 */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface DisplayInfo {
  id: number
  /** The usable area, i.e. the display minus taskbars and docks. */
  workArea: Rect
  primary: boolean
}

/**
 * Which monitor a detached window should open on.
 *
 * The whole point of detaching is to get the picture off the screen the grid
 * is on, so a second monitor wins by default. With only one display there is
 * nothing to choose and it opens there.
 */
export function pickDisplay(displays: DisplayInfo[], gridDisplayId?: number): DisplayInfo | null {
  if (displays.length === 0) return null

  const away = displays.find((display) => display.id !== gridDisplayId)
  if (away) return away

  return displays.find((display) => display.primary) ?? displays[0] ?? null
}

/**
 * A window of this size centred in that work area, never larger than it and
 * never off the edge of it.
 *
 * Clamping matters more than it looks: a 960×540 window centred on a 1280×720
 * secondary monitor is fine, and the same window centred on a half-height
 * stacked display would otherwise open with its controls below the screen.
 */
export function centeredIn(workArea: Rect, width: number, height: number): Rect {
  const w = Math.max(320, Math.min(Math.round(width), workArea.width))
  const h = Math.max(180, Math.min(Math.round(height), workArea.height))

  return {
    x: Math.round(workArea.x + (workArea.width - w) / 2),
    y: Math.round(workArea.y + (workArea.height - h) / 2),
    width: w,
    height: h
  }
}

/** A 16:9 window that fills a comfortable share of the display it opens on. */
export function detachedSize(workArea: Rect): { width: number; height: number } {
  const width = Math.round(Math.min(1280, workArea.width * 0.6))
  return { width, height: Math.round((width * 9) / 16) }
}

/**
 * Where the grid's sound should go once `detached` tiles have left it.
 *
 * A detached window carries its own audio, so leaving the grid pointed at a
 * tile that is no longer playing there would mute the grid with no visible
 * reason. Nothing is a valid answer: with every tile detached the grid has no
 * sound to give.
 */
export function nextAudioTile(
  current: number,
  detached: readonly number[],
  tileCount: number
): number | null {
  const gone = new Set(detached)
  if (current >= 0 && current < tileCount && !gone.has(current)) return current

  for (let index = 0; index < tileCount; index++) {
    if (!gone.has(index)) return index
  }

  return null
}

/**
 * The query string a detached window is opened with, and reading it back.
 *
 * It travels through a URL rather than an IPC message because the window has
 * to know what to play before React mounts — a message would arrive after the
 * first render and show an empty player for a frame.
 */
export function detachedQuery(channelId: number, tile: number): string {
  return `detached=1&channel=${channelId}&tile=${tile}`
}

export interface DetachedParams {
  channelId: number
  tile: number
}

export function parseDetached(search: string): DetachedParams | null {
  let params: URLSearchParams
  try {
    params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  } catch {
    return null
  }

  if (params.get('detached') !== '1') return null

  const channelId = Number(params.get('channel'))
  const tile = Number(params.get('tile'))

  if (!Number.isInteger(channelId) || channelId <= 0) return null
  if (!Number.isInteger(tile) || tile < 0) return null

  return { channelId, tile }
}
