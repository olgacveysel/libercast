import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import type { ExternalSubtitle, ProgressItemType, SeriesEpisode, StreamSource } from '@shared/types'
import { invoke, messageOf } from '@renderer/lib/api'
import { useAppStore } from '@renderer/store/useAppStore'
import {
  IconAudio,
  IconClose,
  IconFullscreen,
  IconNext,
  IconPause,
  IconPlay,
  IconPrevious,
  IconSpeed,
  IconSubtitles,
  IconVolume
} from '@renderer/ui/Icon'
import { PickerMenu } from '@renderer/ui/PickerMenu'
import { TrackMenu } from '@renderer/ui/TrackMenu'
import { useStream } from '@renderer/features/player/useStream'
import { useFullscreen } from '@renderer/features/player/useFullscreen'
import { useIdleControls } from '@renderer/features/player/useIdleControls'
import { StreamStats } from '@renderer/features/player/StreamStats'
import { useHotkeys } from '@renderer/features/player/useHotkeys'
import { PictureFitMenu } from '@renderer/features/player/PictureFitMenu'
import { formatSpeed, nextFit, SPEEDS, stepSpeed, videoFitStyle } from '@renderer/features/player/videoFit'
import { useT } from '@renderer/i18n'
import { stepVolume } from '@renderer/features/player/volume'

export interface VodTarget {
  itemType: ProgressItemType
  /** Movie: the channel id. Episode: the series_episodes row id. */
  itemId: number
  /** Always the channel row — a movie, or the series an episode belongs to. */
  channelId: number
  title: string
  /** Overrides the derived source. Used for local recordings. */
  source?: StreamSource
  /**
   * Recordings share the progress table's id space with movies, so they opt out
   * rather than corrupting a film's resume position.
   */
  trackProgress?: boolean
}

interface Props {
  target: VodTarget
  onClose: () => void
  onPlayEpisode?: (episode: SeriesEpisode) => void
}

/** Position is written at most this often, keeping SQLite writes off the hot path. */
const SAVE_INTERVAL_MS = 5000

/** The next-up card appears this many seconds before the end. */
const NEXT_UP_LEAD_SECS = 40

