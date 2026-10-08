import { Notification } from 'electron'
import type { EpgReminder } from '@shared/types'
import * as repo from '@main/db/repo/reminders'
import { getMainWindow } from '@main/window'
import { createLogger } from '@main/util/logger'

const log = createLogger('reminders')

/**
 * A minute is fine: reminders are set in whole minutes, and waking more often
 * would burn a timer all day to gain nothing anyone could perceive.
 */
const TICK_MS = 30_000

/** Prunes finished reminders roughly hourly rather than on every tick. */
const PRUNE_EVERY = 120

/**
 * Windows toasts for programmes the user asked to be reminded about.
 *
 * Clicking the toast tunes to the channel, which is the whole point — a
 * notification that only says "this is starting" leaves the person to go and
 * find it themselves, by which time they have missed the opening.
 */
class ReminderScheduler {
  private timer: ReturnType<typeof setInterval> | null = null
  private ticks = 0

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.tick(), TICK_MS)
    this.tick()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private tick(): void {
    this.ticks += 1

    // Anything whose whole slot passed while the app was closed is gone; the
    // query below already excludes it, and this stops it accumulating.
    if (this.ticks % PRUNE_EVERY === 1) {
      const removed = repo.pruneReminders(Date.now() - 6 * 3600_000)
      if (removed > 0) log.debug(`pruned ${removed} finished reminder(s)`)
    }

    for (const reminder of repo.dueReminders(Date.now())) {
      this.notify(reminder)
      // Marked whether or not the toast could be shown: a notification the OS
      // refused is not worth retrying every 30 seconds for the whole programme.
      repo.markNotified(reminder.id)
    }
  }

  private notify(reminder: EpgReminder): void {
    const minutes = Math.round((reminder.startsAt - Date.now()) / 60_000)
    const when =
      minutes > 1 ? `starts in ${minutes} minutes` : minutes === 1 ? 'starts in a minute' : 'is starting now'

    log.info(`reminder: ${reminder.title} on ${reminder.channelName} ${when}`)

    if (!Notification.isSupported()) return

    const toast = new Notification({
      title: reminder.title,
      body: `${reminder.channelName} — ${when}`,
      silent: false
    })

    toast.on('click', () => {
      const window = getMainWindow()
      if (!window) return

      if (window.isMinimized()) window.restore()
      window.show()
      window.focus()
      window.webContents.send('reminders:tune', reminder)
    })

    toast.show()
  }
}

export const reminderScheduler = new ReminderScheduler()
