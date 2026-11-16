import { useState, type JSX } from 'react'
import { useT } from '@renderer/i18n'
import { LiveTv } from '@renderer/features/live/LiveTv'
import { VodBrowser } from '@renderer/features/vod/VodBrowser'

type Tab = 'live' | 'movie' | 'series'

/**
 * Everything the user has starred, not only the live channels.
 *
 * A favourite is a row in one table keyed by channel id, and films and series
 * live in the channels table alongside live TV — so starring a film has
 * always worked and has always been stored. What was missing was anywhere to
 * see it: this screen rendered the live list with the favourites filter
 * pinned on, and a starred film never appeared anywhere again.
 *
 * Tabs rather than a separate section, because Favourites is where someone
 * who starred a film goes to look for it.
 */
export function Favorites({ onAddSource }: { onAddSource: () => void }): JSX.Element {
  const [tab, setTab] = useState<Tab>('live')
  const t = useT()

  const tabs: { id: Tab; label: string }[] = [
    { id: 'live', label: t('nav.live') },
    { id: 'movie', label: t('nav.movies') },
    { id: 'series', label: t('nav.series') }
  ]

  return (
    <div className="favorites">
      <div className="favorites__tabs">
        <strong className="favorites__title">{t('nav.favorites')}</strong>
        {tabs.map((entry) => (
          <button
            key={entry.id}
            className={`btn ${tab === entry.id ? 'btn--on' : 'btn--ghost'}`}
            aria-pressed={tab === entry.id}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {/*
        Each tab is the ordinary screen for that kind of content with the
        favourites filter on, so a favourited film behaves exactly as it does
        in the Films section — same detail view, same player, same controls.
      */}
      <div className="favorites__body">
        {tab === 'live' && <LiveTv mode="favorites" onAddSource={onAddSource} />}
        {tab === 'movie' && <VodBrowser kind="movie" favoritesOnly onAddSource={onAddSource} />}
        {tab === 'series' && <VodBrowser kind="series" favoritesOnly onAddSource={onAddSource} />}
      </div>
    </div>
  )
}
