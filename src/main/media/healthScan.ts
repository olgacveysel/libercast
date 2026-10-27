import type { ChannelHealth } from '@shared/types'
import { queryChannels } from '@main/db/repo/catalog'
import { recordHealth } from '@main/db/repo/health'
import { resolveProviderStream } from '@main/media/resolve'
import { inspectStream } from '@main/media/httpCheck'
import { createLogger, errorMessage } from '@main/util/logger'

const log = createLogger('health')

/**
 * Checks whether the favourites still play.
 *
 * IPTV lists rot constantly: a channel that worked last month answers 404 or
 * an HTML error page today, and the only way to find out is to open each one
 * and wait. Thirty favourites is a job worth doing once overnight; eight
 * thousand channels is not, which is why this is scoped to favourites and not
 * offered for the whole catalogue.
 *
 * Strictly one at a time. Most accounts allow one or two concurrent
 * connections, so a parallel scan would spend the evening failing against its
 * own other half and report healthy channels as dead.
 */

/** Space between checks, so a scan is not mistaken for a flood. */
const GAP_MS = 400

export interface ScanProgress {
  done: number
  total: number
  /** The channel being checked right now, for the progress line. */
  current: string
}

let cancelled = false

export function cancelScan(): void {
  cancelled = true
}

export async function scanFavorites(
  playlistId: number,
  onProgress: (progress: ScanProgress) => void
): Promise<ChannelHealth[]> {
  cancelled = false

  const favorites = queryChannels({ playlistId, kind: 'live', favoritesOnly: true, limit: 500 })
  const results: ChannelHealth[] = []

  log.info(`scanning ${favorites.length} favorites`)

  for (const [index, channel] of favorites.entries()) {
    if (cancelled) break
    onProgress({ done: index, total: favorites.length, current: channel.name })

    results.push(await check(channel.id, channel.name))

    if (index < favorites.length - 1) await pause(GAP_MS)
  }

  onProgress({ done: results.length, total: favorites.length, current: '' })

  // Kept, so the list can mark the dead ones tomorrow morning. A scan is one
  // connection per channel with a pause between each: throwing the answer away
  // when the panel closes means paying for it again every single time.
  recordHealth(results)

  log.info(`scan finished: ${results.filter((r) => !r.ok).length} of ${results.length} failed`)
  return results
}

async function check(channelId: number, name: string): Promise<ChannelHealth> {
  let stream: ReturnType<typeof resolveProviderStream>
  try {
    // Resolving can fail on its own — a channel whose playlist was removed, or
    // an Xtream account that no longer authenticates.
    stream = resolveProviderStream({ type: 'channel', id: channelId })
  } catch (error) {
    return { channelId, name, ok: false, reason: errorMessage(error), checkedAt: Date.now() }
  }

  try {
    // inspectStream carries its own timeout and never throws; a dead host
    // comes back as a result rather than an exception.
    // With the source's own user agent and referrer: a provider that refuses
    // an unfamiliar client would otherwise read as a dead channel.
    const check = await inspectStream(stream.url, {
      userAgent: stream.userAgent,
      referrer: stream.referrer
    })
    return {
      channelId,
      name,
      // `inspectStream` reports "no data" without calling it a failure, because
      // panels that ignore a Range header answer 200 with an empty body and
      // still play. Only a definite error is reported as dead here, for the
      // same reason: a scan that cries wolf is worse than no scan.
      ok: check.ok || !check.definitive,
      reason: check.ok ? null : (check.reason ?? null),
      checkedAt: Date.now()
    }
  } catch (error) {
    return { channelId, name, ok: false, reason: errorMessage(error), checkedAt: Date.now() }
  }
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
