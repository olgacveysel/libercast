import type { SeriesEpisode, SeriesSeason, VodInfo } from '@shared/types'
import { getChannel } from '@main/db/repo/catalog'
import { getPlaylist } from '@main/db/repo/playlists'
import * as vodRepo from '@main/db/repo/vod'
import { createLogger, errorMessage } from '@main/util/logger'
import { enrich } from './tmdbMeta'
import { xtreamClientFor } from './index'

const log = createLogger('vod')

/**
 * Returns cached metadata immediately when present, and otherwise fetches it
 * once and stores it. Fetching for every title during sync would mean thousands
 * of requests, so this is deliberately lazy.
 */
export async function movieInfo(channelId: number, force = false): Promise<VodInfo | null> {
  const cached = vodRepo.getVodInfo(channelId)
  // Enrichment is applied on the way out rather than stored: the provider's
  // row stays the provider's, and a user who removes their key gets their
  // catalogue back exactly as it was.
  if (cached && !force) return enrich(channelId, cached)

  const channel = getChannel(channelId)
  if (!channel) throw new Error('Title not found')

  const playlist = getPlaylist(channel.playlistId)
  // An M3U source has no metadata endpoint at all, which is the case this
  // feature exists for: there is nothing to ask, so go straight to TMDB.
  if (!playlist || playlist.kind !== 'xtream') return enrich(channelId, cached)

  try {
    const client = xtreamClientFor(playlist)
    const info = await client.movieInfo(channel.externalId.replace(/^vod:/, ''))
    return enrich(channelId, vodRepo.saveVodInfo(channelId, info))
  } catch (error) {
    // A panel that does not expose get_vod_info should still show the poster
    // and play the film, so this degrades rather than throwing.
    log.warn(`movie info unavailable for channel ${channelId}`, errorMessage(error))
    return enrich(channelId, cached)
  }
}

export interface SeriesDetail {
  info: VodInfo | null
  seasons: SeriesSeason[]
}

export async function seriesDetail(channelId: number, force = false): Promise<SeriesDetail> {
  const channel = getChannel(channelId)
  if (!channel) throw new Error('Series not found')

  const needsFetch = force || !vodRepo.hasEpisodes(channelId)

  if (needsFetch) {
    const playlist = getPlaylist(channel.playlistId)
    if (playlist?.kind === 'xtream') {
      const client = xtreamClientFor(playlist)
      const { info, episodes } = await client.seriesInfo(channel.externalId.replace(/^series:/, ''))
      if (episodes.length > 0) vodRepo.saveEpisodes(channelId, episodes)
      vodRepo.saveVodInfo(channelId, info)
    }
  }

  return {
    info: await enrich(channelId, vodRepo.getVodInfo(channelId)),
    seasons: vodRepo.listSeasons(channelId)
  }
}

export function nextEpisodeOf(episodeId: number): SeriesEpisode | null {
  return vodRepo.nextEpisode(episodeId)
}

export function previousEpisodeOf(episodeId: number): SeriesEpisode | null {
  return vodRepo.previousEpisode(episodeId)
}
