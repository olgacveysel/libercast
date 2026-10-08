import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import type { ChannelWithState } from '@shared/types'
import { invoke, messageOf } from '@renderer/lib/api'
import { initials } from '@renderer/lib/format'
import { useAppStore } from '@renderer/store/useAppStore'
import { Empty } from '@renderer/ui/Empty'
import { IconClose, IconPlus, IconSearch, IconVolume } from '@renderer/ui/Icon'
import { useStream } from '@renderer/features/player/useStream'
import { useHotkeys } from '@renderer/features/player/useHotkeys'
import { formatVolume, stepVolume, volumeLevel, VOLUME_STEP } from '@renderer/features/player/volume'
import { useT } from '@renderer/i18n'
import { clampAudioTile, tileFromKey } from './audioFocus'

interface Props {
  onAddSource: () => void
}

const LAYOUTS: { label: string; columns: number; rows: number }[] = [
  { label: '1 × 2', columns: 2, rows: 1 },
  { label: '2 × 2', columns: 2, rows: 2 },
  { label: '3 × 2', columns: 3, rows: 2 },
  { label: '3 × 3', columns: 3, rows: 3 }
]

export function MultiView({ onAddSource }: Props): JSX.Element {
  const { settings, updateSettings, activePlaylistId, playlists, setActiveChannel, setRoute } =
    useAppStore()
  const t = useT()

  const tileCount = settings.multiViewColumns * settings.multiViewRows

  // One tile carries the audio; the rest are muted. Watching four channels with
  // four soundtracks at once is unusable, so this is not optional.
  const [audioTile, setAudioTile] = useState(0)
  const [picking, setPicking] = useState<number | null>(null)

  // The level is the application's, not this screen's: the volume you set here
  // is the volume the full player opens at, which is what you would expect
  // after expanding a tile.
  const setVolume = useCallback(
    (value: number) => void updateSettings({ volume: stepVolume(value, 0), muted: false }),
    [updateSettings]
  )

  useHotkeys({
    adjustVolume: (delta) =>
      void updateSettings({ volume: stepVolume(settings.volume, delta), muted: false }),
    toggleMute: () => void updateSettings({ muted: !settings.muted })
  })

  // The number keys move the sound between tiles. Handled here rather than in
  // useHotkeys because digits mean something else in the channel lists, where
  // they type a channel number.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return
      }

      if (event.key === '0') {
        event.preventDefault()
        void updateSettings({ muted: !settings.muted })
        return
      }

      const tile = tileFromKey(event.key, tileCount)
      if (tile === null) return
      event.preventDefault()
      setAudioTile(tile)
      if (settings.muted) void updateSettings({ muted: false })
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tileCount, settings.muted, updateSettings])

  const playlist = useMemo(
    () => playlists.find((p) => p.id === activePlaylistId) ?? null,
    [playlists, activePlaylistId]
  )

  const channels = useMemo(() => {
    const stored = settings.multiViewChannels ?? []
    return Array.from({ length: tileCount }, (_, index) => stored[index] ?? null)
  }, [settings.multiViewChannels, tileCount])

  const setTile = useCallback(
    (index: number, channelId: number | null) => {
      const next = [...channels]
      next[index] = channelId
      void updateSettings({ multiViewChannels: next })
    },
    [channels, updateSettings]
  )

  const setLayout = (columns: number, rows: number): void => {
    void updateSettings({ multiViewColumns: columns, multiViewRows: rows })
    setAudioTile((current) => clampAudioTile(current, columns * rows))
  }

  if (!playlist) {
    return (
      <>
        <div className="toolbar">
          <h1 className="toolbar__title">{t('nav.multiview')}</h1>
        </div>
        <Empty
          title={t('mv.noSource')}
          description={t('mv.noSourceBody')}
          action={
            <button className="btn btn--primary" onClick={onAddSource}>
              {t('nav.addSource')}
            </button>
          }
        />
      </>
    )
  }

  const filled = channels.filter((id) => id !== null).length

  return (
    <>
      <div className="toolbar">
        <h1 className="toolbar__title">{t('nav.multiview')}</h1>

        <div className="segmented">
          {LAYOUTS.map((layout) => (
            <button
              key={layout.label}
              aria-pressed={
                settings.multiViewColumns === layout.columns && settings.multiViewRows === layout.rows
              }
              onClick={() => setLayout(layout.columns, layout.rows)}
            >
              {layout.label}
            </button>
          ))}
        </div>

        <div className="spacer" />

        {/*
          One level for the whole screen, because only one tile is ever audible.
          A slider per tile would suggest they can be mixed, which they cannot.
        */}
        <div className="mvvolume">
          <button
            className="mvvolume__mute"
            onClick={() => void updateSettings({ muted: !settings.muted })}
            title={`${settings.muted ? t('player.unmute') : t('player.mute')} (M)`}
            aria-label={settings.muted ? t('player.unmute') : t('player.mute')}
            aria-pressed={settings.muted}
          >
            <IconVolume
              size={16}
              muted={volumeLevel(settings.volume, settings.muted) === 'muted'}
              quiet={volumeLevel(settings.volume, settings.muted) === 'low'}
            />
          </button>

          <input
            className="mvvolume__slider"
            type="range"
            min={0}
            max={1}
            step={VOLUME_STEP}
            value={settings.muted ? 0 : settings.volume}
            onChange={(event) => setVolume(Number(event.target.value))}
            title={t('player.volume')}
            aria-label={t('player.volume')}
          />

          <span className="mvvolume__value">
            {settings.muted ? t('common.off') : formatVolume(settings.volume)}
          </span>
        </div>

        <button
          className="btn btn--ghost"
          onClick={() => void updateSettings({ multiViewChannels: [] })}
          disabled={filled === 0}
        >
          {t('mv.clearAll')}
        </button>
      </div>

      {filled > 1 && (
        <div className="notice" style={{ margin: '10px 14px 0', background: 'var(--bg-raised)' }}>
          {t('mv.connectionWarning')}
        </div>
      )}

      <div
        className="mvgrid"
        style={{
          gridTemplateColumns: `repeat(${settings.multiViewColumns}, 1fr)`,
          gridTemplateRows: `repeat(${settings.multiViewRows}, 1fr)`
        }}
      >
        {Array.from({ length: tileCount }, (_, index) => (
          <Tile
            key={index}
            index={index}
            channelId={channels[index] ?? null}
            hasAudio={audioTile === index}
            onFocusAudio={() => setAudioTile(index)}
            onPick={() => setPicking(index)}
            onClear={() => setTile(index, null)}
            onExpand={(channel) => {
              setActiveChannel(channel)
              setRoute('live')
            }}
          />
        ))}
      </div>

      {picking !== null && (
        <ChannelPicker
          playlistId={playlist.id}
          onClose={() => setPicking(null)}
          onPick={(channel) => {
            setTile(picking, channel.id)
            setPicking(null)
          }}
        />
      )}
    </>
  )
}