export function VodPlayer({ target, onClose, onPlayEpisode }: Props): JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const t = useT()

  // ffmpeg writes fragmented MP4 to a pipe, which has no index, so the element
  // cannot seek within it. Seeking therefore means reopening the stream at an
  // offset and treating that offset as the origin of the element's timeline.
  const [offsetSecs, setOffsetSecs] = useState(0)
  const [elapsedSecs, setElapsedSecs] = useState(0)
  const [durationSecs, setDurationSecs] = useState<number | null>(null)
  const [nextUp, setNextUp] = useState<SeriesEpisode | null>(null)
  const [previous, setPrevious] = useState<SeriesEpisode | null>(null)
  const [nextUpVisible, setNextUpVisible] = useState(false)
  const [scrubbing, setScrubbing] = useState<number | null>(null)
  /**
   * Speed is per-viewing rather than a stored setting: coming back to a film
   * tomorrow and finding it still at 1.75× would be a bug, not a convenience.
   */
  const [speed, setSpeed] = useState(1)
  /**
   * Whether the element is paused, tracked from its own events rather than read
   * during render.
   *
   * The button showed a play triangle at all times, so while a film was playing
   * the control offered to do the thing it was already doing. A transport
   * button has to say what pressing it will do.
   */
  const [paused, setPaused] = useState(false)

  // Undefined means "let the main process pick by preferred language"; a number
  // is an explicit choice that survives the reopen a track change requires.
  const [audioTrack, setAudioTrack] = useState<number | undefined>(undefined)
  const [subtitleTrack, setSubtitleTrack] = useState<number | null | undefined>(undefined)
  const [externalSubtitle, setExternalSubtitle] = useState<ExternalSubtitle | null>(null)
  const [subtitleOffset, setSubtitleOffset] = useState(0)
  const [subtitleError, setSubtitleError] = useState<string | null>(null)

  const fullscreen = useFullscreen()
  const controlsVisible = useIdleControls(fullscreen)
  const rootRef = useRef<HTMLDivElement>(null)

  /** Cancels the click-to-pause when the click turns out to be a double-click. */
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /**
   * Loads a subtitle file by path — the same main-process path the file picker
   * uses, so encoding detection and SRT conversion are identical. Dropping a
   * file on the video is how people who keep subtitles next to their films
   * expect this to work.
   */
  const loadSubtitlePath = async (filePath: string): Promise<void> => {
    setSubtitleError(null)
    try {
      setExternalSubtitle(await invoke('subtitles:loadFile', filePath))
      setSubtitleOffset(0)
    } catch (error) {
      setSubtitleError(messageOf(error))
    }
  }

  const onDropSubtitle = (event: React.DragEvent): void => {
    event.preventDefault()
    const file = event.dataTransfer.files[0]
    if (!file) return

    // Electron exposes the real path on a dropped File; without it the main
    // process has nothing to open.
    const path = (file as File & { path?: string }).path
    if (!path) {
      setSubtitleError('That file could not be read. Use the subtitles menu to open it instead.')
      return
    }

    if (!/\.(srt|vtt|ass|ssa|sub)$/i.test(path)) {
      setSubtitleError('That is not a subtitle file. Drop an .srt, .vtt or .ass file.')
      return
    }

    void loadSubtitlePath(path)
  }

  /**
   * External files are read and converted in the main process, so the renderer
   * receives WebVTT it can attach without touching the stream.
   */
  const openSubtitleFile = async (): Promise<void> => {
    setSubtitleError(null)
    try {
      const loaded = await invoke('subtitles:pickFile')
      if (loaded) {
        setExternalSubtitle(loaded)
        setSubtitleOffset(0)
      }
    } catch (error) {
      setSubtitleError(messageOf(error))
    }
  }

  const lastSave = useRef(0)
  const resumeApplied = useRef(false)

  /**
   * The stream is not opened until the stored resume position is known.
   *
   * Opening first and then re-opening at the offset meant two ffmpeg processes
   * and two provider connections a fraction of a second apart, and on an
   * account limited to one connection the second request is the one that gets
   * refused — so the fix for "it only plays sometimes" is to ask once.
   */
  const [resumeReady, setResumeReady] = useState(false)

  const trackProgress = target.trackProgress !== false
  const source: StreamSource =
    target.source ??
    (target.itemType === 'episode'
      ? { type: 'episode', id: target.itemId }
      : { type: 'channel', id: target.channelId })

  const { videoRef, state, reload } = useStream({
    source: resumeReady ? source : null,
    seekSecs: offsetSecs,
    audioTrack,
    subtitleTrack,
    externalSubtitle,
    subtitleOffsetSecs: subtitleOffset,
    autoRetry: false
  })

  /**
   * Where playback actually is, in the film.
   *
   * On an absolute timeline the element's own clock already says so, keyframe
   * rounding included — a stream opened at 30:00 may really start at 29:58, and
   * this reports 29:58 rather than the 30:00 that was asked for. Only a live
   * stream, whose clock restarts at zero, needs the offset added back.
   */
  const position = state.absoluteTimeline ? elapsedSecs : offsetSecs + elapsedSecs
  const total = durationSecs ?? 0

  const save = useCallback(
    (positionSecs: number, length: number) => {
      if (!trackProgress || !Number.isFinite(length) || length <= 0) return
      void invoke('progress:save', {
        itemType: target.itemType,
        itemId: target.itemId,
        channelId: target.channelId,
        positionSecs,
        durationSecs: length
      })
    },
    [target, trackProgress]
  )

  // Reset everything when the target changes (auto-next moves to a new episode).
  useEffect(() => {
    resumeApplied.current = false
    setResumeReady(false)
    setOffsetSecs(0)
    setElapsedSecs(0)
    setDurationSecs(null)
    setNextUp(null)
    setPrevious(null)
    setNextUpVisible(false)
    setAudioTrack(undefined)
    setSubtitleTrack(undefined)
  }, [target.itemType, target.itemId])

  useEffect(() => {
    if (state.durationSecs != null) setDurationSecs((current) => current ?? state.durationSecs)
  }, [state.durationSecs])

  // Resume once per item, by opening at the stored offset rather than seeking.
  useEffect(() => {
    if (resumeApplied.current) return
    resumeApplied.current = true

    if (!trackProgress) {
      setResumeReady(true)
      return
    }

    void invoke('progress:resume', { itemType: target.itemType, itemId: target.itemId })
      .then((resumeAt) => {
        if (resumeAt > 0) setOffsetSecs(resumeAt)
      })
      .catch(() => undefined)
      .finally(() => setResumeReady(true))
  }, [target.itemType, target.itemId, trackProgress])

  useEffect(() => {
    if (target.itemType !== 'episode' || !onPlayEpisode) return
    void invoke('vod:nextEpisode', target.itemId).then(setNextUp)
    void invoke('vod:previousEpisode', target.itemId).then(setPrevious)
  }, [target.itemType, target.itemId, onPlayEpisode])

  useEffect(() => {
    const element = videoRef.current
    if (!element) return
    element.volume = settings.volume
    element.muted = settings.muted
  }, [settings.volume, settings.muted, videoRef])

  useEffect(() => {
    const element = videoRef.current
    if (!element) return

    const sync = (): void => setPaused(element.paused)
    sync()

    element.addEventListener('play', sync)
    element.addEventListener('pause', sync)
    // A reopen replaces the source and momentarily pauses; without this the
    // icon would stick at whatever it was before the change.
    element.addEventListener('loadstart', sync)
    element.addEventListener('playing', sync)

    return () => {
      element.removeEventListener('play', sync)
      element.removeEventListener('pause', sync)
      element.removeEventListener('loadstart', sync)
      element.removeEventListener('playing', sync)
    }
  }, [videoRef, state.status])

  // Re-applied on every reopen: a new src resets the element to 1×, and a seek
  // or a track change is a reopen.
  useEffect(() => {
    const element = videoRef.current
    if (element) element.playbackRate = speed
  }, [speed, state.status, videoRef])

  // A new item starts at normal speed.
  useEffect(() => setSpeed(1), [target.itemType, target.itemId])

  // Capture the final position when the player closes or the item changes.
  useEffect(() => {
    return () => {
      if (total > 0) save(position, total)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.itemType, target.itemId])

  const onTimeUpdate = (): void => {
    const element = videoRef.current
    if (!element) return

    setElapsedSecs(element.currentTime)

    // For a movie the provider may not have told us the length; the remuxed
    // stream reports its own once enough of it has arrived.
    if (durationSecs === null && Number.isFinite(element.duration) && element.duration > 0) {
      setDurationSecs(state.absoluteTimeline ? element.duration : offsetSecs + element.duration)
    }

    const now = Date.now()
    const current = state.absoluteTimeline ? element.currentTime : offsetSecs + element.currentTime
    if (total > 0 && now - lastSave.current > SAVE_INTERVAL_MS) {
      lastSave.current = now
      save(current, total)
    }

    if (nextUp && total > 0 && total - current <= NEXT_UP_LEAD_SECS) setNextUpVisible(true)
  }

  /**
   * ffmpeg is mapping one audio stream and one subtitle stream, so changing
   * either means a new ffmpeg — reopened at the current position so playback
   * carries on from where it was.
   */
  const changeTrack = (patch: { audio?: number; subtitle?: number | null }): void => {
    setOffsetSecs(position)
    setElapsedSecs(0)
    if (patch.audio !== undefined) setAudioTrack(patch.audio)
    if (patch.subtitle !== undefined) setSubtitleTrack(patch.subtitle)
  }

  const seekTo = (seconds: number): void => {
    const clamped = Math.max(0, Math.min(total > 0 ? total - 2 : seconds, seconds))
    setElapsedSecs(0)
    setOffsetSecs(clamped)
  }

  const skip = (delta: number): void => seekTo(position + delta)

  const playNext = (): void => {
    if (nextUp && onPlayEpisode) onPlayEpisode(nextUp)
  }

  const playPrevious = (): void => {
    if (previous && onPlayEpisode) onPlayEpisode(previous)
  }

  const isEpisode = target.itemType === 'episode' && onPlayEpisode !== undefined

  /**
   * The stage is the video's parent, not the video itself: fullscreening the
   * element alone hands the browser's own controls back and loses the transport
   * bar, the next-up card and the stats overlay.
   */
  const toggleFullscreen = (): void => {
    if (clickTimer.current) clearTimeout(clickTimer.current)
    const root = rootRef.current
    if (!root) return
    if (document.fullscreenElement) void document.exitFullscreen()
    else void root.requestFullscreen()
  }

  /**
   * Click pauses, double-click goes fullscreen. A double-click also delivers
   * two ordinary clicks, so the pause is held back briefly and cancelled if the
   * second click arrives — otherwise going fullscreen visibly stutters the
   * picture on the way.
   */
  const onVideoClick = (): void => {
    if (clickTimer.current) clearTimeout(clickTimer.current)
    clickTimer.current = setTimeout(() => {
      const element = videoRef.current
      if (element) void (element.paused ? element.play() : element.pause())
    }, 220)
  }

  useEffect(() => () => {
    if (clickTimer.current) clearTimeout(clickTimer.current)
  }, [])

  useHotkeys({
    togglePlay: () => {
      const element = videoRef.current
      if (!element) return
      if (element.paused) void element.play()
      else element.pause()
    },
    seek: (delta) => seekTo(position + delta),
    adjustVolume: (delta) =>
      void updateSettings({ volume: stepVolume(settings.volume, delta), muted: false }),
    toggleMute: () => void updateSettings({ muted: !settings.muted }),
    toggleStats: () => void updateSettings({ showStreamStats: !settings.showStreamStats }),
    previousChannel: isEpisode && previous ? playPrevious : undefined,
    nextChannel: isEpisode && nextUp ? playNext : undefined,
    stepSpeed: (direction) => setSpeed((rate) => stepSpeed(rate, direction)),
    cycleFit: () => void updateSettings({ videoFit: nextFit(settings.videoFit) }),
    toggleFullscreen,
    close: onClose
  })

  const shown = scrubbing ?? position

  /**
   * Rendered into the main content area rather than wherever it was opened
   * from.
   *
   * Home and Library are scrolling containers, and an absolutely positioned
   * child of one is placed against the top of its *content*, not the visible
   * area — so opening a film after scrolling down put the player somewhere off
   * screen. Portalling it into the content region pins it to the region the
   * viewer can actually see, and leaves the sidebar reachable, so switching to
   * another section does not first require closing the film.
   */
  const overlay = (
    <div
      ref={rootRef}
      className={`vodplayer ${fullscreen ? 'vodplayer--fs' : ''} ${
        fullscreen && !controlsVisible ? 'vodplayer--idle' : ''
      }`}
    >
      <div className="vodplayer__top">
        <strong>{target.title}</strong>
        {state.pipeline && state.pipeline !== 'direct copy' && (
          <span className="badge" title="ffmpeg is converting this stream">
            {state.pipeline}
          </span>
        )}
        <button className="btn btn--ghost" onClick={onClose} aria-label={t('common.close')}>
          <IconClose size={16} />
        </button>
      </div>

      <div
        className="vodplayer__stage"
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDropSubtitle}
      >
        <video
          ref={videoRef}
          className="player__video"
          style={videoFitStyle(settings.videoFit, settings.videoZoom)}
          autoPlay
          playsInline
          onTimeUpdate={onTimeUpdate}
          onEnded={playNext}
          onDoubleClick={toggleFullscreen}
          onClick={onVideoClick}
        />

        {state.status !== 'playing' && (
          <div className="player__overlay">
            {state.status === 'error' ? (
              <div className="player__error">
                <p style={{ margin: '0 0 12px', lineHeight: 1.55 }}>{state.error}</p>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                  {/* Most of these failures are the provider's connection limit,
                      which clears on its own within seconds. */}
                  <button className="btn btn--primary" onClick={reload}>
                    Try again
                  </button>
                  <button className="btn" onClick={onClose}>
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <span className="spinner" style={{ width: 22, height: 22 }} />
            )}
          </div>
        )}

        <StreamStats
          videoRef={videoRef}
          declared={state.video}
          pipeline={state.pipeline}
          visible={settings.showStreamStats && !fullscreen && state.status === 'playing'}
        />

        {(subtitleError || state.subtitleProblem) && (
          <div className="notice notice--error" style={{ position: 'absolute', left: 12, bottom: 12, maxWidth: 380 }}>
            {subtitleError ?? state.subtitleProblem}
          </div>
        )}

        {nextUpVisible && nextUp && (
          <div className="nextup">
            <p>{t('player.nextUp')}</p>
            <strong>
              S{String(nextUp.season).padStart(2, '0')}E{String(nextUp.episode).padStart(2, '0')} · {nextUp.title}
            </strong>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn--primary" onClick={playNext}>
                {t('player.playNow')}
              </button>
              <button className="btn btn--ghost" onClick={() => setNextUpVisible(false)}>
                {t('player.dismiss')}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="transport">
        {isEpisode && (
          <button
            className="btn btn--ghost"
            onClick={playPrevious}
            disabled={!previous}
            title={
              previous
                ? `Previous: S${String(previous.season).padStart(2, '0')}E${String(previous.episode).padStart(2, '0')} ${previous.title}`
                : 'This is the first episode'
            }
            aria-label={t('player.previousEpisode')}
          >
            <IconPrevious size={16} />
          </button>
        )}

        <button
          className="btn btn--ghost"
          onClick={() => videoRef.current?.[videoRef.current.paused ? 'play' : 'pause']()}
          aria-label={paused ? t('common.play') : t('common.pause')}
          title={paused ? 'Play (Space)' : 'Pause (Space)'}
        >
          {paused ? <IconPlay size={16} /> : <IconPause size={16} />}
        </button>

        {isEpisode && (
          <button
            className="btn btn--ghost"
            onClick={playNext}
            disabled={!nextUp}
            title={
              nextUp
                ? `Next: S${String(nextUp.season).padStart(2, '0')}E${String(nextUp.episode).padStart(2, '0')} ${nextUp.title}`
                : 'This is the last episode'
            }
            aria-label={t('player.nextEpisode')}
          >
            <IconNext size={16} />
          </button>
        )}

        <button className="btn btn--ghost" onClick={() => skip(-30)} aria-label={t('player.back30')}>
          −30s
        </button>
        <button className="btn btn--ghost" onClick={() => skip(30)} aria-label={t('player.forward30')}>
          +30s
        </button>

        <span className="transport__time">{formatClock(shown)}</span>

        <input
          className="transport__scrub"
          type="range"
          min={0}
          max={total > 0 ? total : 1}
          step={1}
          value={Math.min(shown, total > 0 ? total : 1)}
          disabled={total <= 0}
          onChange={(event) => setScrubbing(Number(event.target.value))}
          onMouseUp={() => {
            if (scrubbing !== null) seekTo(scrubbing)
            setScrubbing(null)
          }}
          onKeyUp={() => {
            if (scrubbing !== null) seekTo(scrubbing)
            setScrubbing(null)
          }}
          aria-label={t('player.seek')}
        />

        <span className="transport__time">{total > 0 ? formatClock(total) : '--:--'}</span>

        <TrackMenu
          label={t('player.audio')}
          icon={<IconAudio size={16} />}
          tracks={state.tracks.audio}
          selected={state.audioTrack}
          onSelect={(index) => index !== null && changeTrack({ audio: index })}
          note="Switching audio restarts the stream from this point."
        />

        <TrackMenu
          label={t('player.subtitles')}
          icon={<IconSubtitles size={16} />}
          tracks={state.tracks.subtitle}
          selected={state.subtitleTrack}
          allowNone
          onSelect={(index) => changeTrack({ subtitle: index })}
          externalLabel={externalSubtitle?.label ?? null}
          onOpenFile={() => void openSubtitleFile()}
          onClearExternal={() => setExternalSubtitle(null)}
          offsetSecs={subtitleOffset}
          onOffsetChange={setSubtitleOffset}
          note={
            state.subtitlesBurnedIn
              ? 'This subtitle is an image, so it is drawn into the picture and the video is re-encoded.'
              : 'Switching subtitles restarts the stream from this point.'
          }
        />

        <PickerMenu<number>
          label={t('player.speed')}
          icon={<IconSpeed size={16} />}
          current={formatSpeed(speed)}
          options={SPEEDS.map((rate) => ({
            value: rate,
            label: formatSpeed(rate)
          }))}
          selected={speed}
          onSelect={setSpeed}
          title={`Playback speed: ${formatSpeed(speed)} ([ and ])`}
        />

        <PictureFitMenu />

        <button
          className="btn btn--ghost"
          style={{ padding: 6 }}
          onClick={toggleFullscreen}
          title={fullscreen ? 'Leave fullscreen (F or Esc)' : 'Fullscreen (F, or double-click the video)'}
          aria-label={t('player.fullscreen')}
        >
          <IconFullscreen size={17} />
        </button>

        <div className="volume">
          <button
            className="btn btn--ghost"
            style={{ padding: 4 }}
            onClick={() => void updateSettings({ muted: !settings.muted })}
            aria-label={settings.muted ? t('player.unmute') : t('player.mute')}
          >
            <IconVolume size={17} muted={settings.muted} />
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={settings.muted ? 0 : settings.volume}
            onChange={(event) => void updateSettings({ volume: Number(event.target.value), muted: false })}
            aria-label={t('player.volume')}
          />
        </div>
      </div>
    </div>
  )

  return createPortal(overlay, playerHost())
}

/**
 * Where the player is mounted. The main content region when it exists, and the
 * document otherwise — a player that fails to appear would be worse than one
 * that covers a little more than intended.
 */
function playerHost(): HTMLElement {
  return document.querySelector<HTMLElement>('.main') ?? document.body
}

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--'
  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const pad = (value: number): string => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`
}
