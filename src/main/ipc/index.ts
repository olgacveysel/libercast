import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { app, dialog, ipcMain, shell } from 'electron'
import type { IpcChannel, IpcEventName, IpcEvents, IpcRequest, IpcResponse } from '@shared/ipc'
import type { PlaylistDraft, SyncProgress } from '@shared/types'
import * as catalog from '@main/db/repo/catalog'
import * as epgRepo from '@main/db/repo/epg'
import * as playlists from '@main/db/repo/playlists'
import * as settings from '@main/db/repo/settings'
import * as downloadsRepo from '@main/db/repo/downloads'
import * as recordingsRepo from '@main/db/repo/recordings'
import * as vodRepo from '@main/db/repo/vod'
import * as reminders from '@main/db/repo/reminders'
import { exportBackup, importBackup } from '@main/secure/backup'
import { deletePassword, setPassword } from '@main/secure/credentials'
import * as parental from '@main/secure/parental'
import { accountFor, syncPlaylist, testSource } from '@main/sources'
import { autoMatch, refreshEpg, suggestionsFor } from '@main/sources/epg'
import { movieInfo, nextEpisodeOf, previousEpisodeOf, seriesDetail } from '@main/sources/vod'
import { binaries, hasFfmpeg, setFfmpegOverride } from '@main/media/binaries'
import { autoRefresh } from '@main/autoRefresh'
import { downloader } from '@main/media/downloader'
import { recorder } from '@main/media/recorder'
import { loadSubtitleFile, SUBTITLE_EXTENSIONS } from '@main/media/externalSubtitles'
import { openStream } from '@main/media/openStream'
import { streamServer } from '@main/media/streamServer'
import { XtreamClient } from '@main/sources/xtream'
import { createLogger, errorMessage } from '@main/util/logger'
import { getMainWindow } from '@main/window'
import { logFilePath, logFolder } from '@main/util/logfile'
import { checkForUpdate } from '@main/updates'
import { cancelScan, scanFavorites } from '@main/media/healthScan'
import { closeDetached, detachedTiles, openDetached } from '@main/windows/detached'

const log = createLogger('ipc')

/**
 * Wraps a handler so every rejection reaches the renderer as a plain message
 * rather than Electron's serialized stack, which leaks absolute paths.
 */
function handle<C extends IpcChannel>(
  channel: C,
  handler: (payload: IpcRequest<C>) => Promise<IpcResponse<C>> | IpcResponse<C>
): void {
  ipcMain.handle(channel, async (_event, payload: IpcRequest<C>) => {
    try {
      return await handler(payload)
    } catch (error) {
      const message = errorMessage(error)
      log.error(`${channel} failed`, message)
      throw new Error(message)
    }
  })
}

function emitProgress(progress: SyncProgress): void {
  getMainWindow()?.webContents.send('sync:progress', progress)
}

/** Sends one of the main-to-renderer events declared in the contract. */
function emit<E extends IpcEventName>(event: E, payload: IpcEvents[E]): void {
  getMainWindow()?.webContents.send(event, payload)
}

