import { memo, useState, type JSX } from 'react'
import type { ChannelWithState } from '@shared/types'
import { formatTime, initials, programProgress } from '@renderer/lib/format'
import { useT } from '@renderer/i18n'
import { IconEye, IconStar } from '@renderer/ui/Icon'

interface Props {
  channel: ChannelWithState
  active: boolean
  onSelect: (channel: ChannelWithState) => void
  onToggleFavorite: (channel: ChannelWithState) => void
  onToggleHidden: (channel: ChannelWithState) => void
}

export const CHANNEL_ROW_HEIGHT = 52

/**
 * Memoized because the virtual list re-renders on every scroll frame and a
 * category can hold thousands of these.
 */
export const ChannelRow = memo(function ChannelRow({
  channel,
  active,
  onSelect,
  onToggleFavorite,
  onToggleHidden
}: Props): JSX.Element {
  const t = useT()
  const [logoFailed, setLogoFailed] = useState(false)
  const showLogo = channel.logoUrl && !logoFailed

  return (
    <div
      className={`chanrow ${active ? 'chanrow--active' : ''} ${channel.hidden ? 'chanrow--hidden' : ''}`}
      style={{ height: CHANNEL_ROW_HEIGHT }}
      onClick={() => onSelect(channel)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect(channel)
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="chanrow__logo">
        {showLogo ? (
          <img src={channel.logoUrl!} alt="" loading="lazy" onError={() => setLogoFailed(true)} />
        ) : (
          <span>{initials(channel.name)}</span>
        )}
      </div>

      <div className="chanrow__text">
        <div className="chanrow__name">
          {channel.number != null && (
            <span style={{ color: 'var(--text-dim)', marginRight: 6, fontVariantNumeric: 'tabular-nums' }}>
              {channel.number}
            </span>
          )}
          {channel.name}
          {/*
            Only a failure is marked. A green tick beside every channel that
            happened to answer once would be noise on a list of thousands, and
            would read as a promise this cannot keep — a channel that answered
            an hour ago can be dead now.
          */}
          {/*
            Not decoration: more than one provider carrying this channel is
            exactly the condition under which a dead stream has somewhere to
            fall back to, so it is worth being able to see at a glance.
          */}
          {channel.sources > 1 && (
            <span className="chanrow__sources" title={t('live.sourcesTitle', { count: channel.sources })}>
              {channel.sources}
            </span>
          )}

          {channel.health?.ok === false && (
            <span
              className="chanrow__dead"
              title={channel.health.reason ?? t('health.deadTitle')}
              aria-label={t('health.dead')}
            >
              {t('health.dead')}
            </span>
          )}
        </div>

        {channel.now ? (
          <>
            <div className="chanrow__now">
              {formatTime(channel.now.startsAt)} · {channel.now.title}
            </div>
            <div className="progressbar">
              <div
                className="progressbar__fill"
                style={{ width: `${programProgress(channel.now.startsAt, channel.now.endsAt) * 100}%` }}
              />
            </div>
          </>
        ) : (
          <div className="chanrow__now">—</div>
        )}
      </div>

      <button
        className="chanrow__hide"
        onClick={(event) => {
          event.stopPropagation()
          onToggleHidden(channel)
        }}
        title={channel.hidden ? t('live.showChannel') : t('live.hideChannel')}
        aria-label={channel.hidden ? t('live.showChannel') : t('live.hideChannel')}
      >
        <IconEye size={15} off={channel.hidden} />
      </button>

      <button
        className={`chanrow__fav ${channel.favorite ? 'chanrow__fav--on' : ''}`}
        onClick={(event) => {
          event.stopPropagation()
          onToggleFavorite(channel)
        }}
        aria-label={channel.favorite ? t('live.removeFavorite') : t('live.addFavorite')}
      >
        <IconStar size={15} filled={channel.favorite} />
      </button>
    </div>
  )
})
