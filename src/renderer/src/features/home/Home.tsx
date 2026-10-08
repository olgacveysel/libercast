import { useCallback, useEffect, useState, type JSX, type ReactNode } from 'react'
import type { ChannelWithState, ContinueWatchingItem } from '@shared/types'
import { invoke } from '@renderer/lib/api'
import { formatTime, initials, programProgress } from '@renderer/lib/format'
import { useAppStore } from '@renderer/store/useAppStore'
import { useT } from '@renderer/i18n'
import { APP_NAME } from '@shared/app'
import { Empty } from '@renderer/ui/Empty'
import { IconClose, IconPlay, IconSearch, IconStar } from '@renderer/ui/Icon'
import { VodPlayer, type VodTarget } from '@renderer/features/vod/VodPlayer'

interface Props {
  onAddSource: () => void
  onOpenSearch: () => void
}

/**
 * The landing screen.
 *
 * Its job is to get the user back to something in one click. Everything here is
 * a resumption point — what they were watching, what they marked, what is on
 * now — rather than a catalogue to browse, which is what the other screens are
 * for.
 */
export function Home({ onAddSource, onOpenSearch }: Props): JSX.Element {
  const { playlists, activePlaylistId, setRoute, setActiveChannel } = useAppStore()
  const t = useT()

  const [continuing, setContinuing] = useState<ContinueWatchingItem[]>([])
  const [recent, setRecent] = useState<ChannelWithState[]>([])
  const [favorites, setFavorites] = useState<ChannelWithState[]>([])
  const [playing, setPlaying] = useState<VodTarget | null>(null)

  const reload = useCallback(() => {
    void invoke('progress:continueWatching', { limit: 8 })
      .then(setContinuing)
      .catch(() => setContinuing([]))

    void invoke('channels:recent', { limit: 10 })
      .then(setRecent)
      .catch(() => setRecent([]))

    if (activePlaylistId !== null) {
      void invoke('channels:query', {
        playlistId: activePlaylistId,
        kind: 'live',
        favoritesOnly: true,
        limit: 12
      })
        .then(setFavorites)
        .catch(() => setFavorites([]))
    }
  }, [activePlaylistId])

  useEffect(reload, [reload, playlists, playing])

  if (playlists.length === 0) {
    return (
      <>
        <div className="toolbar">
          <h1 className="toolbar__title">{t('home.welcomeTitle', { app: APP_NAME })}</h1>
        </div>

        <div className="welcome">
          <div className="welcome__card">
            <h2>{t('home.letsGetWatching')}</h2>
            <p>
              {t('home.welcomeBody')}
            </p>

            <ol className="welcome__steps">
              <li>
                <strong>{t('home.step1')}</strong>
                <span>{t('home.step1Body')}</span>
              </li>
              <li>
                <strong>{t('home.step2')}</strong>
                <span>{t('home.step2Body')}</span>
              </li>
              <li>
                <strong>{t('home.step3')}</strong>
                <span>{t('home.step3Body')}</span>
              </li>
            </ol>

            <button className="btn btn--primary btn--big" onClick={onAddSource}>
              {t('nav.addSource')}
            </button>
          </div>
        </div>
      </>
    )
  }

  /** Drops the stored position, so the item leaves the row immediately. */
  const removeContinuing = async (item: ContinueWatchingItem): Promise<void> => {
    setContinuing((current) =>
      current.filter((row) => !(row.itemType === item.itemType && row.itemId === item.itemId))
    )
    await invoke('progress:clear', { itemType: item.itemType, itemId: item.itemId }).catch(() => reload())
  }

  const watchLive = (channel: ChannelWithState): void => {
    setActiveChannel(channel)
    setRoute('live')
  }

  const empty = continuing.length === 0 && recent.length === 0 && favorites.length === 0

  return (
    <>
      <div className="toolbar">
        <h1 className="toolbar__title">{t('home.title')}</h1>
        <div className="spacer" />
        <button className="btn" onClick={onOpenSearch}>
          <IconSearch size={15} />
          {t('nav.searchEverything')}
        </button>
      </div>

      <div className="home">
        {empty && (
          <Empty
            title={t('home.emptyTitle')}
            description={t('home.emptyBody')}
            action={
              <button className="btn btn--primary" onClick={() => setRoute('live')}>
                {t('home.browseChannels')}
              </button>
            }
          />
        )}

        {continuing.length > 0 && (
          <Section title={t('home.continueWatching')}>
            <div className="cwrow">
              {continuing.map((item) => {
                const progress = item.durationSecs > 0 ? item.positionSecs / item.durationSecs : 0
                const left = Math.max(0, Math.round((item.durationSecs - item.positionSecs) / 60))

                return (
                  <div className="cwcard__wrap" key={`${item.itemType}:${item.itemId}`}>
                    <button
                      className="cwcard"
                      onClick={() =>
                        setPlaying({
                          itemType: item.itemType,
                          itemId: item.itemId,
                          channelId: item.channelId,
                          title: item.title
                        })
                      }
                    >
                      {item.posterUrl ? (
                        <img className="cwcard__art" src={item.posterUrl} alt="" loading="lazy" />
                      ) : (
                        <span className="cwcard__art" />
                      )}
                      <span className="cwcard__text">
                        <strong>{item.title}</strong>
                        <span className="progressbar">
                          <span className="progressbar__fill" style={{ width: `${progress * 100}%` }} />
                        </span>
                        <span>{t('home.minutesLeft', { minutes: left })}</span>
                      </span>
                    </button>

                    {/* Continue watching fills up with things half-started by
                        accident, and without this the only way to clear one is
                        to watch it to the end. */}
                    <button
                      className="cwcard__remove"
                      title={t('home.removeFromContinue')}
                      aria-label={`Remove ${item.title} from Continue watching`}
                      onClick={() => void removeContinuing(item)}
                    >
                      <IconClose size={12} />
                    </button>
                  </div>
                )
              })}
            </div>
          </Section>
        )}

        {favorites.length > 0 && (
          <Section
            title={t('home.favorites')}
            action={
              <button className="btn btn--ghost" onClick={() => setRoute('favorites')}>
                {t('home.seeAll')}
              </button>
            }
          >
            <div className="tilerow">
              {favorites.map((channel) => (
                <ChannelTile key={channel.id} channel={channel} onSelect={watchLive} showStar />
              ))}
            </div>
          </Section>
        )}

        {recent.length > 0 && (
          <Section title={t('home.jumpBackIn')}>
            <div className="tilerow">
              {recent.map((channel) => (
                <ChannelTile key={channel.id} channel={channel} onSelect={watchLive} />
              ))}
            </div>
          </Section>
        )}

        {playing && <VodPlayer target={playing} onClose={() => setPlaying(null)} />}
      </div>
    </>
  )
}

