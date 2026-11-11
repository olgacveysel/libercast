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

  /*
   * External links open in the user's browser, never inside the app shell —
   * and only if they are web links.
   *
   * `shell.openExternal` hands the string to the operating system, which will
   * happily act on far more than http: a `file:` URL opens a file, and on
   * Windows the scheme table reaches a good deal further than that. Nothing
   * in this application needs to open anything but a web page, and the
   * strings reaching here are not all ours — a playlist, a guide and a
   * subtitle file are all somebody else's text.
   */
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebLink(url)) void shell.openExternal(url)
    else log.warn(`refused to open a non-web link: ${url.slice(0, 80)}`)
    return { action: 'deny' }
  })

  /*
   * The window itself never navigates.
   *
   * It loads the renderer once and stays there; every other destination is a
   * link, handled above. Without this, anything that can set `location` —
   * including a bug in our own code — replaces the application with a remote
   * page that then inherits the preload bridge.
   */
  window.webContents.on('will-navigate', (event, url) => {
    const here = window.webContents.getURL()
    if (url === here) return
    event.preventDefault()
    log.warn(`blocked navigation to ${url.slice(0, 80)}`)
    if (isWebLink(url)) void shell.openExternal(url)
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
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
