import type { CSSProperties } from 'react'
import type { VideoFit } from '@shared/types'

/**
 * Turns a fit mode and zoom level into the style the `<video>` needs.
 *
 * Kept as a pure function rather than a pile of CSS classes because the two
 * settings interact: forcing a display aspect means the element must be sized
 * by that ratio *and* have its content stretched into it, and the zoom is a
 * transform on top of whatever the mode already decided.
 */
export function videoFitStyle(fit: VideoFit, zoom: number): CSSProperties {
  const scale = clampZoom(zoom)
  const base: CSSProperties = scale === 1 ? {} : { transform: `scale(${scale})` }

  switch (fit) {
    case 'fill':
      // `cover` crops the overflow, which is the point: it is how a stream
      // delivered with black bars baked into the picture gets rid of them.
      return { ...base, objectFit: 'cover', width: '100%', height: '100%' }

    case 'stretch':
      return { ...base, objectFit: 'fill', width: '100%', height: '100%' }

    case '16:9':
    case '4:3':
      // The element is given the ratio and the picture is stretched into it,
      // which is what "force this aspect" has to mean — the source's own shape
      // is exactly what is being overridden.
      return {
        ...base,
        objectFit: 'fill',
        aspectRatio: fit === '16:9' ? '16 / 9' : '4 / 3',
        width: 'auto',
        height: 'auto',
        maxWidth: '100%',
        maxHeight: '100%',
        margin: 'auto'
      }

    case 'fit':
    default:
      return { ...base, objectFit: 'contain', width: '100%', height: '100%' }
  }
}

/** Zoom below 1 would letterbox inside the letterbox; above 1.6 is unusable. */
export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1
  return Math.min(1.6, Math.max(1, Math.round(zoom * 100) / 100))
}

const ORDER: VideoFit[] = ['fit', 'fill', 'stretch', '16:9', '4:3']

/** Next mode in the cycle, for the keyboard shortcut. */
export function nextFit(current: VideoFit): VideoFit {
  const index = ORDER.indexOf(current)
  return ORDER[(index + 1) % ORDER.length]!
}

/** Playback rates offered. 1 is always present and is what Reset returns to. */
export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const

/**
 * Steps to the next or previous rate in the list rather than adding a fixed
 * amount, so the increments stay sensible at both ends.
 */
export function stepSpeed(current: number, direction: 1 | -1): number {
  const index = SPEEDS.findIndex((rate) => Math.abs(rate - current) < 0.01)
  const from = index === -1 ? SPEEDS.indexOf(1) : index
  const next = Math.min(SPEEDS.length - 1, Math.max(0, from + direction))
  return SPEEDS[next]!
}

/** "1×", "1.25×" — trailing zeroes dropped so the button stays narrow. */
export function formatSpeed(rate: number): string {
  return `${Number(rate.toFixed(2))}×`
}
