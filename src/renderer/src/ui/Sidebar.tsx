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
  const { route, setRoute, playlists, activePlaylistId, allSources, setActivePlaylist, setAllSources } =
    useAppStore()
  const settings = useAppStore((state) => state.settings)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const t = useT()

  /**
   * Clicking a navigation item you are already on folds that screen's lists
   * away, leaving the picture. Clicking again brings them back.
   *
   * Only Live TV and Favorites have lists to fold, and they are the two
   * screens built around watching something. Everywhere else a second click
   * stays what it has always been: nothing.
   */
  const onNavClick = (next: Route): void => {
    if (route !== next) {
      setRoute(next)
      return
    }
    if (next === 'live' || next === 'favorites') {
      void updateSettings({ liveListsCollapsed: !settings.liveListsCollapsed })
    }
  }

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
            onClick={() => onNavClick(item.route)}
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

        {/*
          Only offered once there is something to merge. With one source it
          would be a second button that does exactly what the first one does.
        */}
        {playlists.length > 1 && (
          <button
            className={`navitem ${allSources ? 'navitem--active' : ''}`}
            onClick={() => {
              setAllSources()
              if (route === 'home' || route === 'settings') setRoute('live')
            }}
            title={t('nav.allSourcesBody')}
          >
            <span className="navitem__dot navitem__dot--ok" aria-hidden="true">
              {playlists.length}
            </span>
            <span className="navitem__label navitem__label--grow">{t('nav.allSources')}</span>
          </button>
        )}

        {playlists.map((playlist) => (
          <button
            key={playlist.id}
            className={`navitem ${
              activePlaylistId === playlist.id && !allSources ? 'navitem--active' : ''
            }`}
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