interface TileProps {
  index: number
  channelId: number | null
  hasAudio: boolean
  onFocusAudio: () => void
  onPick: () => void
  onClear: () => void
  onExpand: (channel: ChannelWithState) => void
}

function Tile({
  index,
  channelId,
  hasAudio,
  onFocusAudio,
  onPick,
  onClear,
  onExpand
}: TileProps): JSX.Element {
  const [channel, setChannel] = useState<ChannelWithState | null>(null)
  const settings = useAppStore((s) => s.settings)
  const t = useT()
  const level = volumeLevel(settings.volume, settings.muted)

  useEffect(() => {
    if (channelId === null) {
      setChannel(null)
      return
    }
    void invoke('channels:get', channelId).then(setChannel).catch(() => setChannel(null))
  }, [channelId])

  const { videoRef, state, reload } = useStream({
    source: channelId === null ? null : { type: 'channel', id: channelId },
    autoRetry: true
  })

  // Only the focused tile is audible, and its level follows the global setting.
  useEffect(() => {
    const element = videoRef.current
    if (!element) return
    element.muted = !hasAudio || settings.muted
    element.volume = settings.volume
  }, [hasAudio, settings.muted, settings.volume, videoRef, state.status])

  if (channelId === null) {
    return (
      <button className="mvtile mvtile--empty" onClick={onPick}>
        <IconPlus size={20} />
        <span>{t('mv.addChannel')}</span>
      </button>
    )
  }

  return (
    <div className={`mvtile ${hasAudio ? 'mvtile--audio' : ''}`} onClick={onFocusAudio}>
      <video ref={videoRef} className="mvtile__video" playsInline autoPlay muted />

      {state.status !== 'playing' && (
        <div className="mvtile__overlay">
          {state.status === 'error' ? (
            <>
              <p>{state.error}</p>
              <button
                className="btn"
                onClick={(event) => {
                  event.stopPropagation()
                  reload()
                }}
              >
                {t('common.retry')}
              </button>
            </>
          ) : (
            <span className="spinner" />
          )}
        </div>
      )}

      <div className="mvtile__bar">
        <span className="mvtile__num">{index + 1}</span>
        <span className="mvtile__name">{channel?.name ?? t('common.loading')}</span>

        {/*
          A button rather than the bare icon it replaced: clicking the tile has
          always moved the sound here, but nothing on screen said so, and the
          icon appearing only on the tile that already had the sound told you
          about the state you could see and not about the one you wanted.
        */}
        <button
          className={`mvtile__act ${hasAudio ? 'mvtile__act--on' : ''}`}
          onClick={(event) => {
            event.stopPropagation()
            onFocusAudio()
          }}
          title={hasAudio ? t('mv.hasAudio') : t('mv.listen', { key: index + 1 })}
          aria-label={hasAudio ? t('mv.hasAudio') : t('mv.listen', { key: index + 1 })}
          aria-pressed={hasAudio}
        >
          <IconVolume
            size={13}
            muted={hasAudio && level === 'muted'}
            quiet={!hasAudio || level === 'low'}
          />
        </button>

        <button
          className="mvtile__act"
          onClick={(event) => {
            event.stopPropagation()
            if (channel) onExpand(channel)
          }}
          title={t('mv.watchFull')}
          aria-label={t('mv.watchFull')}
        >
          ⤢
        </button>

        <button
          className="mvtile__act"
          onClick={(event) => {
            event.stopPropagation()
            onPick()
          }}
          title={t('mv.changeChannel')}
          aria-label={t('mv.changeChannel')}
        >
          ⇄
        </button>

        <button
          className="mvtile__act"
          onClick={(event) => {
            event.stopPropagation()
            onClear()
          }}
          title={t('common.remove')}
          aria-label={t('common.remove')}
        >
          <IconClose size={12} />
        </button>
      </div>
    </div>
  )
}

