import type { Playlist, PlaylistDraft, SyncProgress, SyncResult, XtreamAccountInfo } from '@shared/types'
import { importCatalog } from '@main/db/repo/import'
import { getPlaylist, markSynced, setServerTimezone } from '@main/db/repo/playlists'
import { pruneHealth } from '@main/db/repo/health'
import { pruneProbes } from '@main/db/repo/probeCache'
import { getPassword } from '@main/secure/credentials'
import { createLogger, errorMessage } from '@main/util/logger'
import type { FetchOptions } from '@main/util/http'
import { loadM3u } from './m3u'
import { XtreamClient } from './xtream'
import { StalkerClient, isMacAddress, normalizeMac } from './stalker'

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
 * The portal client for a source, kept between plays.
 *
 * Unlike the Xtream client, which is a URL builder and costs nothing to make,
 * this one holds a session: a handshake token and the endpoint that answered.
 * Rebuilding it per play would mean two extra round trips every time someone
 * changes channel, so it is cached — and dropped the moment the credentials or
 * the address change, because a cached session for the wrong account is worse
 * than no cache at all.
 */
const portals = new Map<number, { key: string; client: StalkerClient }>()

export function stalkerClientFor(playlist: Playlist): StalkerClient {
  if (playlist.kind !== 'stalker') throw new Error('Playlist is not a Stalker portal')
  if (!playlist.url) throw new Error('The portal address is missing')
  if (!playlist.macAddress) throw new Error('This portal has no MAC address saved')

  const key = `${playlist.url}|${playlist.macAddress}|${playlist.serverTimezone ?? ''}`
  const cached = portals.get(playlist.id)
  if (cached && cached.key === key) return cached.client

  const client = new StalkerClient(
    {
      portalUrl: playlist.url,
      macAddress: playlist.macAddress,
      timezone: playlist.serverTimezone
    },
    fetchOptions(playlist)
  )
  portals.set(playlist.id, { key, client })
  return client
}

/** Drops a cached portal session, for a source that was edited or removed. */
export function forgetPortal(playlistId: number): void {
  portals.delete(playlistId)
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

  if (draft.kind === 'stalker') {
    if (!draft.url) throw new Error('The portal address is required')
    if (!draft.macAddress) throw new Error('The MAC address your provider gave you is required')
    if (!isMacAddress(draft.macAddress)) {
      throw new Error(
        'That does not look like a MAC address. It should be twelve hexadecimal ' +
          'digits, usually written like 00:1A:79:12:34:56.'
      )
    }

    const client = new StalkerClient(
      {
        portalUrl: draft.url,
        macAddress: normalizeMac(draft.macAddress),
        timezone: null
      },
      { userAgent: draft.userAgent, referrer: draft.referrer, timeoutMs: 25_000 }
    )
    await client.authenticate()
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
      const account = await client.authenticate()

      // The panel's clock, kept for catch-up URLs. It comes free with the
      // authentication this sync already had to do.
      setServerTimezone(playlistId, account.timezone)

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
      emit('connecting', 'Signing in to the portal…', 0.05)
      const client = stalkerClientFor(playlist)
      await client.authenticate()

      emit('live', 'Loading channels…', 0.2)
      const catalog = await client.liveCatalog((loaded, total) => {
        const ratio = total && total > 0 ? Math.min(loaded / total, 1) : null
        emit(
          'live',
          total ? `Loading channels… ${loaded} of ${total}` : `Loading channels… ${loaded}`,
          ratio === null ? null : 0.2 + ratio * 0.6
        )
      })

      // A portal that signs in and then lists nothing is not a working sync.
      // It means the subscription is empty, expired, or bound to a different
      // device — and reporting "0 channels, done" would send the user looking
      // at this application instead of at their provider.
      if (catalog.channels.length === 0) {
        throw new Error(
          'The portal signed in but offered no channels. The subscription may have ' +
            'expired, or it may be registered to a different MAC address.'
        )
      }

      // Films and shows, where the portal has them. Behind `safely` for the
      // same reason Xtream's are: plenty of portals sell live TV and nothing
      // else, and refusing the VOD actions is how they say so. Losing the
      // channels that did arrive over that would be the wrong trade.
      emit('movies', 'Loading films…', 0.72)
      const movies = await safely(() => client.movieCatalog())

      emit('series', 'Loading series…', 0.8)
      const series = await safely(() => client.seriesCatalog())

      emit('saving', `Saving ${catalog.channels.length} channels…`, 0.9)
      const counts = importCatalog(playlistId, 'live', catalog.categories, catalog.channels)
      result.categories = counts.categories
      result.liveChannels = counts.channels
      result.removed = counts.removed

      if (movies && movies.channels.length > 0) {
        const vodCounts = importCatalog(playlistId, 'movie', movies.categories, movies.channels)
        result.movies = vodCounts.channels
        result.categories += vodCounts.categories
      }
      if (series && series.channels.length > 0) {
        const seriesCounts = importCatalog(playlistId, 'series', series.categories, series.channels)
        result.series = seriesCounts.channels
        result.categories += seriesCounts.categories
      }
    }

    markSynced(playlistId)

    // Stored identifications for streams that have expired: the table would
    // otherwise keep a row for every channel the provider ever offered. Scan
    // verdicts too old to mean anything go the same way.
    pruneProbes()
    pruneHealth()
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
