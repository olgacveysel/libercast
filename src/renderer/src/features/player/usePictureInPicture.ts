import { useCallback, useEffect, useState, type RefObject } from 'react'

/**
 * The OS floating window that keeps playing over everything else.
 *
 * Three things make this worth a hook rather than a one-line click handler.
 *
 * The state is not ours to assume. A viewer can close the floating window from
 * its own controls, and the browser drops it on its own when the source
 * changes — which here happens on every channel change, every retry and every
 * failover. So the button reflects `enterpictureinpicture` and
 * `leavepictureinpicture`, never what it last asked for.
 *
 * It requires a user gesture, and refuses with `NotAllowedError` without one.
 * That is correct and nothing to work around: it only ever runs from a click.
 *
 * And it is not always there — a build without it, or a video the page has
 * marked as ineligible. A control that is present and always fails is worse
 * than one that is absent.
 */
export function usePictureInPicture(videoRef: RefObject<HTMLVideoElement>): {
  supported: boolean
  active: boolean
  toggle: () => Promise<void>
  error: string | null
} {
  const [active, setActive] = useState(false)
  const [supported, setSupported] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const element = videoRef.current
    if (!element) return

    const available =
      typeof document !== 'undefined' &&
      document.pictureInPictureEnabled === true &&
      typeof element.requestPictureInPicture === 'function' &&
      !element.disablePictureInPicture
    setSupported(available)
    if (!available) return

    const entered = (): void => {
      setActive(true)
      setError(null)
    }
    // Fires for the viewer closing the window themselves, and for the browser
    // dropping it when the stream is reopened. Both mean the same thing here.
    const left = (): void => setActive(false)

    element.addEventListener('enterpictureinpicture', entered)
    element.addEventListener('leavepictureinpicture', left)
    return () => {
      element.removeEventListener('enterpictureinpicture', entered)
      element.removeEventListener('leavepictureinpicture', left)
    }
    // `videoRef.current` is not listed: mutating a ref does not re-render, so
    // it could never trigger this effect anyway. The <video> is rendered
    // unconditionally by the player, so it exists from the first run and is
    // replaced only when the player itself remounts.
  }, [videoRef])

  const toggle = useCallback(async () => {
    const element = videoRef.current
    if (!element) return

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture()
        return
      }
      await element.requestPictureInPicture()
    } catch (problem) {
      // Reported rather than swallowed: a button that does nothing and says
      // nothing is the failure people file bugs about without being able to
      // describe. The commonest cause is asking before a frame has decoded.
      setError(problem instanceof Error ? problem.message : String(problem))
      setActive(Boolean(document.pictureInPictureElement))
    }
  }, [videoRef])

  return { supported, active, toggle, error }
}
