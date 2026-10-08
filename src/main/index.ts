import { app, BrowserWindow, session } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { closeDb, getDb } from './db'
import { getSettings } from './db/repo/settings'
import { registerIpcHandlers } from './ipc'
import { setFfmpegOverride } from './media/binaries'
import { downloader } from './media/downloader'
import { recorder } from './media/recorder'
import { scheduler } from './media/scheduler'
import { reminderScheduler } from './epgReminders'
import { autoRefresh } from './autoRefresh'
import { streamServer } from './media/streamServer'
import { createWindow, getMainWindow } from './window'
import { createLogger, errorMessage } from './util/logger'

const log = createLogger('app')

// A second instance would fight over the SQLite file; focus the first instead.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  bootstrap()
}

function bootstrap(): void {
  // Settings must be read before the app is ready, because the hardware
  // acceleration switch only takes effect if disabled this early.
  try {
    app.setPath('userData', app.getPath('userData'))
  } catch (error) {
    log.warn('could not set userData path', errorMessage(error))
  }

  app.on('second-instance', () => {
    const [existing] = BrowserWindow.getAllWindows()
    if (existing) {
      if (existing.isMinimized()) existing.restore()
      existing.focus()
    }
  })

  app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.libercast.app')

    getDb()

    setFfmpegOverride(getSettings().ffmpegPath)

    if (!getSettings().hardwareAcceleration) {
      log.info('hardware acceleration disabled by settings; restart required to take effect')
    }

    // Many providers block requests that carry Electron's default UA.
    session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
      const headers = { ...details.requestHeaders }
      if (headers['User-Agent']?.includes('Electron')) {
        headers['User-Agent'] =
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
      }
      callback({ requestHeaders: headers })
    })

    registerIpcHandlers()

    // Recording state changes come from timers and child processes rather than
    // user actions, so the UI is pushed to instead of polling.
    const broadcast = (recording: Parameters<Parameters<typeof recorder.onChange>[0]>[0]): void => {
      getMainWindow()?.webContents.send('recordings:changed', recording)
    }
    recorder.onChange(broadcast)
    scheduler.onChange(broadcast)
    scheduler.start()
    reminderScheduler.start()

    // A refresh must never take the connection a playing stream is using, and
    // on most accounts there is only one.
    autoRefresh.setBusyCheck(() => streamServer.hasSessions())
    autoRefresh.start()

    downloader.onChange((download) => {
      getMainWindow()?.webContents.send('downloads:changed', download)
    })
    downloader.start()

    app.on('browser-window-created', (_event, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    // Order matters: stop new work, let ffmpeg finalize its files, then close
    // the database the recorder writes its final state to.
    scheduler.stop()
    reminderScheduler.stop()
    autoRefresh.stop()
    recorder.stopAll()
    downloader.stopAll()
    streamServer.closeAll()
    closeDb()
  })

  process.on('uncaughtException', (error) => {
    log.error('uncaught exception', errorMessage(error))
  })
  process.on('unhandledRejection', (reason) => {
    log.error('unhandled rejection', errorMessage(reason))
  })
}
