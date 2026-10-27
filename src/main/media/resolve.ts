import type { StreamSource } from '@shared/types'
import { canReplay, durationMinutes, formatStart } from '@shared/catchup'
import { getChannel } from '@main/db/repo/catalog'
import { getPlaylist } from '@main/db/repo/playlists'
import { getDownload } from '@main/db/repo/downloads'
import { getRecording } from '@main/db/repo/recordings'
import { getEpisode } from '@main/db/repo/vod'
import { xtreamClientFor } from '@main/sources'

export interface ProviderStream {
  url: string
  userAgent: string | null
  referrer: string | null
  label: string
  /** Seconds, when the length is known ahead of time. */
  durationSecs: number | null
  /**
   * A live channel rather than a film, episode or local file.
   *
   * Known from the catalogue, so it does not have to be discovered by asking
   * the provider — which is the whole point when connections are scarce.
   */
  isLive: boolean
  /**
   * The same item requested with a different container extension.
   *
   * Xtream panels report a `container_extension` per item and then serve
   * something else — a series listed as `.mkv` that is really `.mp4` answers the
   * `.mkv` request with an error page, and ffmpeg reports "EBML header parsing
   * failed", which points at the file rather than at the address. Trying the
   * other extensions costs one small HTTP request and fixes it silently.
   */
  alternates: string[]
}

/**
 * Extensions worth retrying, most likely first. Ordered by what panels
 * actually serve, not by what they claim.
 */
const VOD_EXTENSIONS = ['mp4', 'mkv', 'avi', 'ts', 'm3u8']

function withOtherExtensions(url: string, extension: string): string[] {
  const suffix = `.${extension}`
  const stem = url.endsWith(suffix) ? url.slice(0, -suffix.length) : url

  return VOD_EXTENSIONS.filter((candidate) => candidate !== extension.toLowerCase()).map(
    (candidate) => `${stem}.${candidate}`
  )
}

/**
 * Turns a UI-level reference into the real provider URL.
 *
 * This runs in the main process only, and its result is deliberately never sent
 * to the renderer: for Xtream sources the URL embeds the account password.
 */
export function resolveProviderStream(source: StreamSource): ProviderStream {
  if (source.type === 'recording') {
    const recording = getRecording(source.id)
    if (!recording?.filePath) throw new Error('Recording file is missing')
    return {
      url: recording.filePath,
      userAgent: null,
      referrer: null,
      label: recording.title,
      durationSecs: null,
      isLive: false,
      alternates: []
    }
  }

  if (source.type === 'download') {
    const download = getDownload(source.id)
    if (!download?.filePath || download.status !== 'completed') {
      throw new Error('That download is not finished yet')
    }
    return {
      url: download.filePath,
      userAgent: null,
      referrer: null,
      label: download.title,
      durationSecs: null,
      isLive: false,
      alternates: []
    }
  }

  if (source.type === 'episode') {
    const episode = getEpisode(source.id)
    if (!episode) throw new Error('Episode not found')

    const channel = getChannel(episode.channelId)
    if (!channel) throw new Error('Series not found')

    const playlist = getPlaylist(channel.playlistId)
    if (!playlist || playlist.kind !== 'xtream') throw new Error('Episodes require an Xtream source')

    const extension = episode.containerExtension ?? 'mp4'
    const client = xtreamClientFor(playlist)

    return {
      url: client.seriesEpisodeUrl(episode.externalId, extension),
      userAgent: playlist.userAgent,
      referrer: playlist.referrer,
      label: `${channel.name} S${episode.season}E${episode.episode}`,
      durationSecs: episode.durationSecs,
      isLive: false,
      alternates: withOtherExtensions(
        client.seriesEpisodeUrl(episode.externalId, extension),
        extension
      )
    }
  }

  const channel = getChannel(source.id)
  if (!channel) throw new Error('Channel not found')

  const playlist = getPlaylist(channel.playlistId)
  if (!playlist) throw new Error('Playlist not found')

  if (source.type === 'catchup') {
    if (playlist.kind !== 'xtream') throw new Error('Catch-up needs an Xtream source')
    if (channel.catchupDays <= 0) throw new Error('This channel has no catch-up archive')
    if (!canReplay(source, channel.catchupDays)) {
      throw new Error('That programme is outside the archive this channel keeps')
    }

    const client = xtreamClientFor(playlist)
    const start = formatStart(source.startsAt, playlist.serverTimezone)
    const minutes = durationMinutes(source)

    // Panels are split roughly evenly between the query form and the path
    // form, neither is documented, and the one that is not supported answers
    // with an error page rather than a redirect. Offering both lets the
    // existing "the provider serves something else here" path sort it out with
    // one small request instead of a support thread.
    return {
      url: client.timeshiftUrl(channel.externalId, start, minutes),
      userAgent: playlist.userAgent,
      referrer: playlist.referrer,
      label: `${channel.name} (catch-up)`,
      durationSecs: Math.round((source.endsAt - source.startsAt) / 1000),
      // Not live: it is a finished recording with a known length, and treating
      // it as live would cost it its seek bar.
      isLive: false,
      alternates: [client.timeshiftPathUrl(channel.externalId, start, minutes)]
    }
  }

  let url = channel.streamUrl
  let alternates: string[] = []
  const isLive = channel.kind === 'live'

  // Xtream URLs are rebuilt on demand rather than stored, so the password is
  // never written to the database and a password change needs no re-sync.
  if (playlist.kind === 'xtream' && !channel.externalId.startsWith('series:')) {
    const client = xtreamClientFor(playlist)

    if (channel.externalId.startsWith('vod:')) {
      const extension = channel.containerExtension ?? 'mp4'
      url = client.vodStreamUrl(channel.externalId.slice(4), extension)
      alternates = withOtherExtensions(url, extension)
    } else {
      // Live is left alone: its extension is part of how the panel routes the
      // request, and it is the one path that has always worked.
      url = client.liveStreamUrl(channel.externalId, channel.containerExtension ?? 'ts')
    }
  }

  if (!url) throw new Error('This item has no directly playable stream')

  return {
    url,
    userAgent: playlist.userAgent,
    referrer: playlist.referrer,
    label: channel.name,
    durationSecs: null,
    isLive,
    alternates
  }
}
