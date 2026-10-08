import type { JSX, ReactNode } from 'react'
import { useAppStore, type Route } from '@renderer/store/useAppStore'
import { formatRelative, initials } from '@renderer/lib/format'
import { useT, type TranslationKey } from '@renderer/i18n'
import {
  IconFilm,
  IconGrid,
  IconGuide,
  IconHome,
  IconLibrary,
  IconPlus,
  IconSettings,
  IconStack,
  IconStar,
  IconTv
} from './Icon'

interface Props {
  onAddSource: () => void
  /** Rail mode: icons only, labels hidden, names moved into tooltips. */
  collapsed: boolean
}

// The label is a key rather than a string: the navigation is built once at
// module scope, so it cannot hold text that has to change with the language.
const NAV: { route: Route; label: TranslationKey; icon: ReactNode }[] = [
  { route: 'home', label: 'nav.home', icon: <IconHome size={18} /> },
  { route: 'live', label: 'nav.live', icon: <IconTv size={18} /> },
  { route: 'guide', label: 'nav.guide', icon: <IconGuide size={18} /> },
  { route: 'multiview', label: 'nav.multiview', icon: <IconGrid size={18} /> },
  { route: 'movies', label: 'nav.movies', icon: <IconFilm size={18} /> },
  { route: 'series', label: 'nav.series', icon: <IconStack size={18} /> },
  { route: 'favorites', label: 'nav.favorites', icon: <IconStar size={18} /> },
  { route: 'library', label: 'nav.library', icon: <IconLibrary size={18} /> }
]

export function Sidebar({ onAddSource, collapsed }: Props): JSX.Element {
  const { route, setRoute, playlists, activePlaylistId, setActivePlaylist } = useAppStore()
  const t = useT()

  // A tooltip is only added in rail mode. On a labelled button it is noise: the
  // same words appear twice, one of them after a delay.
  const tip = (text: string): { title?: string } => (collapsed ? { title: text } : {})

  return (
    <nav className="sidebar">
      <div className="sidebar__nav">
        {NAV.map((item) => (
          <button
            key={item.route}
            className={`navitem ${route === item.route ? 'navitem--active' : ''}`}
            onClick={() => setRoute(item.route)}
            {...tip(t(item.label))}
          >
            {item.icon}
            <span className="navitem__label">{t(item.label)}</span>
          </button>
        ))}
      </div>

      <div className="sidebar__section">{t('nav.sources')}</div>

      <div className="sidebar__playlists">
        {playlists.length === 0 && !collapsed && (
          <p className="sidebar__hint">{t('nav.noSources')}</p>
        )}

        {playlists.map((playlist) => (
          <button
            key={playlist.id}
            className={`navitem ${activePlaylistId === playlist.id ? 'navitem--active' : ''}`}
            onClick={() => {
              setActivePlaylist(playlist.id)
              if (route === 'home' || route === 'settings') setRoute('live')
            }}
            title={
              collapsed
                ? playlist.name
                : `${t('nav.lastSynced', { when: formatRelative(playlist.lastSyncedAt) })}`
            }
          >
            {/*
              In rail mode the initials stand in for the name: two letters say
              which source is active, where a bare status dot does not.
            */}
            <span
              className={`navitem__dot ${playlist.lastSyncedAt ? 'navitem__dot--ok' : ''}`}
              aria-hidden="true"
            >
              {initials(playlist.name)}
            </span>
            <span className="navitem__label navitem__label--grow">{playlist.name}</span>
            <span className="navitem__badge">{playlist.kind === 'xtream' ? 'XC' : 'M3U'}</span>
          </button>
        ))}

        <button className="navitem" onClick={onAddSource} {...tip(t('nav.addSource'))}>
          <IconPlus size={18} />
          <span className="navitem__label">{t('nav.addSource')}</span>
        </button>
      </div>

      <div className="sidebar__footer">
        <button
          className={`navitem ${route === 'settings' ? 'navitem--active' : ''}`}
          onClick={() => setRoute('settings')}
          {...tip(t('nav.settings'))}
        >
          <IconSettings size={18} />
          <span className="navitem__label">{t('nav.settings')}</span>
        </button>
      </div>
    </nav>
  )
}
