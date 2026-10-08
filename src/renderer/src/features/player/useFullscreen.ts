import { useEffect, useState } from 'react'

/**
 * Tracks fullscreen state.
 *
 * The stats overlay hides in fullscreen: that mode exists to leave nothing on
 * screen but the picture, and a permanent readout there would defeat it.
 */
export function useFullscreen(): boolean {
  const [fullscreen, setFullscreen] = useState(() => document.fullscreenElement !== null)

  useEffect(() => {
    const onChange = (): void => setFullscreen(document.fullscreenElement !== null)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  return fullscreen
}
