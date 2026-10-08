import { useEffect, useRef, useState, type JSX } from 'react'
import type { VideoInfo } from '@shared/types'

interface Props {
  videoRef: React.RefObject<HTMLVideoElement>
  /** What the container declared, from the probe. */
  declared: VideoInfo | null
  pipeline: string | null
  /** Hidden in fullscreen, where the picture should be the only thing on screen. */
  visible: boolean
}

interface Measured {
  width: number
  height: number
  fps: number
  dropped: number
  total: number
}

/**
 * Live picture statistics.
 *
 * The declared frame rate comes from the container and is often wrong on live
 * streams, so the rate shown is measured from frames the compositor actually
 * presented. `requestVideoFrameCallback` fires once per presented frame, which
 * makes that measurement exact rather than an estimate from a timer.
 */
export function StreamStats({ videoRef, declared, pipeline, visible }: Props): JSX.Element | null {
  const [measured, setMeasured] = useState<Measured | null>(null)
  const frames = useRef<number[]>([])

  useEffect(() => {
    const element = videoRef.current
    if (!element || !visible) return

    let handle = 0
    let stopped = false

    const supportsFrameCallback = typeof element.requestVideoFrameCallback === 'function'

    const sample = (): void => {
      const now = performance.now()
      frames.current.push(now)

      // Keep a one-second window, so the number reacts to a stream that starts
      // dropping frames instead of averaging the problem away.
      while (frames.current.length > 0 && now - frames.current[0]! > 1000) frames.current.shift()

      const quality = element.getVideoPlaybackQuality?.()

      setMeasured({
        width: element.videoWidth,
        height: element.videoHeight,
        fps: frames.current.length,
        dropped: quality?.droppedVideoFrames ?? 0,
        total: quality?.totalVideoFrames ?? 0
      })
    }

    if (supportsFrameCallback) {
      const onFrame = (): void => {
        if (stopped) return
        sample()
        handle = element.requestVideoFrameCallback(onFrame)
      }
      handle = element.requestVideoFrameCallback(onFrame)

      return () => {
        stopped = true
        element.cancelVideoFrameCallback?.(handle)
      }
    }

    // Fallback for a runtime without the frame callback: sample the decoded
    // frame counter instead, which is coarser but still real.
    let previousTotal = element.getVideoPlaybackQuality?.().totalVideoFrames ?? 0
    const timer = setInterval(() => {
      const quality = element.getVideoPlaybackQuality?.()
      const total = quality?.totalVideoFrames ?? 0
      setMeasured({
        width: element.videoWidth,
        height: element.videoHeight,
        fps: total - previousTotal,
        dropped: quality?.droppedVideoFrames ?? 0,
        total
      })
      previousTotal = total
    }, 1000)

    return () => clearInterval(timer)
  }, [videoRef, visible])

  if (!visible) return null

  const width = measured?.width || declared?.width || 0
  const height = measured?.height || declared?.height || 0
  const dropRate = measured && measured.total > 0 ? (measured.dropped / measured.total) * 100 : 0

  return (
    <div className="stats" aria-live="off">
      <span className="stats__row">
        <span className="stats__key">Resolution</span>
        <span className="stats__value">
          {width > 0 ? `${width} × ${height}` : '—'}
          {height > 0 && <span className="stats__note">{resolutionName(height)}</span>}
        </span>
      </span>

      <span className="stats__row">
        <span className="stats__key">Frame rate</span>
        <span className="stats__value">
          {measured && measured.fps > 0 ? `${measured.fps} fps` : '—'}
          {declared?.fps ? <span className="stats__note">{declared.fps.toFixed(2)} declared</span> : null}
        </span>
      </span>

      {measured && measured.total > 0 && (
        <span className="stats__row">
          <span className="stats__key">Dropped</span>
          <span className={`stats__value ${dropRate > 1 ? 'stats__value--warn' : ''}`}>
            {measured.dropped}
            <span className="stats__note">{dropRate.toFixed(1)}%</span>
          </span>
        </span>
      )}

      <span className="stats__row">
        <span className="stats__key">Codec</span>
        <span className="stats__value">
          {declared?.codec ?? '—'}
          {declared?.bitrate ? (
            <span className="stats__note">{(declared.bitrate / 1_000_000).toFixed(1)} Mbps</span>
          ) : null}
        </span>
      </span>

      {pipeline && (
        <span className="stats__row">
          <span className="stats__key">Pipeline</span>
          <span className="stats__value">{pipeline}</span>
        </span>
      )}
    </div>
  )
}

/** The shorthand people actually recognise, from the frame height. */
function resolutionName(height: number): string {
  if (height >= 2000) return '4K'
  if (height >= 1000) return '1080p'
  if (height >= 700) return '720p'
  if (height >= 550) return '576p'
  if (height >= 460) return '480p'
  return 'SD'
}
