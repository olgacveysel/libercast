import { useEffect, useRef, useState } from 'react'

/**
 * Whether the player chrome should be on screen.
 *
 * Fullscreen puts the controls *over* the picture rather than beside it, so
 * leaving them up permanently would mean watching a film with a toolbar across
 * the bottom of it. They fade out after a moment of stillness and come back on
 * the first movement or key press — which is the behaviour every other player
 * has, and the reason people expect the mouse to be enough.
 *
 * `active` is false outside fullscreen, where the controls have their own space
 * and must never disappear.
 */
export function useIdleControls(active: boolean, delayMs = 2600): boolean {
  const [visible, setVisible] = useState(true)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!active) {
      // Leaving fullscreen must always restore the controls, whatever state
      // the timer was in.
      if (timer.current) clearTimeout(timer.current)
      setVisible(true)
      return
    }

    const wake = (): void => {
      setVisible(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setVisible(false), delayMs)
    }

    wake()

    // Pointer movement, clicks and keys all count as being present. Touch is
    // included because a Windows tablet is a plausible way to watch this.
    const events = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart']
    for (const event of events) window.addEventListener(event, wake, { passive: true })

    return () => {
      for (const event of events) window.removeEventListener(event, wake)
      if (timer.current) clearTimeout(timer.current)
    }
  }, [active, delayMs])

  return visible
}
