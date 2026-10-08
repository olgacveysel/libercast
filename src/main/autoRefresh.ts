import type { AppSettings, AutoRefreshReport, SyncProgress } from '@shared/types'
import { listPlaylists } from '@main/db/repo/playlists'
import { countChannels } from '@main/db/repo/catalog'
import { getSettings, setSettings } from '@main/db/repo/settings'
import { syncPlaylist } from '@main/sources'
import { refreshEpg } from '@main/sources/epg'
import { getMainWindow } from '@main/window'
import { createLogger, errorMessage } from '@main/util/logger'

const log = createLogger('auto-refresh')

/**
 * Checked every ten minutes rather than scheduled for an exact moment: the
 * machine sleeps, and a timer set for 04:00 does not fire on a laptop that was
 * shut overnight. Comparing elapsed time instead means a missed window is
 * picked up as soon as the app is running again.
 */
const TICK_MS = 10 * 60_000

/**
 * Refreshes sources on a schedule.
 *
 * Deliberately conservative. It never runs while something is playing, because
 * a sync opens connections to the same provider and most accounts allow very
 * few — an automatic refresh that interrupts a film is worse than no automatic
 * refresh at all.
 */
class AutoRefresh {
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false
  private isBusy: () => boolean = () => false

  /** Lets the stream server veto a refresh while a session is open. */
  setBusyCheck(check: () => boolean): void {
    this.isBusy = check
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), TICK_MS)
    // Not on startup: the app has just opened, the user is probably about to
    // watch something, and a sync would take the connection they need.
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private async tick(): Promise<void> {
    if (this.running) return

    const verdict = refreshVerdict(getSettings(), Date.now())
    if (verdict !== 'due') return

    if (this.isBusy()) {
      log.info('refresh is due but something is playing; waiting for the next check')
      return
    }

    await this.run()
  }

  /** Runs a refresh now, whatever the schedule says. Used by the manual button. */
  async run(): Promise<AutoRefreshReport> {
    this.running = true
    const started = Date.now()

    const report: AutoRefreshReport = { at: started, sources: [], programmes: null, epgError: null }

    try {
      for (const playlist of listPlaylists()) {
        // Counted before and after rather than taken from the sync result,
        // because "what changed" is what the user wants to know and the sync
        // reports what it saw, not the difference.
        const before = totalChannels(playlist.id)

        try {
          const result = await syncPlaylist(playlist.id, (progress) => broadcast(progress))
          const after = totalChannels(playlist.id)

          report.sources.push({
            playlistId: playlist.id,
            name: playlist.name,
            added: Math.max(0, after - before + result.removed),
            removed: result.removed,
            error: null
          })

          log.info(`refreshed ${playlist.name}: ${after} items, ${result.removed} removed`)
        } catch (error) {
          const message = errorMessage(error)
          report.sources.push({
            playlistId: playlist.id,
            name: playlist.name,
            added: null,
            removed: null,
            error: message
          })
          log.warn(`refresh failed for ${playlist.name}`, message)
        }
      }

      if (getSettings().autoRefreshEpg) {
        const active = listPlaylists()[0]
        if (active) {
          try {
            const epg = await refreshEpg(active.id)
            report.programmes = epg.programmes
          } catch (error) {
            report.epgError = errorMessage(error)
            log.warn('guide refresh failed', report.epgError)
          }
        }
      }
    } finally {
      this.running = false
    }

    setSettings({ lastAutoRefresh: report })
    getMainWindow()?.webContents.send('sources:refreshed', report)
    return report
  }
}

export type RefreshVerdict = 'off' | 'not-yet' | 'due'

/**
 * Whether a refresh is owed, given the settings and the clock.
 *
 * Pulled out as a pure function because the interesting cases — never run
 * before, the machine asleep through the window, the interval changed after
 * the last run — are all about arithmetic on two numbers, and testing them
 * through a timer would mean waiting hours.
 */
export function refreshVerdict(
  settings: Pick<AppSettings, 'autoRefreshHours' | 'lastAutoRefresh'>,
  now: number
): RefreshVerdict {
  if (!(settings.autoRefreshHours > 0)) return 'off'

  const last = settings.lastAutoRefresh?.at
  // Never run: due immediately, so turning the setting on does something
  // visible rather than nothing for the next day.
  if (!last) return 'due'

  // A stored timestamp in the future means the clock moved backwards. Treating
  // it as due beats waiting out the difference, which could be months.
  if (last > now) return 'due'

  return now - last >= settings.autoRefreshHours * 3600_000 ? 'due' : 'not-yet'
}

function totalChannels(playlistId: number): number {
  return (
    countChannels({ playlistId, kind: 'live', includeHidden: true }) +
    countChannels({ playlistId, kind: 'movie', includeHidden: true }) +
    countChannels({ playlistId, kind: 'series', includeHidden: true })
  )
}

function broadcast(progress: SyncProgress): void {
  getMainWindow()?.webContents.send('sync:progress', progress)
}

export const autoRefresh = new AutoRefresh()
