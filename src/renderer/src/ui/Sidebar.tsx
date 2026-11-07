import type { JSX, ReactNode } from 'react'
import type { Playlist, PlaylistFolder } from '@shared/types'
import { invoke } from '@renderer/lib/api'
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

// A portal is neither of the other two and used to be labelled M3U, which is
// the one thing it definitely is not. Keyed off the type so a fourth kind
// fails to compile rather than quietly inheriting a wrong badge.
const KIND_BADGE: Record<Playlist['kind'], string> = {
  xtream: 'XC',
  m3u: 'M3U',
  stalker: 'MAC'
}

export function Sidebar({ onAddSource, collapsed }: Props): JSX.Element {
  const {
    route,
    setRoute,
    playlists,
    folders,
    activePlaylistId,
    allSources,
    setActivePlaylist,
    setAllSources,
    refreshPlaylists
  } = useAppStore()
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

  /**
   * Sources that are in no folder. These stay at the top level rather than
   * being herded into an "Other" folder, because a source nobody has filed is
   * not in a category called unfiled — it is just there, where it has always
   * been.
   *
   * Defined as "not in a folder that exists" rather than "folderId is null",
   * which is the same thing right up until it is not. A source pointing at a
   * folder that has gone would otherwise be drawn nowhere at all: absent from
   * the top level because it claims a folder, and absent from every folder
   * because none of them is the one it claims. Losing the grouping is a
   * cosmetic bug; a provider vanishing from the sidebar is the user
   * reasonably concluding the application has lost their account.
   */
  const folderIds = new Set(folders.map((folder) => folder.id))
  const ungrouped = playlists.filter(
    (playlist) => playlist.folderId == null || !folderIds.has(playlist.folderId)
  )

  const toggleFolder = async (folder: PlaylistFolder): Promise<void> => {
    await invoke('folders:collapse', { id: folder.id, collapsed: !folder.collapsed })
    await refreshPlaylists()
  }

  /**
   * One source, drawn the same whether it sits at the top level or inside a
   * folder. Written once so a folder cannot quietly grow a different-looking
   * row from the ungrouped ones.
   */
  function renderPlaylist(playlist: Playlist): JSX.Element {
    return (
      <button
        key={playlist.id}
        className={`navitem navitem--source ${
          activePlaylistId === playlist.id && !allSources ? 'navitem--active' : ''
        }`}
        onClick={() => {
          setActivePlaylist(playlist.id)
          if (route === 'home' || route === 'settings') setRoute('live')
        }}
        title={
          collapsed ? playlist.name : `${t('nav.lastSynced', { when: formatRelative(playlist.lastSyncedAt) })}`
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
        <span className="navitem__badge">{KIND_BADGE[playlist.kind]}</span>
      </button>
    )
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

        {/*
          Ungrouped sources first, then the folders. Someone who has never
          made a folder sees exactly the list they saw before this existed,
          because everything is ungrouped until they say otherwise.

          In rail mode the grouping is dropped and every source is listed
          flat. A folder header in a 56px rail is two letters and a chevron,
          which reads as another source rather than as a container, and
          collapsing one would hide sources behind something unlabelled.
        */}
        {(collapsed ? playlists : ungrouped).map(renderPlaylist)}

        {!collapsed &&
          folders.map((folder) => {
            const contents = playlists.filter((playlist) => playlist.folderId === folder.id)
            return (
              <div key={folder.id} className="navfolder">
                <button
                  className="navitem navitem--folder"
                  aria-expanded={!folder.collapsed}
                  onClick={() => void toggleFolder(folder)}
                  title={folder.name}
                >
                  <span className="navitem__dot navitem__dot--folder" aria-hidden="true">
                    {folder.collapsed ? '+' : '\u2212'}
                  </span>
                  <span className="navitem__label navitem__label--grow">{folder.name}</span>
                  <span className="navitem__badge">{contents.length}</span>
                </button>

                {/*
                  An empty folder still shows, and says so. A folder that
                  renders as nothing at all looks like the application lost it.
                */}
                {!folder.collapsed && contents.length === 0 && (
                  <p className="navfolder__empty">{t('nav.folderEmpty')}</p>
                )}
                {!folder.collapsed && contents.map(renderPlaylist)}
              </div>
            )
          })}

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
