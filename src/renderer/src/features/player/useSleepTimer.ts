import { useEffect } from 'react'
import { useAppStore } from '@renderer/store/useAppStore'
import { hasExpired } from './sleepTimer'

/**
 * Watches the sleep deadline and stops playback when it passes.
 *
 * Mounted once, at the top of the application, rather than inside a player:
 * the timer has to keep running while you browse the guide or the catalogue,
 * and a player that unmounts would take its own timer with it.
 */
export function useSleepTimer(): void {
  const sleepAt = useAppStore((state) => state.sleepAt)
  const setSleepAt = useAppStore((state) => state.setSleepAt)
  const setActiveChannel = useAppStore((state) => state.setActiveChannel)

  useEffect(() => {
    if (sleepAt === null) return

    const tick = (): void => {
      if (!hasExpired(sleepAt, Date.now())) return
      setSleepAt(null)

      // Clearing the channel closes the live session, which is what actually
      // gives the provider connection back. Pausing alone would leave ffmpeg
      // running all night against an account that probably allows one stream.
      setActiveChannel(null)

      // Anything else still playing — a film, a multi-view tile — is paused
      // rather than closed, because those are not reached through the active
      // channel and the point is only that the sound stops.
      for (const video of document.querySelectorAll('video')) video.pause()
    }

    // A second is fine: the deadline is absolute, so a late tick stops
    // playback a moment late rather than losing the timer altogether.
    const timer = setInterval(tick, 1000)
    tick()
    return () => clearInterval(timer)
  }, [sleepAt, setSleepAt, setActiveChannel])
}
