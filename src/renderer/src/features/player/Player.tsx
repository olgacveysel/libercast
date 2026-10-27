import { useEffect, useRef, useState, type JSX } from 'react'
import type { ChannelWithState, ExternalSubtitle, MediaCapabilities } from '@shared/types'
import { invoke, messageOf } from '@renderer/lib/api'
import { formatTime, programProgress } from '@renderer/lib/format'
import { useAppStore } from '@renderer/store/useAppStore'
import {
  IconAudio,
  IconFullscreen,
  IconNext,
  IconPrevious,
  IconRecord,
  IconStar,
  IconSubtitles,
  IconVolume
} from '@renderer/ui/Icon'
import { TrackMenu } from '@renderer/ui/TrackMenu'
import { useStream } from './useStream'
import { useFullscreen } from './useFullscreen'
import { useIdleControls } from './useIdleControls'
import { ChannelSchedule } from './ChannelSchedule'
import { PictureFitMenu } from './PictureFitMenu'
import { SleepMenu } from './SleepMenu'
import { nextFit, videoFitStyle } from './videoFit'
import { useT } from '@renderer/i18n'
import { StreamStats } from './StreamStats'
import { SwitchedNotice } from './SwitchedNotice'
import { useHotkeys } from './useHotkeys'
import { stepVolume } from '@renderer/features/player/volume'

interface Props {
  channel: ChannelWithState | null
  onToggleFavorite: (channel: ChannelWithState) => void
  capabilities: MediaCapabilities | null
  onOpenSettings: () => void
  onStepChannel?: (delta: number) => void
}

/** Length of an ad-hoc "record now" when the guide gives no end time. */
const DEFAULT_RECORD_MINUTES = 120

