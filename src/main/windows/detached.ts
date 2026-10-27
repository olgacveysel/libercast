import { join } from 'node:path'
import { BrowserWindow, screen, shell } from 'electron'
import { is } from '@electron-toolkit/utils'
import {
  centeredIn,
  detachedQuery,
  detachedSize,
  pickDisplay,
  type DisplayInfo
} from '@shared/detached'
import { createLogger } from '@main/util/logger'
import { getMainWindow } from '@main/window'

const log = createLogger('detached')

/**
 * One multi-view tile, pulled out into a window of its own.
 *
 * The grid tile stops playing the moment its window opens, and the window is
 * the only thing holding that channel afterwards. That is not a detail: every
 * stream is a separate provider connection, and most accounts allow very few
 * of them, so a channel playing in two places at once would cost a connection
 * the user needs for a different match.
 *
 * Keyed by tile index rather than channel, because the grid position is what
 * the user put the channel in and what it returns to.
 */
const windows = new Map<number, BrowserWindow>()

/** Which tiles are currently in a window of their own. */
export function detachedTiles(): number[] {
  return [...windows.keys()].sort((a, b) => a - b)
}

function broadcast(): void {
  getMainWindow()?.webContents.send('multiview:detachedChanged', detachedTiles())
}

function displays(): DisplayInfo[] {
  const primaryId = screen.getPrimaryDisplay().id
  return screen.getAllDisplays().map((display) => ({
    id: display.id,
    workArea: display.workArea,
    primary: display.id === primaryId
  }))
}

/** The display the grid is on, so the detached window can open on another. */
function gridDisplayId(): number | undefined {
  const main = getMainWindow()
  if (!main) return undefined
  try {
    return screen.getDisplayMatching(main.getBounds()).id
  } catch {
    return undefined
  }
}

export function openDetached(channelId: number, tile: number): void {
  // Asking twice is almost always a second click, not a request for a second
  // window: bring the one that exists forward instead of opening a duplicate
  // and taking another connection with it.
  const existing = windows.get(tile)
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore()
    existing.focus()
    return
  }

  const display = pickDisplay(displays(), gridDisplayId())
  const workArea = display?.workArea ?? { x: 0, y: 0, width: 1280, height: 800 }
  const size = detachedSize(workArea)
  const bounds = centeredIn(workArea, size.width, size.height)

  const window = new BrowserWindow({
    ...bounds,
    minWidth: 320,
    minHeight: 180,
    show: false,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    frame: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      // Without this a window on a second monitor is throttled to a crawl the
      // moment it loses focus — which is exactly how it will be watched.
      backgroundThrottling: false
    }
  })

  windows.set(tile, window)

  window.on('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  window.on('closed', () => {
    windows.delete(tile)
    // The grid has to hear about this however the window went: the close
    // button, the window manager, or the user quitting from the taskbar.
    broadcast()
    log.info(`tile ${tile} returned to the grid`)
  })

  const query = detachedQuery(channelId, tile)
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?${query}`)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'), { search: query })
  }

  log.info(`tile ${tile} detached to its own window on display ${display?.id ?? 'unknown'}`)
  broadcast()
}

/** Puts one tile back in the grid. */
export function closeDetached(tile: number): void {
  const window = windows.get(tile)
  if (window && !window.isDestroyed()) window.close()
}

/**
 * Closes every detached window.
 *
 * Called when the main window goes and again before quitting: a detached
 * window left open would hold a provider connection and, on Windows, keep the
 * whole application alive with no grid to return to.
 */
export function closeAllDetached(): void {
  for (const window of [...windows.values()]) {
    if (!window.isDestroyed()) window.destroy()
  }
  windows.clear()
}
