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
  /** When the in-flight run began, or null when nothing is running. */
  private runningSince: number | null = null
  /** Identifies the in-flight run, so a late finisher cannot clear a newer one. */
  private runId = 0
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
    if (!runIsStale(this.runningSince, Date.now())) return

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
    /*
     * One refresh at a time — but not forever.
     *
     * `tick` checked this before calling in; the manual button called straight
     * here and did not, so pressing Refresh during an automatic run started a
     * second one over the top of it — two syncs writing the same catalogue.
     *
     * The flag was then a latch. It is cleared in a `finally`, which runs when
     * the run *settles*; a run that hangs settles never, so one stalled guide
     * feed left the flag set and refused every later refresh, manual button
     * included, until the application was restarted. The guide download now
     * has a deadline of its own, which should make that unreachable — but the
     * guard is here to prevent two syncs, not to disable the feature if
     * something else ever hangs, so it expires.
     */
    const started = Date.now()
    if (!runIsStale(this.runningSince, started)) {
      throw new Error('A refresh is already running.')
    }

    if (this.runningSince !== null) {
      const minutes = Math.round((started - this.runningSince) / 60_000)
      log.warn(`the refresh started ${minutes} minutes ago never finished; starting another`)
    }

    this.runningSince = started
    const id = ++this.runId

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
        /*
         * Every source, not just the first.
         *
         * Each playlist has its own guide, so refreshing `[0]` left everyone
         * with more than one source looking at a guide that stopped updating
         * — and looking at it on whichever source they actually watch, which
         * is not reliably the first.
         *
         * One failing guide does not stop the others: they come from
         * different providers and fail independently.
         */
        let programmes = 0
        const guideErrors: string[] = []

        for (const playlist of listPlaylists()) {
          try {
            const epg = await refreshEpg(playlist.id)
            programmes += epg.programmes
          } catch (error) {
            const message = errorMessage(error)
            guideErrors.push(`${playlist.name}: ${message}`)
            log.warn(`guide refresh failed for ${playlist.name}`, message)
          }
        }

        report.programmes = programmes
        report.epgError = guideErrors.length > 0 ? guideErrors.join('; ') : null
      }
    } finally {
      // Only if this is still the current run: a hung predecessor that wakes
      // up long afterwards must not clear the flag out from under its
      // replacement.
      if (this.runId === id) this.runningSince = null
    }

    setSettings({ lastAutoRefresh: report })
    getMainWindow()?.webContents.send('sources:refreshed', report)
    return report
  }
}

/**
 * How long a run may be in flight before another is allowed to start.
 *
 * Long enough that no honest refresh reaches it — a large guide on a slow
 * provider is minutes, not half an hour — and short enough that a user who
 * presses Refresh after lunch is not still being told no.
 */
export const STALE_RUN_MS = 30 * 60_000

/**
 * Whether a new run may start, given when the current one began.
 *
 * Pulled out as a pure function so the interesting case can be tested without
 * hanging a real refresh for thirty minutes.
 */
export function runIsStale(runningSince: number | null, now: number): boolean {
  if (runningSince === null) return true
  return now - runningSince >= STALE_RUN_MS
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
