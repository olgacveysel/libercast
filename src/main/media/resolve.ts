import type { StreamSource } from '@shared/types'
import { canReplay, durationMinutes, formatStart } from '@shared/catchup'
import { getChannel } from '@main/db/repo/catalog'
import { getPlaylist } from '@main/db/repo/playlists'
import { getDownload } from '@main/db/repo/downloads'
import { getRecording } from '@main/db/repo/recordings'
import { getEpisode } from '@main/db/repo/vod'
import { stalkerClientFor, xtreamClientFor } from '@main/sources'
import { isBlocked } from '@main/secure/parental'

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
 * to the renderer: for Xtream sources the URL embeds the account password, and
 * for Stalker portals it is a signed link tied to the MAC.
 *
 * Asynchronous because of those portals. Every other source can build a URL
 * from what is already in the database; a Stalker channel holds a `cmd` rather
 * than an address, and the portal has to be asked to turn it into a link that
 * works for the next few minutes. There is no version of that which is not a
 * network round trip at the moment of pressing play.
 */
/**
 * Why a stream is being resolved.
 *
 * `play` means a person is about to watch it, and the parental lock applies.
 * `record` and `download` write a file for later; the lock is applied when
 * that file is played instead. `scan` is the health check, which opens a
 * stream and reads nothing a person sees.
 */
export type ResolvePurpose = 'play' | 'record' | 'download' | 'scan'

/** The lock check used by the two branches that return a file from disk. */
function assertPlayable(channelId: number, kind: 'recording' | 'download'): void {
  const channel = getChannel(channelId)
  // A channel removed by a later sync leaves the file with nothing to check
  // against. Refusing would strand files a parent recorded deliberately, so
  // an unknown channel is treated as it was when the file was made.
  if (!channel) return

  if (isBlocked({ categoryId: channel.categoryId, isAdult: channel.isAdult, name: channel.name })) {
    throw new Error(
      kind === 'recording'
        ? 'This recording is of a locked channel. Unlock parental controls to play it.'
        : 'This download is of a locked channel. Unlock parental controls to play it.'
    )
  }
}

/**
 * The protocols a provider's stream may use.
 *
 * ffmpeg opens a great deal more than this. `file:` reads any file the
 * application can; `concat:` reads a list of them; `data:` and `pipe:` are
 * stranger still. The strings reaching here are not ours — an M3U playlist is
 * somebody else's text file, and its `#EXTINF` lines decide what gets opened
 * — so what may be opened is named rather than guessed at.
 *
 * The list is the protocols IPTV actually uses, not just the obvious two. A
 * good number of real playlists carry `rtmp` for a legacy panel, `rtsp` for a
 * camera, or `udp`/`rtp` for a multicast feed on a local network, and an
 * allowlist of http alone would quietly break all of them.
 */
const STREAM_PROTOCOLS = new Set([
  'http',
  'https',
  'rtmp',
  'rtmpe',
  'rtmps',
  'rtmpt',
  'rtmpts',
  'rtsp',
  'rtsps',
  'rtspu',
  'udp',
  'rtp',
  'srt',
  'mms',
  'mmsh',
  'mmst',
  'ftp',
  'ftps'
])

/**
 * Refuses anything that is not a network stream.
 *
 * Parsed by hand rather than with `new URL`, for two reasons: `udp://@239.0.0.1:1234`
 * is a shape `URL` dislikes and ffmpeg is happy with, and `C:\clips\x.ts`
 * parses as the scheme `c:` — so a Windows path would otherwise arrive
 * looking like a protocol.
 */
export function assertNetworkStream(url: string): void {
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(url.trim())

  // No scheme at all is a local path, whatever else it is.
  if (!match) throw new Error('That source has no stream address, only a file path.')

  const scheme = match[1]!.toLowerCase()

  // A single letter is a drive, not a protocol.
  if (scheme.length === 1 || !STREAM_PROTOCOLS.has(scheme)) {
    throw new Error(`LiberCast will not open "${scheme}:" sources — only network streams.`)
  }
}

export async function resolveProviderStream(
  source: StreamSource,
  purpose: ResolvePurpose = 'play'
): Promise<ProviderStream> {
  const resolved = await resolveSource(source, purpose)

  /*
   * Checked here, once, rather than in each branch.
   *
   * There are eight places below that produce a URL and more will be added;
   * a check per branch is a check somebody forgets. A recording and a
   * download are the two exceptions, and they are exceptions by construction
   * — those paths were written by this application, into a folder it chose.
   */
  if (source.type !== 'recording' && source.type !== 'download') {
    assertNetworkStream(resolved.url)
    for (const alternate of resolved.alternates) assertNetworkStream(alternate)
  }

  return resolved
}

