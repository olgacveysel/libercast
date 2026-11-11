import type { EpgAutoMatchResult, EpgGuideChannel, EpgMatchSuggestion, EpgRefreshResult, Playlist } from '@shared/types'
import * as epgRepo from '@main/db/repo/epg'
import { getPlaylist } from '@main/db/repo/playlists'
import { createLogger } from '@main/util/logger'
import { xtreamClientFor } from './index'
import { ACCEPT_SCORE, bestMatch, rankCandidates } from './epgMatch'
import { loadXmltv } from './xmltv'

const log = createLogger('epg')

/** Guide entries older than this are dropped on every refresh. */
const KEEP_PAST_HOURS = 6

/** Nothing further ahead than this is stored; providers often send 14+ days. */
const KEEP_FUTURE_DAYS = 8

/**
 * Where the guide comes from: an explicit XMLTV url on the playlist wins,
 * otherwise the Xtream panel's own xmltv.php endpoint.
 */
export function resolveEpgUrl(playlist: Playlist): string {
  if (playlist.epgUrl) return playlist.epgUrl
  if (playlist.kind === 'xtream') return xtreamClientFor(playlist).xmltvUrl()
  throw new Error('This source has no EPG URL. Add an XMLTV URL in its settings.')
}

export async function refreshEpg(playlistId: number): Promise<EpgRefreshResult> {
  const playlist = getPlaylist(playlistId)
  if (!playlist) throw new Error(`Playlist ${playlistId} not found`)

  const started = Date.now()
  const sourceUrl = resolveEpgUrl(playlist)

  const keepAfter = started - KEEP_PAST_HOURS * 3_600_000
  const keepBefore = started + KEEP_FUTURE_DAYS * 86_400_000

  /*
   * The old guide stays until the new one has arrived.
   *
   * It used to be deleted here, before the download, so that a provider
   * renumbering its channel ids could not leave an orphaned second copy
   * behind. That reasoning is sound and the remedy was not: any failure
   * between then and the end — a slow feed, a 404, a dropped connection —
   * left the user with no guide at all, and nothing to put back.
   *
   * So both sets exist briefly, told apart by the autoincrement id, and
   * whichever one is wrong is dropped at the end. The guide may show
   * duplicates for the seconds a refresh takes; that is a far better failure
   * than an empty one.
   */
  const watermark = epgRepo.programmeWatermark(playlistId)

  let stored = 0
  const guideChannels: EpgGuideChannel[] = []

  try {
    await loadXmltv(sourceUrl, {
      userAgent: playlist.userAgent,
      referrer: playlist.referrer,
      offsetMinutes: playlist.epgOffsetMinutes,
      keepAfter,
      keepBefore,
      onChannel: (channel) => {
        guideChannels.push({
          epgChannelId: channel.id,
          displayName: channel.displayName,
          iconUrl: channel.iconUrl
        })
      },
      onBatch: (programmes) => {
        stored += epgRepo.insertPrograms(playlistId, programmes)
      }
    })
  } catch (error) {
    // Put it back the way it was: drop the half-written new set, keep the old.
    epgRepo.dropProgramsAfter(playlistId, watermark)
    log.error('EPG refresh failed; the previous guide has been kept', error)
    throw error
  }

  /*
   * A feed that parsed to nothing is not a reason to throw the guide away.
   *
   * It happens: an error page served with a 200, a feed that is briefly
   * empty, a URL that now points somewhere else. Treated as success it would
   * delete a working guide and replace it with nothing.
   */
  if (stored === 0 && watermark > 0) {
    epgRepo.dropProgramsAfter(playlistId, watermark)
    throw new Error(
      'The guide downloaded but contained no programmes. The previous guide has been kept.'
    )
  }

  // The new set is in and is worth having, so the old one goes.
  epgRepo.dropProgramsUpTo(playlistId, watermark)

  epgRepo.prunePrograms(keepAfter)
  epgRepo.replaceGuideChannels(playlistId, guideChannels)

  // Matching by name runs on every refresh: the feed's channel list changes,
  // and a channel that could not be matched last week may match now.
  const auto = autoMatch(playlistId)
  if (auto.matched > 0) {
    log.info(`matched ${auto.matched} channel(s) by name; ${auto.ambiguous} were too ambiguous to guess`)
  }

  const { matched, total } = epgRepo.coverage(playlistId)
  epgRepo.saveState(playlistId, stored, matched, sourceUrl)

  return {
    playlistId,
    programmes: stored,
    matchedChannels: matched,
    unmatchedChannels: Math.max(0, total - matched),
    sourceUrl,
    durationMs: Date.now() - started
  }
}

/**
 * Fills in guide ids by name for channels whose own id matches nothing.
 *
 * Only the matcher's previous guesses are reconsidered — a correction the user
 * made by hand is never overwritten, because being told your fix was undone is
 * worse than never having had the feature.
 */
export function autoMatch(playlistId: number): EpgAutoMatchResult {
  const candidates = epgRepo.listGuideChannels(playlistId).map((channel) => ({
    epgChannelId: channel.epgChannelId,
    displayName: channel.displayName
  }))

  if (candidates.length === 0) return { examined: 0, matched: 0, ambiguous: 0 }

  epgRepo.clearAutoOverrides(playlistId)

  const unmatched = epgRepo.matchRows(playlistId, true)
  let matched = 0
  let ambiguous = 0

  for (const row of unmatched) {
    // A manual override that simply has no programmes yet is left alone.
    if (row.overrideId && !row.overrideAuto) continue

    const match = bestMatch(row.channelName, candidates)
    if (!match) {
      ambiguous += 1
      continue
    }

    if (match.score < ACCEPT_SCORE) {
      ambiguous += 1
      continue
    }

    epgRepo.setOverride(row.channelId, match.epgChannelId, true)
    matched += 1
  }

  return { examined: unmatched.length, matched, ambiguous }
}

/** Ranked guide channels for one provider channel, for the override screen. */
export function suggestionsFor(playlistId: number, channelName: string): EpgMatchSuggestion[] {
  const candidates = epgRepo.listGuideChannels(playlistId).map((channel) => ({
    epgChannelId: channel.epgChannelId,
    displayName: channel.displayName
  }))

  return rankCandidates(channelName, candidates, 25)
}
