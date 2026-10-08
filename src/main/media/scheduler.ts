import type { Recording } from '@shared/types'
import * as repo from '@main/db/repo/recordings'
import { createLogger, errorMessage } from '@main/util/logger'
import { recorder } from './recorder'

const log = createLogger('scheduler')

/**
 * Wakes often enough that a recording starts within half a minute of its slot,
 * which is well inside the padding people normally set.
 */
const TICK_MS = 20_000

export type SchedulerListener = (recording: Recording) => void

class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null
  private listener: SchedulerListener | null = null

  onChange(listener: SchedulerListener): void {
    this.listener = listener
  }

  start(): void {
    if (this.timer) return

    // A scheduled recording whose whole window passed while the app was closed
    // can never run, so it is retired rather than left pending forever.
    for (const missed of repo.missedRecordings(Date.now())) {
      const updated = repo.updateRecording(missed.id, {
        status: 'failed',
        error: 'Missed — the app was not running',
        finishedAt: Date.now()
      })
      this.listener?.(updated ?? missed)
    }

    const orphaned = repo.reconcileOnStartup()
    if (orphaned > 0) log.warn(`${orphaned} recording(s) were interrupted by a previous shutdown`)

    this.timer = setInterval(() => void this.tick(), TICK_MS)
    void this.tick()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async tick(): Promise<void> {
    const now = Date.now()

    for (const recording of repo.dueRecordings(now)) {
      try {
        log.info(`starting scheduled recording ${recording.id}: ${recording.title}`)
        await recorder.begin(recording)
      } catch (error) {
        const updated = repo.updateRecording(recording.id, {
          status: 'failed',
          error: errorMessage(error),
          finishedAt: Date.now()
        })
        this.listener?.(updated ?? recording)
      }
    }

    // Anything past its end time that ffmpeg has not already wrapped up: -t
    // normally handles this, but a stalled provider can leave it running.
    for (const active of repo.activeRecordings()) {
      if (active.endsAt <= now && recorder.isRunning(active.id)) {
        log.info(`stopping recording ${active.id}, window elapsed`)
        recorder.stop(active.id)
      }
    }
  }
}

export const scheduler = new Scheduler()
