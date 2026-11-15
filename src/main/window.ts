import { join } from 'node:path'
import { createLogger } from '@main/util/logger'
import { app, BrowserWindow, shell } from 'electron'
import { is } from '@electron-toolkit/utils'

/**
 * Packaged builds get the icon from the executable itself; a dev run does not,
 * and shows Electron's default instead. Pointing at the source file covers both.
 */
function windowIcon(): string | undefined {
  return app.isPackaged ? undefined : join(__dirname, '../../resources/icon.png')
}

const log = createLogger('window')

let mainWindow: BrowserWindow | null = null

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    icon: windowIcon(),
    backgroundColor: '#0b0d12',
    autoHideMenuBar: true,
    // Frameless with a custom title bar, so the chrome matches the app design.
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // Provider streams are plain HTTP far more often than HTTPS.
      webSecurity: true
    }
  })

  mainWindow = window

  window.on('ready-to-show', () => window.show())

  const notifyMaximized = (): void => {
    window.webContents.send('window:maximizedChanged', window.isMaximized())
  }
  window.on('maximize', notifyMaximized)
  window.on('unmaximize', notifyMaximized)
  window.on('closed', () => {
    mainWindow = null
  })

  guardWindow(window)

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

/**
 * The shell rules every window in this application must have.
 *
 * Written once and exported because the pop-out player did not have them. The
 * main window was hardened and `windows/detached.ts` kept its own copy of the
 * original — `shell.openExternal` on any URL at all, and no navigation
 * handler — so the window with the smallest chrome had the weakest guards.
 * Two copies of a security rule is one copy too many.
 *
 * Both rules exist because the strings arriving here are not all ours. A
 * playlist, a guide and a subtitle file are somebody else's text.
 *
 * - `shell.openExternal` hands a string to the operating system, which acts on
 *   far more than http: a `file:` URL opens a file, and on Windows the scheme
 *   table reaches a good deal further. Only web links are passed on.
 * - A window loads the renderer once and stays there. Without the navigation
 *   block, anything that can set `location` — a bug in our own code included
 *   — replaces the application with a remote page that then inherits the
 *   preload bridge.
 */
export function guardWindow(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebLink(url)) void shell.openExternal(url)
    else log.warn(`refused to open a non-web link: ${url.slice(0, 80)}`)
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    const here = window.webContents.getURL()
    if (url === here) return
    event.preventDefault()
    log.warn(`blocked navigation to ${url.slice(0, 80)}`)
    if (isWebLink(url)) void shell.openExternal(url)
  })
}

/**
 * Whether a string is a plain web link.
 *
 * Parsed rather than pattern-matched: `javascript:` and `file:` are easy to
 * spot, and the point is to admit only what is known good rather than to
 * guess at a list of what is known bad.
 */
export function isWebLink(value: string): boolean {
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}