export function registerIpcHandlers(): void {
  /* ---------------- playlists ---------------- */

  handle('playlists:list', () => playlists.listPlaylists())

  handle('playlists:create', (draft: PlaylistDraft) => {
    const normalized: PlaylistDraft = {
      ...draft,
      url: draft.kind === 'xtream' && draft.url ? XtreamClient.normalizeBaseUrl(draft.url) : draft.url
    }
    const created = playlists.createPlaylist(normalized)
    if (draft.password) setPassword(created.id, draft.password)
    return created
  })

  handle('playlists:update', ({ id, patch }) => {
    const updated = playlists.updatePlaylist(id, patch)
    if (patch.password !== undefined) setPassword(id, patch.password)
    return updated
  })

  handle('playlists:remove', (id: number) => {
    deletePassword(id)
    playlists.removePlaylist(id)
  })

  handle('playlists:test', (draft: PlaylistDraft) => testSource(draft))

  handle('playlists:sync', (id: number) => syncPlaylist(id, emitProgress))

  /* ---------------- catalog ---------------- */

  handle('categories:list', ({ playlistId, kind }) => catalog.listCategories(playlistId, kind))

  handle('channels:query', (query) => catalog.queryChannels(query))
  handle('channels:count', (query) => catalog.countChannels(query))
  handle('channels:get', (id: number) => catalog.getChannel(id))
  handle('channels:toggleFavorite', (id: number) => catalog.toggleFavorite(id))
  handle('channels:setHidden', ({ id, hidden }) => catalog.setHidden(id, hidden))
  handle('channels:markWatched', (id: number) => catalog.markWatched(id))
  handle('channels:recent', ({ limit }) => catalog.recentChannels(limit))

  /* ---------------- movies & series ---------------- */

  handle('vod:movieInfo', ({ channelId, force }) => movieInfo(channelId, force ?? false))
  handle('vod:seriesDetail', ({ channelId, force }) => seriesDetail(channelId, force ?? false))
  handle('vod:nextEpisode', (episodeId: number) => nextEpisodeOf(episodeId))
  handle('vod:previousEpisode', (episodeId: number) => previousEpisodeOf(episodeId))

  /* ---------------- playback ---------------- */

  handle('stream:open', async (request) => {
    const { session, provider, switched, playingChannelId } = await openStream(request)

    return {
      id: session.id,
      url: session.url,
      seekable: session.seekable,
      // ffprobe knows the length of a file; for a series episode the provider
      // usually told us already, which is faster and works on live-ish sources.
      durationSecs: session.durationSecs ?? provider.durationSecs,
      pipeline: session.pipeline,
      tracks: session.tracks,
      video: session.video,
      audioTrack: session.audioTrack,
      subtitleTrack: session.subtitleTrack,
      subtitlesUrl: session.subtitlesUrl,
      subtitlesBurnedIn: session.subtitlesBurnedIn,
      absoluteTimeline: session.absoluteTimeline,
      warning: session.warning,
      switched,
      playingChannelId
    }
  })

  handle('stream:close', (sessionId: string) => streamServer.close(sessionId))

  handle('media:capabilities', () => {
    const resolved = binaries()
    return {
      ffmpeg: hasFfmpeg(),
      ffmpegSource: resolved.source.ffmpeg,
      ffprobe: resolved.ffprobe !== null,
      recordingsPath: settings.getSettings().recordingsPath
    }
  })

  /* ---------------- external subtitles ---------------- */

  handle('subtitles:pickFile', async () => {
    const window = getMainWindow()
    if (!window) return null

    const result = await dialog.showOpenDialog(window, {
      title: 'Open a subtitle file',
      properties: ['openFile'],
      filters: [
        { name: 'Subtitles', extensions: SUBTITLE_EXTENSIONS },
        { name: 'All files', extensions: ['*'] }
      ]
    })

    const picked = result.canceled ? null : result.filePaths[0] ?? null
    return picked ? loadSubtitleFile(picked) : null
  })

  handle('subtitles:loadFile', (filePath: string) => loadSubtitleFile(filePath))

  /* ---------------- downloads ---------------- */

  handle('downloads:list', () => downloadsRepo.listDownloads())
  handle('downloads:enqueue', (request) => downloader.enqueue(request))
  handle('downloads:forItem', ({ itemType, itemId }) => downloadsRepo.getByItem(itemType, itemId))
  handle('downloads:pause', (id: number) => downloader.pause(id))
  handle('downloads:resume', (id: number) => downloader.resume(id))
  handle('downloads:cancel', (id: number) => downloader.cancel(id))
  handle('downloads:remove', ({ id, deleteFile }) => downloader.remove(id, deleteFile))

  handle('downloads:reveal', (id: number) => {
    const download = downloadsRepo.getDownload(id)
    if (download?.filePath) shell.showItemInFolder(download.filePath)
  })

  /* ---------------- recordings ---------------- */

  handle('recordings:list', () => recordingsRepo.listRecordings())
  handle('recordings:startNow', (request) => recorder.startNow(request))
  handle('recordings:schedule', (request) => recorder.schedule(request))
  handle('recordings:stop', (id: number) => recorder.stop(id))

  handle('recordings:remove', async ({ id, deleteFile }) => {
    const recording = recordingsRepo.getRecording(id)
    if (recording && recorder.isRunning(id)) recorder.stop(id)

    if (deleteFile && recording?.filePath) {
      // A missing file is not an error — the user may have moved it already.
      await rm(recording.filePath, { force: true })
    }
    recordingsRepo.removeRecording(id)
  })

  handle('recordings:reveal', (id: number) => {
    const recording = recordingsRepo.getRecording(id)
    if (recording?.filePath) shell.showItemInFolder(recording.filePath)
  })

  /* ---------------- playback progress ---------------- */

  handle('progress:save', (patch) => vodRepo.saveProgress(patch))
  handle('progress:resume', ({ itemType, itemId }) => vodRepo.getResumePosition(itemType, itemId))
  handle('progress:clear', ({ itemType, itemId }) => vodRepo.clearProgress(itemType, itemId))
  handle('progress:continueWatching', ({ limit }) => vodRepo.continueWatching(limit))

  /* ---------------- guide ---------------- */

  handle('epg:refresh', (playlistId: number) => refreshEpg(playlistId))
  handle('epg:state', (playlistId: number) => epgRepo.getState(playlistId))

  handle('epg:matchRows', ({ playlistId, onlyUnmatched }) =>
    epgRepo.matchRows(playlistId, onlyUnmatched)
  )
  handle('epg:suggestions', ({ playlistId, channelName }) => suggestionsFor(playlistId, channelName))
  handle('epg:setOverride', ({ channelId, epgChannelId }) =>
    // A choice made here is manual by definition, so auto-matching leaves it be.
    epgRepo.setOverride(channelId, epgChannelId, false)
  )
  handle('epg:autoMatch', (playlistId: number) => autoMatch(playlistId))
  handle('epg:guideChannels', (playlistId: number) => epgRepo.listGuideChannels(playlistId))
  handle('epg:guide', ({ query, startsAt, endsAt }) => epgRepo.guideWindow(query, startsAt, endsAt))
  handle('epg:channelProgrammes', ({ epgChannelId, from, to }) =>
    epgRepo.programmesForChannel(epgChannelId, from, to)
  )

  /* ---------------- global search ---------------- */

  handle('search:global', ({ playlistId, query, limit }) => {
    const perSection = Math.min(limit ?? 8, 30)
    const base = { playlistId, search: query, sort: 'name' as const }

    // Three narrow queries rather than one union: each kind has its own index,
    // and a union would lose the per-kind cap that keeps the palette readable.
    const live = catalog.queryChannels({ ...base, kind: 'live', limit: perSection })
    const movies = catalog.queryChannels({ ...base, kind: 'movie', limit: perSection })
    const series = catalog.queryChannels({ ...base, kind: 'series', limit: perSection })

    return {
      live,
      movies,
      series,
      totals: {
        live: catalog.countChannels({ ...base, kind: 'live' }),
        movies: catalog.countChannels({ ...base, kind: 'movie' }),
        series: catalog.countChannels({ ...base, kind: 'series' })
      }
    }
  })

  /* ---------------- parental controls ---------------- */

  handle('parental:status', () => parental.status())
  handle('parental:setPin', ({ currentPin, newPin }) => {
    parental.setPin(currentPin, newPin)
    return parental.status()
  })
  handle('parental:unlock', (pin: string) => parental.unlock(pin))
  handle('parental:lock', () => parental.lock())
  handle('parental:disable', (pin: string) => {
    parental.disable(pin)
    return parental.status()
  })
  handle('parental:setRules', (rules) => {
    parental.setRules(rules)
    return parental.status()
  })

  /* ---------------- backup ---------------- */

  handle('backup:export', async (options) => {
    const window = getMainWindow()
    if (!window) throw new Error('No window')

    const stamp = new Date().toISOString().slice(0, 10)
    const result = await dialog.showSaveDialog(window, {
      title: 'Save a backup',
      defaultPath: `libercast-backup-${stamp}.json`,
      filters: [{ name: 'LiberCast backup', extensions: ['json'] }]
    })

    if (result.canceled || !result.filePath) throw new Error('Cancelled')
    return exportBackup(result.filePath, options)
  })

  handle('backup:pickFile', async () => {
    const window = getMainWindow()
    if (!window) return null
    const result = await dialog.showOpenDialog(window, {
      title: 'Open a backup',
      properties: ['openFile'],
      filters: [{ name: 'LiberCast backup', extensions: ['json'] }]
    })
    return result.canceled ? null : result.filePaths[0] ?? null
  })

  handle('backup:import', (options) => importBackup(options))

  /* ---------------- settings & dialogs ---------------- */

  handle('settings:get', () => settings.getSettings())
  handle('settings:set', (patch) => {
    const updated = settings.setSettings(patch)
    // Re-resolve immediately so the Settings screen reflects the new path.
    if (patch.ffmpegPath !== undefined) setFfmpegOverride(updated.ffmpegPath)
    return updated
  })

  handle('dialog:pickM3uFile', async () => {
    const window = getMainWindow()
    if (!window) return null
    const result = await dialog.showOpenDialog(window, {
      title: 'Select an M3U playlist',
      properties: ['openFile'],
      filters: [
        { name: 'Playlists', extensions: ['m3u', 'm3u8'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    return result.canceled ? null : result.filePaths[0] ?? null
  })

  handle('dialog:pickFolder', async () => {
    const window = getMainWindow()
    if (!window) return null
    const result = await dialog.showOpenDialog(window, { properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : result.filePaths[0] ?? null
  })

  /* ---------------- window ---------------- */

  handle('window:minimize', () => {
    getMainWindow()?.minimize()
  })

  handle('window:toggleMaximize', () => {
    const window = getMainWindow()
    if (!window) return false
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
    return window.isMaximized()
  })

  handle('window:close', () => {
    getMainWindow()?.close()
  })

  handle('window:isMaximized', () => getMainWindow()?.isMaximized() ?? false)

  /* ---------------- reminders ---------------- */

  handle('reminders:list', () => reminders.listReminders())
  handle('reminders:add', (request) => reminders.addReminder(request))
  handle('reminders:remove', (id: number) => reminders.removeReminder(id))
  handle('reminders:find', ({ channelId, title, startsAt }) =>
    reminders.findReminder(channelId, title, startsAt)
  )

  handle('playlists:account', (id: number) => accountFor(id))

  handle('sources:refreshNow', () => autoRefresh.run())

  handle('app:version', () => app.getVersion())

  handle('app:checkUpdate', () => checkForUpdate())

  handle('health:scanFavorites', (playlistId: number) =>
    scanFavorites(playlistId, (progress) => emit('health:progress', progress))
  )
  handle('health:cancel', () => cancelScan())

  handle('multiview:detach', ({ channelId, tile }) => openDetached(channelId, tile))
  handle('multiview:attach', (tile) => closeDetached(tile))
  handle('multiview:detached', () => detachedTiles())

  handle('app:showLogs', () => {
    const path = logFilePath()
    if (path === null) return null

    // showItemInFolder selects the file, which is what makes it obvious which
    // of the two files to attach to a bug report. It does nothing at all if the
    // file is not there, so an absent log reports as null instead.
    if (!existsSync(path)) {
      const folder = logFolder()
      if (folder === null || !existsSync(folder)) return null
      void shell.openPath(folder)
      return folder
    }

    shell.showItemInFolder(path)
    return path
  })
}
