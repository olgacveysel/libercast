import type { StreamRequest } from '@shared/types'
import { getChannel } from '@main/db/repo/catalog'
import { getPlaylist } from '@main/db/repo/playlists'
import { clearHealth } from '@main/db/repo/health'
import { getSettings } from '@main/db/repo/settings'
import { findAlternates } from '@main/sources/failover'
import { createLogger, errorMessage } from '@main/util/logger'
import { resolveProviderStream, type ProviderStream } from './resolve'
import { streamServer, type OpenedSession } from './streamServer'

const log = createLogger('failover')

export interface SwitchReport {
  channelName: string
  /** The provider that was asked for, and the one that ended up playing. */
  from: string
  to: string
}

export interface OpenOutcome {
  session: OpenedSession
  provider: ProviderStream
  /** Set only when a different source than the one requested is playing. */
  switched: SwitchReport | null
  /** The channel that ended up playing, for a retry that has to skip it. */
  playingChannelId: number | null
}

/**
 * How many other providers are worth trying.
 *
 * Each attempt costs a connection on that account and a few seconds of the
 * user staring at a spinner. Two is enough to cover "my main source died" and
 * "my backup is also busy" without turning a dead channel into a long wait.
 */
const MAX_ALTERNATES = 2

interface Candidate {
  channelId: number
  sourceName: string
  channelName: string
}

function describeChannel(channelId: number): Candidate | null {
  const channel = getChannel(channelId)
  if (!channel) return null
  const playlist = getPlaylist(channel.playlistId)
  return {
    channelId,
    channelName: channel.name,
    sourceName: playlist?.name ?? 'this source'
  }
}

/**
 * Opens a stream, falling back to the same channel on another provider.
 *
 * One account dying mid-match is the most common thing that goes wrong with
 * IPTV, and a user with two sources is usually paying for the same match
 * twice. Walking to the other one is the difference between missing a goal and
 * never noticing.
 *
 * Failing over costs a connection on the other account, so it happens only on
 * a clear refusal: a thrown error, or a provider answering with an error
 * status or a web page where video should be. A panel that is merely busy, or
 * one whose stream ffprobe could not read, is played through exactly as
 * before — those usually work, and spending someone else's connection on a
 * guess is not a trade worth making.
 *
 * A refused source that is played anyway still holds a connection and an
 * ffmpeg process, so it is closed before the next one is tried. Leaving it
 * running would make failover cost two connections instead of one, on the
 * account that is already failing.
 */
export async function openStream(request: StreamRequest): Promise<OpenOutcome> {
  const settings = getSettings()
  const dead = request.exclude ?? []

  // Only live channels have a counterpart elsewhere. A recording, a download
  // or a specific series episode is the one file it is — and a catch-up window
  // is addressed by clock against one panel's archive, so the "same" programme
  // on another provider is a different recording at different times, not a
  // fallback.
  const canFailOver =
    settings.sourceFailover !== false && request.source.type === 'channel' && !isVod(request.source.id)

  const requested = request.source.type === 'channel' ? describeChannel(request.source.id) : null
  const skipRequested = requested !== null && dead.includes(requested.channelId)

  const chain: Candidate[] = []
  if (requested !== null && !skipRequested) chain.push(requested)
  else if (requested === null) chain.push({ channelId: -1, sourceName: '', channelName: '' })

  if (canFailOver && requested !== null) {
    for (const alternate of findAlternates(requested.channelId, dead).slice(0, MAX_ALTERNATES)) {
      chain.push({
        channelId: alternate.channelId,
        channelName: alternate.name,
        sourceName: alternate.playlistName
      })
    }
  }

  let firstError: unknown = null

  for (const [index, candidate] of chain.entries()) {
    const source =
      candidate.channelId === -1 ? request.source : ({ type: 'channel', id: candidate.channelId } as const)

    try {
      const provider = resolveProviderStream(source)
      const session = await streamServer.open({
        url: provider.url,
        alternates: provider.alternates,
        isLive: provider.isLive,
        frugal: settings.singleConnection,
        userAgent: provider.userAgent,
        referrer: provider.referrer,
        seekSecs: request.seekSecs,
        label: provider.label,
        owner: request.owner,
        audioTrack: request.audioTrack,
        subtitleTrack: request.subtitleTrack,
        preferredAudioLanguages: settings.preferredAudioLanguages,
        preferredSubtitleLanguages: settings.preferredSubtitleLanguages
      })

      // A refusal the server played through anyway: take the next source if
      // there is one, and give this connection back first.
      if (session.refused && index < chain.length - 1) {
        log.warn(
          `${candidate.channelName} was refused by ${candidate.sourceName}: ` +
            `${session.warning ?? 'no reason given'} — trying another source`
        )
        streamServer.close(session.id)
        if (firstError === null) firstError = new Error(session.warning ?? 'The provider refused the stream')
        continue
      }

      // Nothing was switched if the first link in the chain played, and there
      // is nothing to report when the caller never named a channel.
      const switched =
        index === 0 && !skipRequested
          ? null
          : requested === null
            ? null
            : {
                channelName: candidate.channelName,
                from: requested.sourceName,
                to: candidate.sourceName
              }

      // It played, so whatever the last scan concluded about it is out of
      // date. Clearing the mark here means the list corrects itself through
      // ordinary use rather than only after another scan.
      if (candidate.channelId !== -1) clearHealth(candidate.channelId)

      if (switched !== null) {
        log.info(
          `${switched.channelName}: ${switched.from} did not play, now on ${switched.to}`
        )
      }

      return {
        session,
        provider,
        switched,
        playingChannelId: candidate.channelId === -1 ? null : candidate.channelId
      }
    } catch (error) {
      if (firstError === null) firstError = error
      const remaining = chain.length - index - 1
      log.warn(
        `${candidate.channelName || 'stream'} failed on ${candidate.sourceName || 'its source'}: ` +
          `${errorMessage(error)}${remaining > 0 ? ` — trying ${remaining} more` : ''}`
      )
    }
  }

  // The message the user needs is the one about the channel they asked for,
  // not whatever the last backup happened to say.
  throw firstError ?? new Error('That stream could not be opened')
}

/** Films and episodes live in the channels table too, and have no counterpart. */
function isVod(channelId: number): boolean {
  return getChannel(channelId)?.kind !== 'live'
}