interface PickerProps {
  playlistId: number
  onClose: () => void
  onPick: (channel: ChannelWithState) => void
}

function ChannelPicker({ playlistId, onClose, onPick }: PickerProps): JSX.Element {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<ChannelWithState[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      void invoke('channels:query', {
        playlistId,
        kind: 'live',
        search: search || undefined,
        sort: search ? 'name' : 'recent',
        limit: 60
      })
        .then(setResults)
        .catch((e) => setError(messageOf(e)))
    }, 200)

    return () => clearTimeout(timer)
  }, [search, playlistId])

  return (
    <div className="scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Choose a channel">
        <div className="dialog__head">
          <h2>Choose a channel</h2>
          <p>Recently watched channels are listed first.</p>
        </div>

        <div className="dialog__body" style={{ gap: 10 }}>
          <div className="search" style={{ maxWidth: 'none' }}>
            <IconSearch size={15} />
            <input
              className="input"
              placeholder="Search channels…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              autoFocus
            />
          </div>

          {error && <div className="notice notice--error">{error}</div>}

          <div style={{ maxHeight: 320, overflowY: 'auto', margin: '0 -4px' }}>
            {results.map((channel) => (
              <button key={channel.id} className="mvpick" onClick={() => onPick(channel)}>
                <span className="mvpick__logo">
                  {channel.logoUrl ? (
                    <img src={channel.logoUrl} alt="" loading="lazy" />
                  ) : (
                    <span>{initials(channel.name)}</span>
                  )}
                </span>
                <span className="mvpick__name">{channel.name}</span>
              </button>
            ))}

            {results.length === 0 && (
              <p style={{ padding: 12, color: 'var(--text-dim)', fontSize: 12.5, margin: 0 }}>
                No channels match that search.
              </p>
            )}
          </div>
        </div>

        <div className="dialog__foot">
          <div className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
