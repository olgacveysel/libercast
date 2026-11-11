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
import { credentialStorage } from './secure/credentials'
import { createWindow, getMainWindow } from './window'
import { closeAllDetached } from './windows/detached'
import { checkOnLaunch } from './updates'
import { createLogger, errorMessage } from './util/logger'

const log = createLogger('app')

// A second instance would fight over the SQLite file; focus the first instead.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  bootstrap()
}

/**
 * Settings that can only be applied before Electron is ready.
 *
 * Both of these are switches Chromium reads once at startup, so they are
 * useless after `whenReady` — which is where the hardware-acceleration
 * setting was being read. It logged that a restart was required and then
 * never did anything on the restart either: `disableHardwareAcceleration`
 * was not called anywhere in this application. The toggle in Settings wrote a
 * boolean and changed nothing, which is worse than not offering it, because
 * someone with a struggling GPU turned it off and concluded it had not
 * helped.
 *
 * Reading settings this early means opening the database before the app is
 * ready. That is allowed — `app.getPath` resolves before ready, and SQLite
 * has no opinion about Electron's lifecycle — and anything that does go wrong
 * must not stop the application starting, so the whole thing is guarded.
 */
function applyStartupSwitches(): void {
  let settings
  try {
    settings = getSettings()
  } catch (error) {
    log.warn('could not read settings before startup; using defaults', errorMessage(error))
    return
  }

  if (!settings.hardwareAcceleration) {
    app.disableHardwareAcceleration()
    log.info('hardware acceleration disabled by settings')
  }

  if (settings.tvNavigation) {
    // Arrow keys move focus to the nearest element in that direction instead
    // of scrolling. Chromium does the geometry; the application only has to
    // make focus visible and stop the player swallowing the keys.
    app.commandLine.appendSwitch('enable-spatial-navigation')
    log.info('remote navigation enabled: arrow keys move focus')
  }
}

function bootstrap(): void {
  try {
    app.setPath('userData', app.getPath('userData'))
  } catch (error) {
    log.warn('could not set userData path', errorMessage(error))
  }

  applyStartupSwitches()

  app.on('second-instance', () => {
    // The main window, not whichever window happens to be first: a detached
    // tile on a second monitor must not be what a second launch brings up.
    const existing = getMainWindow() ?? BrowserWindow.getAllWindows()[0]
    if (existing) {
      if (existing.isMinimized()) existing.restore()
      existing.focus()
    }
  })

  app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.libercast.app')

    getDb()

    setFfmpegOverride(getSettings().ffmpegPath)


    // Recorded once per launch so a log sent in with a question answers "where
    // is my password kept on this machine" without anyone having to guess from
    // the platform. The dialog tells the user the same thing; this is for the
    // log, which is what gets attached to a bug report.
    const credentials = credentialStorage()
    log.info(
      `provider passwords: ${credentials.backend}` +
        (credentials.protectedByOs ? '' : ' (no OS protection on this machine)')
    )

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

    // A detached tile has nowhere to return to once the grid is gone, and on
    // Windows it would keep the whole application alive with no way back to it.
    const main = createWindow()
    main.on('closed', closeAllDetached)

    // Only runs at all once the user has turned it on, and at most once a day
    // after that. Deliberately after the window exists, so a slow or refused
    // request never delays the application appearing.
    main.webContents.once('did-finish-load', () => {
      void checkOnLaunch()
        .then((update) => {
          if (update) main.webContents.send('updates:available', update)
        })
        .catch(() => undefined)
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  /*
   * Quitting waits for the recordings.
   *
   * The order here was right and the timing was not. `recorder.stopAll()` only
   * asked ffmpeg to stop; `closeDb()` ran in the next statement, microseconds
   * later, while every recorder process was still writing. The row saying how
   * a recording ended was then written against a closed database — so a
   * recording stopped by quitting the application was left in the table as
   * still recording, forever.
   *
   * So the quit is deferred once: the default is prevented, the work is wound
   * down, and `app.exit` is called when the files are finished or the wait
   * runs out. The flag matters because `app.quit()` fires this event again.
   */
  let quitting = false
  app.on('before-quit', (event) => {
    if (quitting) return
    quitting = true
    event.preventDefault()

    scheduler.stop()
    reminderScheduler.stop()
    autoRefresh.stop()
    closeAllDetached()
    downloader.stopAll()

    void recorder
      .stopAll()
      .catch((error) => log.error('a recording did not stop cleanly', errorMessage(error)))
      .finally(() => {
        streamServer.closeAll()
        closeDb()
        app.exit(0)
      })
  })

  process.on('uncaughtException', (error) => {
    log.error('uncaught exception', errorMessage(error))
  })
  process.on('unhandledRejection', (reason) => {
    log.error('unhandled rejection', errorMessage(reason))
  })
}