export function Player({
  channel,
  onToggleFavorite,
  capabilities,
  onOpenSettings,
  onStepChannel
}: Props): JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const t = useT()

  const [recordingId, setRecordingId] = useState<number | null>(null)
  const [recordError, setRecordError] = useState<string | null>(null)
  const [audioTrack, setAudioTrack] = useState<number | undefined>(undefined)
  const [subtitleTrack, setSubtitleTrack] = useState<number | null | undefined>(undefined)
  const [externalSubtitle, setExternalSubtitle] = useState<ExternalSubtitle | null>(null)
  const [subtitleOffset, setSubtitleOffset] = useState(0)
  const [subtitleError, setSubtitleError] = useState<string | null>(null)

  const fullscreen = useFullscreen()
  const controlsVisible = useIdleControls(fullscreen)
  const rootRef = useRef<HTMLDivElement>(null)
  const [showSchedule, setShowSchedule] = useState(false)

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

  /**
   * A finished programme being replayed from the provider's archive.
   *
   * Held here rather than inside the schedule dialog because it replaces what
   * the player is playing: the dialog is only where it was chosen.
   */
  const [replay, setReplay] = useState<{ startsAt: number; endsAt: number; title: string } | null>(null)

  // Changing channel must drop any replay with it, or the archive window of
  // the previous channel would be asked of the new one.
  useEffect(() => setReplay(null), [channel?.id])

  const { videoRef, state, reload } = useStream({
    source: channel
      ? replay
        ? { type: 'catchup', id: channel.id, startsAt: replay.startsAt, endsAt: replay.endsAt }
        : { type: 'channel', id: channel.id }
      : null,
    audioTrack,
    subtitleTrack,
    externalSubtitle,
    subtitleOffsetSecs: subtitleOffset,
    onOpened: () => {
      if (channel) void invoke('channels:markWatched', channel.id)
    }
  })

  useEffect(() => {
    setRecordingId(null)
    setRecordError(null)
    // Track choices belong to a channel, not to the player.
    setAudioTrack(undefined)
    setSubtitleTrack(undefined)
  }, [channel?.id])

  useEffect(() => {
    const element = videoRef.current
    if (!element) return
    element.volume = settings.volume
    element.muted = settings.muted
  }, [settings.volume, settings.muted, videoRef])

  /**
   * The whole player goes fullscreen, not just the picture. Fullscreening the
   * stage alone took the transport bar off screen with it, which left no way to
   * change channel, adjust volume or even see what was playing.
   */
  const toggleFullscreen = (): void => {
    const root = rootRef.current
    if (!root) return
    if (document.fullscreenElement) void document.exitFullscreen()
    else void root.requestFullscreen()
  }

  useHotkeys({
    togglePlay: () => {
      const element = videoRef.current
      if (!element) return
      if (element.paused) void element.play()
      else element.pause()
    },
    adjustVolume: (delta) =>
      void updateSettings({ volume: stepVolume(settings.volume, delta), muted: false }),
    toggleMute: () => void updateSettings({ muted: !settings.muted }),
    toggleStats: () => void updateSettings({ showStreamStats: !settings.showStreamStats }),
    toggleFullscreen,
    cycleFit: () => void updateSettings({ videoFit: nextFit(settings.videoFit) }),
    previousChannel: onStepChannel ? () => onStepChannel(-1) : undefined,
    nextChannel: onStepChannel ? () => onStepChannel(1) : undefined
  })

  const toggleRecording = async (): Promise<void> => {
    if (!channel) return
    setRecordError(null)

    try {
      if (recordingId !== null) {
        await invoke('recordings:stop', recordingId)
        setRecordingId(null)
        return
      }

      // Prefer the guide's end time so a "record now" captures exactly the
      // programme that is on, rather than an arbitrary two hours.
      const endsAt = channel.now?.endsAt ?? Date.now() + DEFAULT_RECORD_MINUTES * 60_000
      const recording = await invoke('recordings:startNow', {
        channelId: channel.id,
        title: channel.now?.title ?? channel.name,
        endsAt
      })
      setRecordingId(recording.id)
    } catch (error) {
      setRecordError(messageOf(error))
    }
  }

  const ffmpegMissing = capabilities !== null && !capabilities.ffmpeg

  return (
    <div
      ref={rootRef}
      className={`player ${fullscreen ? 'player--fs' : ''} ${
        fullscreen && !controlsVisible ? 'player--idle' : ''
      }`}
    >
      {showSchedule && channel && (
        <ChannelSchedule
          channel={channel}
          onClose={() => setShowSchedule(false)}
          canRecord={capabilities?.ffmpeg !== false}
          onReplay={(programme) => {
            setReplay({
              startsAt: programme.startsAt,
              endsAt: programme.endsAt,
              title: programme.title
            })
            setShowSchedule(false)
          }}
        />
      )}

      <div className="player__stage">
        <video
          ref={videoRef}
          className="player__video"
          style={videoFitStyle(settings.videoFit, settings.videoZoom)}
          playsInline
          autoPlay
          onDoubleClick={toggleFullscreen}
        />

        {replay && (
          <div className="replaybar">
            <span>{t('catchup.replaying', { title: replay.title })}</span>
            <button className="btn btn--ghost" onClick={() => setReplay(null)}>
              {t('catchup.backToLive')}
            </button>
          </div>
        )}

        <SwitchedNotice switched={state.switched} />

        <StreamStats
          videoRef={videoRef}
          declared={state.video}
          pipeline={state.pipeline}
          visible={settings.showStreamStats && !fullscreen && state.status === 'playing'}
        />

        {state.status !== 'playing' && (
          <div className="player__overlay">
            {ffmpegMissing ? (
              <div className="player__error" style={{ color: 'var(--text-muted)' }}>
                <p style={{ margin: '0 0 12px', lineHeight: 1.6 }}>{t('player.needsFfmpeg')}</p>
                <button className="btn btn--primary" onClick={onOpenSettings}>
                  {t('player.openSettings')}
                </button>
              </div>
            ) : state.status === 'idle' ? (
              <p style={{ margin: 0, fontSize: 14 }}>{t('player.selectChannel')}</p>
            ) : state.status === 'loading' ? (
              <div style={{ display: 'grid', gap: 10, justifyItems: 'center' }}>
                <span className="spinner" style={{ width: 22, height: 22 }} />
                <p style={{ margin: 0 }}>
                  {state.attempt > 0
                    ? t('player.reconnecting', { attempt: state.attempt })
                    : t('player.connecting')}
                </p>
              </div>
            ) : (
              <div className="player__error">
                <p style={{ margin: '0 0 12px', lineHeight: 1.55 }}>{state.error}</p>
                <button className="btn" onClick={reload}>
                  {t('common.retry')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {channel && (
        <>
          {(recordError || subtitleError || state.subtitleProblem) && (
            <div className="notice notice--error" style={{ margin: '8px 14px 0' }}>
              {recordError ?? subtitleError ?? state.subtitleProblem}
            </div>
          )}

          <div className="player__bar">
            {onStepChannel && (
              <div className="stepper">
                <button
                  className="btn btn--ghost"
                  onClick={() => onStepChannel(-1)}
                  title={`${t('player.previousChannel')} (Page Up)`}
                  aria-label={t('player.previousChannel')}
                >
                  <IconPrevious size={16} />
                </button>
                <button
                  className="btn btn--ghost"
                  onClick={() => onStepChannel(1)}
                  title={`${t('player.nextChannel')} (Page Down)`}
                  aria-label={t('player.nextChannel')}
                >
                  <IconNext size={16} />
                </button>
              </div>
            )}

            <button
              className={`chanrow__fav ${channel.favorite ? 'chanrow__fav--on' : ''}`}
              style={{ opacity: 1 }}
              onClick={() => onToggleFavorite(channel)}
              aria-label={t(channel.favorite ? 'live.removeFavorite' : 'live.addFavorite')}
            >
              <IconStar size={17} filled={channel.favorite} />
            </button>

            {/* The now-playing line is the natural place to ask "and after
                this?", so it opens the channel's own schedule. */}
            <button
              className="player__meta player__meta--button"
              onClick={() => setShowSchedule(true)}
              title={t('player.whatElseIsOn')}
            >
              <strong>{channel.name}</strong>
              {channel.now ? (
                <>
                  <span>
                    {formatTime(channel.now.startsAt)}–{formatTime(channel.now.endsAt)} · {channel.now.title}
                  </span>
                  <div className="progressbar">
                    <div
                      className="progressbar__fill"
                      style={{ width: `${programProgress(channel.now.startsAt, channel.now.endsAt) * 100}%` }}
                    />
                  </div>
                </>
              ) : (
                <span>
                  {state.pipeline
                    ? t('player.streamLine', { pipeline: state.pipeline })
                    : t('player.noGuideData')}
                </span>
              )}
            </button>

            {state.status === 'playing' && <span className="badge badge--live">{t('player.live')}</span>}

            <TrackMenu
              label={t('player.audio')}
              icon={<IconAudio size={16} />}
              tracks={state.tracks.audio}
              selected={state.audioTrack}
              onSelect={(index) => index !== null && setAudioTrack(index)}
              note={t('player.audioNote')}
            />

            <TrackMenu
              label={t('player.subtitles')}
              icon={<IconSubtitles size={16} />}
              tracks={state.tracks.subtitle}
              selected={state.subtitleTrack}
              allowNone
              onSelect={setSubtitleTrack}
              externalLabel={externalSubtitle?.label ?? null}
              onOpenFile={() => void openSubtitleFile()}
              onClearExternal={() => setExternalSubtitle(null)}
              offsetSecs={subtitleOffset}
              onOffsetChange={setSubtitleOffset}
              note={t('player.subtitlesNote')}
            />

            <SleepMenu />

            <button
              className={`btn ${recordingId !== null ? 'btn--rec' : 'btn--ghost'}`}
              onClick={() => void toggleRecording()}
              disabled={ffmpegMissing}
              title={ffmpegMissing ? t('guide.needsFfmpeg') : undefined}
            >
              <IconRecord size={15} filled={recordingId !== null} />
              {t(recordingId !== null ? 'library.stop' : 'player.record')}
            </button>

            <div className="volume">
              <button
                className="btn btn--ghost"
                style={{ padding: 4 }}
                onClick={() => void updateSettings({ muted: !settings.muted })}
                aria-label={t(settings.muted ? 'player.unmute' : 'player.mute')}
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

            <PictureFitMenu />

            <button className="btn btn--ghost" style={{ padding: 6 }} onClick={toggleFullscreen} aria-label={t('player.fullscreen')}>
              <IconFullscreen size={17} />
            </button>
          </div>
        </>
      )}
    </div>
  )
}