function Section({
  title,
  action,
  children
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}): JSX.Element {
  return (
    <section className="home__section">
      <div className="home__head">
        <h2 className="sectionhead">{title}</h2>
        <div className="spacer" />
        {action}
      </div>
      {children}
    </section>
  )
}

function ChannelTile({
  channel,
  onSelect,
  showStar
}: {
  channel: ChannelWithState
  onSelect: (channel: ChannelWithState) => void
  showStar?: boolean
}): JSX.Element {
  const [failed, setFailed] = useState(false)

  return (
    <button className="tile" onClick={() => onSelect(channel)} title={channel.name}>
      <span className="tile__art">
        {channel.logoUrl && !failed ? (
          <img src={channel.logoUrl} alt="" loading="lazy" onError={() => setFailed(true)} />
        ) : (
          <span className="tile__initials">{initials(channel.name)}</span>
        )}

        <span className="tile__play">
          <IconPlay size={16} />
        </span>

        {showStar && (
          <span className="tile__star">
            <IconStar size={11} filled />
          </span>
        )}
      </span>

      <span className="tile__name">{channel.name}</span>

      {channel.now ? (
        <>
          <span className="tile__now">
            {formatTime(channel.now.startsAt)} · {channel.now.title}
          </span>
          <span className="progressbar">
            <span
              className="progressbar__fill"
              style={{ width: `${programProgress(channel.now.startsAt, channel.now.endsAt) * 100}%` }}
            />
          </span>
        </>
      ) : (
        <span className="tile__now">&nbsp;</span>
      )}
    </button>
  )
}
