import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import type { ChannelWithState } from '@shared/types'
import type { DetachedParams } from '@shared/detached'
import { invoke } from '@renderer/lib/api'
import { useAppStore, applyTheme } from '@renderer/store/useAppStore'
import { useStream } from '@renderer/features/player/useStream'
import { SwitchedNotice } from '@renderer/features/player/SwitchedNotice'
import { formatVolume, stepVolume, volumeLevel, VOLUME_STEP } from '@renderer/features/player/volume'
import { useT } from '@renderer/i18n'
import { IconClose, IconFullscreen, IconGrid, IconVolume } from '@renderer/ui/Icon'

/**
 * One channel, in a window of its own, for a second monitor.
 *
 * Deliberately not the full player: this window exists to be dragged onto
 * another screen and watched, so it carries the picture, the sound and a way
 * back to the grid, and nothing that would want a sidebar or a channel list.
 *
 * It is a separate top-level entry rather than a route, because the grid must
 * not be mounted here — a second copy of the application would re-open every
 * tile and spend a provider connection on each one.
 */
export function DetachedWindow({ channelId, tile }: DetachedParams): JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const [channel, setChannel] = useState<ChannelWithState | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [barVisible, setBarVisible] = useState(true)
  const hideTimer = useRef<number | null>(null)
  const t = useT()

  // The window opens before the store has been filled, so the theme and the
  // language have to be fetched here too rather than inherited from the grid.
  useEffect(() => {
    void invoke('settings:get')
      .then((loaded) => {
        useAppStore.setState({ settings: loaded, ready: true })
        applyTheme(loaded)
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    void invoke('channels:get', channelId).then(setChannel).catch(() => setChannel(null))
  }, [channelId])

  const { videoRef, state, reload } = useStream({
    source: { type: 'channel', id: channelId },
    autoRetry: true
  })

  // Audible by default: this window exists because the user wants to watch
  // this one, and a silent window on another monitor looks broken.
  useEffect(() => {
    const element = videoRef.current
    if (!element) return
    element.muted = settings.muted
    element.volume = settings.volume
  }, [settings.muted, settings.volume, videoRef, state.status])

  useEffect(() => {
    const onChange = (): void => setFullscreen(document.fullscreenElement !== null)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void document.documentElement.requestFullscreen()
  }, [])

  /** Returns this channel to the grid by closing the window. */
  const returnToGrid = useCallback(() => void invoke('multiview:attach', tile), [tile])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const key = event.key.toLowerCase()

      if (key === 'f') {
        event.preventDefault()
        toggleFullscreen()
      } else if (key === 'm') {
        event.preventDefault()
        void updateSettings({ muted: !settings.muted })
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault()
        const delta = event.key === 'ArrowUp' ? VOLUME_STEP : -VOLUME_STEP
        void updateSettings({ volume: stepVolume(settings.volume, delta), muted: false })
      } else if (event.key === 'Escape' && !document.fullscreenElement) {
        event.preventDefault()
        returnToGrid()
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [settings.muted, settings.volume, updateSettings, toggleFullscreen, returnToGrid])

  // The bar is how the window is moved, so it cannot simply never appear — it
  // comes back on any mouse movement and fades again once the pointer settles.
  const wake = useCallback(() => {
    setBarVisible(true)
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setBarVisible(false), 2600)
  }, [])

  useEffect(() => {
    wake()
    return () => {
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current)
    }
  }, [wake])

  const level = volumeLevel(settings.volume, settings.muted)

  return (
    <div className={`detached ${barVisible || !fullscreen ? '' : 'detached--idle'}`} onMouseMove={wake}>
      <video ref={videoRef} className="detached__video" playsInline autoPlay />

      <SwitchedNotice switched={state.switched} />

      {state.status !== 'playing' && (
        <div className="detached__overlay">
          {state.status === 'error' ? (
            <>
              <p>{state.error}</p>
              <button className="btn" onClick={reload}>
                {t('common.retry')}
              </button>
            </>
          ) : (
            <span className="spinner" />
          )}
        </div>
      )}

      {/*
        The only draggable part of a frameless window. It stays on top of the
        picture rather than beside it so the window is all picture when the
        pointer is still.
      */}
      <div className={`detached__bar ${barVisible ? '' : 'detached__bar--hidden'}`}>
        <span className="detached__name">{channel?.name ?? t('common.loading')}</span>

        <div className="spacer" />

        <div className="detached__volume">
          <button
            onClick={() => void updateSettings({ muted: !settings.muted })}
            title={`${settings.muted ? t('player.unmute') : t('player.mute')} (M)`}
            aria-label={settings.muted ? t('player.unmute') : t('player.mute')}
            aria-pressed={settings.muted}
          >
            <IconVolume size={15} muted={level === 'muted'} quiet={level === 'low'} />
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={VOLUME_STEP}
            value={settings.muted ? 0 : settings.volume}
            onChange={(event) =>
              void updateSettings({ volume: stepVolume(Number(event.target.value), 0), muted: false })
            }
            title={t('player.volume')}
            aria-label={t('player.volume')}
          />
          <span>{settings.muted ? t('common.off') : formatVolume(settings.volume)}</span>
        </div>

        <button
          onClick={toggleFullscreen}
          title={`${t('player.fullscreen')} (F)`}
          aria-label={t('player.fullscreen')}
        >
          <IconFullscreen size={15} />
        </button>

        <button onClick={returnToGrid} title={t('mv.returnToGrid')} aria-label={t('mv.returnToGrid')}>
          <IconGrid size={15} />
        </button>

        <button onClick={returnToGrid} title={t('common.close')} aria-label={t('common.close')}>
          <IconClose size={14} />
        </button>
      </div>
    </div>
  )
}
