import type { Playlist, PlaylistDraft, SyncProgress, SyncResult, XtreamAccountInfo } from '@shared/types'
import { importCatalog } from '@main/db/repo/import'
import { getPlaylist, markSynced } from '@main/db/repo/playlists'
import { pruneProbes } from '@main/db/repo/probeCache'
import { getPassword } from '@main/secure/credentials'
import { createLogger, errorMessage } from '@main/util/logger'
import type { FetchOptions } from '@main/util/http'
import { loadM3u } from './m3u'
import { XtreamClient } from './xtream'

const log = createLogger('sync')

export type ProgressSink = (progress: SyncProgress) => void

function fetchOptions(playlist: Playlist): FetchOptions {
  return { userAgent: playlist.userAgent, referrer: playlist.referrer }
}

export function xtreamClientFor(playlist: Playlist): XtreamClient {
  if (playlist.kind !== 'xtream') throw new Error('Playlist is not an Xtream source')
  const password = getPassword(playlist.id)
  if (!playlist.username || !password) throw new Error('Missing Xtream credentials')

  return new XtreamClient(
    { baseUrl: playlist.url, username: playlist.username, password },
    fetchOptions(playlist)
  )
}

/**
 * What the provider says about the account behind a saved source.
 *
 * The same call the Add Source dialog makes, available afterwards — because
 * the two numbers that matter most, how many connections the account allows
 * and when it expires, were being read once at setup and then thrown away.
 *
 * Only the panel calls this, and only when asked: it is a request to the
 * provider like any other.
 */
export async function accountFor(playlistId: number): Promise<XtreamAccountInfo | null> {
  const playlist = getPlaylist(playlistId)
  if (!playlist) throw new Error(`Playlist ${playlistId} not found`)
  if (playlist.kind !== 'xtream') return null

  return xtreamClientFor(playlist).authenticate()
}

/** Validates a draft before it is saved, so the user gets feedback in the dialog. */
export async function testSource(draft: PlaylistDraft): Promise<XtreamAccountInfo | null> {
  if (draft.kind === 'xtream') {
    if (!draft.url || !draft.username || !draft.password) {
      throw new Error('Server URL, username and password are all required')
    }
    const client = new XtreamClient(
      {
        baseUrl: XtreamClient.normalizeBaseUrl(draft.url),
        username: draft.username,
        password: draft.password
      },
      { userAgent: draft.userAgent, referrer: draft.referrer, timeoutMs: 20_000 }
    )
    return client.authenticate()
  }

  if (draft.kind === 'm3u') {
    const catalog = await loadM3u(
      { url: draft.url, filePath: draft.filePath },
      { userAgent: draft.userAgent, referrer: draft.referrer, timeoutMs: 60_000 }
    )
    if (catalog.channels.length === 0) throw new Error('Playlist parsed but contained no channels')
    return null
  }

  throw new Error(`${draft.kind} sources are not supported yet`)
}

export async function syncPlaylist(playlistId: number, onProgress: ProgressSink): Promise<SyncResult> {
  const playlist = getPlaylist(playlistId)
  if (!playlist) throw new Error(`Playlist ${playlistId} not found`)

  const started = Date.now()
  const emit = (phase: SyncProgress['phase'], message: string, progress: number | null = null): void =>
    onProgress({ playlistId, phase, message, progress })

  const result: SyncResult = {
    playlistId,
    categories: 0,
    liveChannels: 0,
    movies: 0,
    series: 0,
    removed: 0,
    durationMs: 0
  }

  try {
    if (playlist.kind === 'm3u') {
      emit('live', 'Downloading playlist…', null)
      const catalog = await loadM3u(
        { url: playlist.url, filePath: playlist.filePath },
        { ...fetchOptions(playlist), timeoutMs: 180_000 }
      )

      emit('saving', `Saving ${catalog.channels.length} channels…`, 0.9)
      const counts = importCatalog(playlistId, 'live', catalog.categories, catalog.channels)
      result.categories = counts.categories
      result.liveChannels = counts.channels
      result.removed = counts.removed
    } else if (playlist.kind === 'xtream') {
      emit('connecting', 'Authenticating…', 0.05)
      const client = xtreamClientFor(playlist)
      await client.authenticate()

      emit('live', 'Loading live channels…', 0.2)
      const live = await client.liveCatalog()

      emit('movies', 'Loading movies…', 0.45)
      const movies = await safely(() => client.movieCatalog())

      emit('series', 'Loading series…', 0.65)
      const series = await safely(() => client.seriesCatalog())

      emit('saving', 'Saving catalog…', 0.85)
      const liveCounts = importCatalog(playlistId, 'live', live.categories, live.channels)
      result.liveChannels = liveCounts.channels
      result.removed += liveCounts.removed
      result.categories += liveCounts.categories

      if (movies) {
        const counts = importCatalog(playlistId, 'movie', movies.categories, movies.channels)
        result.movies = counts.channels
        result.categories += counts.categories
      }
      if (series) {
        const counts = importCatalog(playlistId, 'series', series.categories, series.channels)
        result.series = counts.channels
        result.categories += counts.categories
      }
    } else {
      throw new Error('Stalker portal sync is not implemented yet')
    }

    markSynced(playlistId)

    // Stored identifications for streams that have expired: the table would
    // otherwise keep a row for every channel the provider ever offered.
    pruneProbes()
    result.durationMs = Date.now() - started
    emit('done', `Done in ${(result.durationMs / 1000).toFixed(1)}s`, 1)
    return result
  } catch (error) {
    const message = errorMessage(error)
    log.error(`sync failed for playlist ${playlistId}`, message)
    emit('error', message, null)
    throw new Error(message)
  }
}

/**
 * VOD endpoints are optional — plenty of panels return 404 for movies or
 * series. A missing section must not fail the whole sync.
 */
async function safely<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn()
  } catch (error) {
    log.warn('optional catalog section unavailable', errorMessage(error))
    return null
  }
}
