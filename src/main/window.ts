import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { is } from '@electron-toolkit/utils'

/**
 * Packaged builds get the icon from the executable itself; a dev run does not,
 * and shows Electron's default instead. Pointing at the source file covers both.
 */
function windowIcon(): string | undefined {
  return app.isPackaged ? undefined : join(__dirname, '../../resources/icon.png')
}

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

  // External links open in the user's browser, never inside the app shell.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}
