import type { SeriesEpisode, SeriesSeason, VodInfo } from '@shared/types'
import { getChannel } from '@main/db/repo/catalog'
import { getPlaylist } from '@main/db/repo/playlists'
import * as vodRepo from '@main/db/repo/vod'
import { createLogger, errorMessage } from '@main/util/logger'
import { xtreamClientFor } from './index'

const log = createLogger('vod')

/**
 * Returns cached metadata immediately when present, and otherwise fetches it
 * once and stores it. Fetching for every title during sync would mean thousands
 * of requests, so this is deliberately lazy.
 */
export async function movieInfo(channelId: number, force = false): Promise<VodInfo | null> {
  const cached = vodRepo.getVodInfo(channelId)
  if (cached && !force) return cached

  const channel = getChannel(channelId)
  if (!channel) throw new Error('Title not found')

  const playlist = getPlaylist(channel.playlistId)
  if (!playlist || playlist.kind !== 'xtream') return cached

  try {
    const client = xtreamClientFor(playlist)
    const info = await client.movieInfo(channel.externalId.replace(/^vod:/, ''))
    return vodRepo.saveVodInfo(channelId, info)
  } catch (error) {
    // A panel that does not expose get_vod_info should still show the poster
    // and play the film, so this degrades rather than throwing.
    log.warn(`movie info unavailable for channel ${channelId}`, errorMessage(error))
    return cached
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

  return { info: vodRepo.getVodInfo(channelId), seasons: vodRepo.listSeasons(channelId) }
}

export function resolveEpisodeStream(episodeId: number): { url: string; headers: Record<string, string> } {
  const episode = vodRepo.getEpisode(episodeId)
  if (!episode) throw new Error('Episode not found')

  const channel = getChannel(episode.channelId)
  if (!channel) throw new Error('Series not found')

  const playlist = getPlaylist(channel.playlistId)
  if (!playlist || playlist.kind !== 'xtream') throw new Error('Episodes require an Xtream source')

  const client = xtreamClientFor(playlist)
  return {
    url: client.seriesEpisodeUrl(episode.externalId, episode.containerExtension ?? 'mp4'),
    headers: {}
  }
}

export function nextEpisodeOf(episodeId: number): SeriesEpisode | null {
  return vodRepo.nextEpisode(episodeId)
}

export function previousEpisodeOf(episodeId: number): SeriesEpisode | null {
  return vodRepo.previousEpisode(episodeId)
}
