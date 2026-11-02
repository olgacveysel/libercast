import type { AlternateChoice, AlternateOffer, StreamRequest, SwitchedSource } from '@shared/types'
import { getChannel } from '@main/db/repo/catalog'
import { getPlaylist } from '@main/db/repo/playlists'
import { clearHealth } from '@main/db/repo/health'
import { getSettings } from '@main/db/repo/settings'
import { findAlternates, type MatchConfidence } from '@main/sources/failover'
import { createLogger, errorMessage } from '@main/util/logger'
import { resolveProviderStream, type ProviderStream } from './resolve'
import { streamServer, type OpenedSession } from './streamServer'

const log = createLogger('failover')

export type SwitchReport = SwitchedSource

export interface OpenOutcome {
  session: OpenedSession
  provider: ProviderStream
  /** Set only when a different source than the one requested is playing. */
  switched: SwitchReport | null
  /** The channel that ended up playing, for a retry that has to skip it. */
  playingChannelId: number | null
}

/**
 * What `openStream` came back with: a stream, or a question.
 *
 * The question is not a failure. Nothing played, but something probably could
 * — and the only thing standing in the way is that a person has to confirm the
 * name, which the main process is in no position to do.
 */
export type OpenResult =
  | { kind: 'playing'; outcome: OpenOutcome }
  | { kind: 'choose'; choice: AlternateChoice }

/**
 * How many other providers are worth trying.
 *
 * Each attempt costs a connection on that account and a few seconds of the
 * user staring at a spinner. Two is enough to cover "my main source died" and
 * "my backup is also busy" without turning a dead channel into a long wait.
 */
const MAX_ALTERNATES = 2

/**
 * How many uncertain alternates are worth putting in front of someone.
 *
 * A list of near-matches is a different problem from a dead channel. Three is
 * enough to cover "my other two providers carry it" and few enough to read
 * while a match is going on.
 */
const MAX_OFFERS = 3

interface Candidate {
  channelId: number
  sourceName: string
  channelName: string
  /**
   * How sure we are this is the right channel. The channel the user asked for
   * is `exact` by definition — it is the one they named.
   */
  confidence: MatchConfidence
}

function describeChannel(channelId: number): Candidate | null {
  const channel = getChannel(channelId)
  if (!channel) return null
  const playlist = getPlaylist(channel.playlistId)
  return {
    channelId,
    channelName: channel.name,
    sourceName: playlist?.name ?? 'this source',
    confidence: 'exact'
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
export async function openStream(request: StreamRequest): Promise<OpenResult> {
  const settings = getSettings()
  const mode = settings.sourceFailover
  const dead = request.exclude ?? []
  const approved = new Set(request.allow ?? [])

  // Only live channels have a counterpart elsewhere. A recording, a download
  // or a specific series episode is the one file it is — and a catch-up window
  // is addressed by clock against one panel's archive, so the "same" programme
  // on another provider is a different recording at different times, not a
  // fallback.
  const canFailOver =
    mode !== 'off' && request.source.type === 'channel' && !isVod(request.source.id)

  const requested = request.source.type === 'channel' ? describeChannel(request.source.id) : null
  const skipRequested = requested !== null && dead.includes(requested.channelId)

  const chain: Candidate[] = []
  if (requested !== null && !skipRequested) chain.push(requested)
  else if (requested === null) {
    chain.push({ channelId: -1, sourceName: '', channelName: '', confidence: 'exact' })
  }

  // Alternates that were found but are not ours to play: the name was only
  // similar, and nobody has looked at it yet. Collected rather than dropped,
  // because "I could not play this, but this other thing might be it" is a
  // more useful answer than an error.
  const offers: AlternateOffer[] = []
  let playable = 0

  if (canFailOver && requested !== null) {
    for (const alternate of findAlternates(requested.channelId, dead)) {
      const candidate: Candidate = {
        channelId: alternate.channelId,
        channelName: alternate.name,
        sourceName: alternate.playlistName,
        confidence: alternate.confidence
      }

      // An exact match is the same channel with a different feed description,
      // so it plays. Anything less is a guess, and a guess is only playable
      // once a person has agreed to it.
      const allowed = candidate.confidence === 'exact' || approved.has(candidate.channelId)

      if (allowed) {
        if (playable < MAX_ALTERNATES) {
          chain.push(candidate)
          playable += 1
        }
        continue
      }

      // `confident` found nothing it was sure of and will not ask; the user
      // chose to hear that the source failed rather than be interrupted.
      if (mode === 'ask' && offers.length < MAX_OFFERS) {
        offers.push({
          channelId: candidate.channelId,
          channelName: candidate.channelName,
          sourceName: candidate.sourceName
        })
      }
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
      //
      // An unanswered offer counts as somewhere left to go. Playing on through
      // a definitive refusal is the right call only when the alternative is a
      // black screen; when there is a name worth asking about, continuing to
      // push a 403 page at the user while saying nothing about it is not a
      // kindness.
      if (session.refused && (index < chain.length - 1 || offers.length > 0)) {
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
                to: candidate.sourceName,
                requestedChannelId: requested.channelId,
                alternateChannelId: candidate.channelId
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
        kind: 'playing',
        outcome: {
          session,
          provider,
          switched,
          playingChannelId: candidate.channelId === -1 ? null : candidate.channelId
        }
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
  const reason = errorMessage(firstError ?? new Error('That stream could not be opened'))

  // Nothing played, but something here might be the right channel. Asking is
  // the only honest move left: the names differ, and no threshold decides
  // whether "Turkey" on the end is a region or a spelling.
  if (offers.length > 0 && requested !== null) {
    log.info(
      `nothing played for "${requested.channelName}"; offering ${offers.length} ` +
        `similar name(s): ${offers.map((offer) => `"${offer.channelName}"`).join(', ')}`
    )
    return {
      kind: 'choose',
      choice: {
        reason,
        channelName: requested.channelName,
        fromSource: requested.sourceName,
        offers
      }
    }
  }

  throw firstError ?? new Error('That stream could not be opened')
}

/** Films and episodes live in the channels table too, and have no counterpart. */
function isVod(channelId: number): boolean {
  return getChannel(channelId)?.kind !== 'live'
}