async function resolveSource(
  source: StreamSource,
  purpose: ResolvePurpose
): Promise<ProviderStream> {
  const locked = purpose === 'play'

  if (source.type === 'recording') {
    const recording = getRecording(source.id)
    if (!recording?.filePath) throw new Error('Recording file is missing')

    // A file on disk is still the channel it came from. This branch returned
    // before the check below, so a locked channel recorded earlier played
    // back with no PIN at all — which is the one case parental controls most
    // obviously exist for.
    if (locked && recording.channelId !== null) assertPlayable(recording.channelId, 'recording')

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

    // Same reasoning as a recording: the file is the channel it came from.
    if (locked && download.channelId !== null) assertPlayable(download.channelId, 'download')

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
    if (!playlist) throw new Error('Series not found')

    // The episode branch returns before the shared check below, so it makes
    // its own. The flags live on the series, not the episode.
    if (
      locked &&
      isBlocked({ categoryId: channel.categoryId, isAdult: channel.isAdult, name: channel.name })
    ) {
      throw new Error('This series is locked. Unlock parental controls to play it.')
    }

    // A portal names an episode by a number out of the show's own list, and
    // plays it with the show's command plus that number. There is no
    // per-episode address to build, so the link is fetched now, as it is for
    // everything else on a portal.
    if (playlist.kind === 'stalker') {
      if (!channel.streamUrl) {
        throw new Error('This series has no portal command saved. Re-sync the source.')
      }
      const number = Number.parseInt(episode.externalId, 10)
      if (!Number.isFinite(number)) throw new Error('This episode has no portal number saved.')

      return {
        url: await stalkerClientFor(playlist).vodUrl(channel.streamUrl, number),
        userAgent: playlist.userAgent,
        referrer: playlist.referrer,
        label: `${channel.name} - ${episode.title}`,
        durationSecs: episode.durationSecs,
        isLive: false,
        alternates: []
      }
    }

    if (playlist.kind !== 'xtream') throw new Error('Episodes require an Xtream source or a portal')

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
  if (!channel) {
    // Channel ids survive a re-sync — they are keyed on the provider's own id
    // — so a missing one means the provider stopped listing it, or the source
    // was removed. "Channel not found" is true and tells the user nothing they
    // can act on.
    throw new Error(
      'That channel is no longer in this source. The provider may have dropped it, ' +
        'or the source was removed — sync it again, or pick another channel.'
    )
  }

  const playlist = getPlaylist(channel.playlistId)
  if (!playlist) throw new Error('Playlist not found')

  /*
   * The parental lock, enforced where the content is actually fetched.
   *
   * It used to be applied only when a list was drawn, which hides locked
   * channels and stops there. Anything holding a channel id — a favourite, a
   * recent item, the resume card, a number typed on the remote — went
   * straight past it. This function is the one place every one of those ends
   * up, which is why the check belongs here rather than in four handlers that
   * each have to remember.
   *
   * But only for `play`. The first version of this gated acquisition too, and
   * that was the wrong line to draw: writing a locked channel to disk shows a
   * child nothing, while playing the file back shows them everything — and
   * the file branches above returned before any check at all.
   *
   * It also broke something that worked. A parent schedules a recording while
   * unlocked; the lock re-engages half an hour later, on its own, by design;
   * at two in the morning the recorder asks for the stream and is refused. A
   * decision the parent had already made, undone by a timer, silently.
   *
   * So the gate is on watching: `play` is checked, `record` and `download`
   * are not, and the recording or download that results is checked when
   * somebody tries to watch it.
   */
  if (
    locked &&
    isBlocked({ categoryId: channel.categoryId, isAdult: channel.isAdult, name: channel.name })
  ) {
    throw new Error('This channel is locked. Unlock parental controls to play it.')
  }

  if (source.type === 'catchup') {
    if (channel.catchupDays <= 0) throw new Error('This channel has no catch-up archive')
    if (!canReplay(source, channel.catchupDays)) {
      throw new Error('That programme is outside the archive this channel keeps')
    }

    /*
     * A portal does not address its archive by clock.
     *
     * An Xtream panel takes a start time and a length and builds a URL from
     * them, so nothing has to be looked up. A portal keeps a list of discrete
     * recordings, each with its own command, and replaying a moment means
     * finding the recording that covers it first — one request before
     * playback, and a different failure when the archive does not reach back
     * that far.
     */
    if (playlist.kind === 'stalker') {
      return {
        url: await stalkerClientFor(playlist).archiveUrl(channel.externalId, source.startsAt),
        userAgent: playlist.userAgent,
        referrer: playlist.referrer,
        label: `${channel.name} (catch-up)`,
        durationSecs: Math.round((source.endsAt - source.startsAt) / 1000),
        isLive: false,
        alternates: []
      }
    }

    if (playlist.kind !== 'xtream') throw new Error('Catch-up needs an Xtream source or a portal')

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

  // A portal channel stores the `cmd` the portal gave us, not an address. The
  // link is fetched now, used now, and never stored: it expires in minutes and
  // on some portals works exactly once.
  if (playlist.kind === 'stalker') {
    if (!url) throw new Error('This title has no portal command saved. Re-sync the source.')
    const client = stalkerClientFor(playlist)

    // A film and a channel are fetched through different handlers, and the
    // live one must not be used for a film: its last-resort attempt rebuilds
    // the command as `/ch/<external id>`, and a film's external id is
    // `vod:17` — a channel that does not exist. The live path also passes the
    // external id for exactly that rebuild, which is why it is only given
    // here, for channels.
    url = isLive
      ? await client.streamUrl(url, channel.externalId)
      : await client.vodUrl(url)

    return {
      url,
      userAgent: playlist.userAgent,
      referrer: playlist.referrer,
      label: channel.name,
      durationSecs: null,
      isLive,
      alternates: []
    }
  }

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
