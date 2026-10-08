import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react'
import type { ChannelWithState, SearchResults } from '@shared/types'
import { invoke, messageOf } from '@renderer/lib/api'
import { initials } from '@renderer/lib/format'
import { useAppStore, type Route } from '@renderer/store/useAppStore'
import { IconFilm, IconGuide, IconGrid, IconLibrary, IconSearch, IconStack, IconTv } from '@renderer/ui/Icon'

interface Props {
  onClose: () => void
}

interface Row {
  key: string
  icon: ReactNode
  title: string
  hint: string
  run: () => void
}

const EMPTY: SearchResults = {
  live: [],
  movies: [],
  series: [],
  totals: { live: 0, movies: 0, series: 0 }
}

/**
 * One search box for the whole app.
 *
 * Providers ship tens of thousands of items spread across three sections, and
 * before this the only way to find something was to know which section it was
 * in and go there first. Jumping straight to a title — or to a screen — from
 * anywhere is the single biggest thing that makes a catalogue this size usable.
 */
export function CommandPalette({ onClose }: Props): JSX.Element {
  const { activePlaylistId, setRoute, setActiveChannel, playlists } = useAppStore()

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResults>(EMPTY)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState(0)

  const listRef = useRef<HTMLDivElement>(null)

  const openChannel = useCallback(
    (channel: ChannelWithState) => {
      if (channel.kind === 'live') {
        setActiveChannel(channel)
        setRoute('live')
      } else {
        // Movies and series open in their own browser, which loads the detail
        // sheet for the id handed to it.
        setRoute(channel.kind === 'movie' ? 'movies' : 'series')
        window.dispatchEvent(new CustomEvent('libercast:open-vod', { detail: channel.id }))
      }
      onClose()
    },
    [onClose, setActiveChannel, setRoute]
  )

  const goTo = useCallback(
    (route: Route) => {
      setRoute(route)
      onClose()
    },
    [onClose, setRoute]
  )

  // Screens are matched on the same query, so "gui" jumps to the Guide without
  // the user having to know it is in the sidebar.
  const navigationRows: Row[] = useMemo(() => {
    const screens: { route: Route; label: string; icon: ReactNode }[] = [
      { route: 'live', label: 'Live TV', icon: <IconTv size={15} /> },
      { route: 'guide', label: 'Guide', icon: <IconGuide size={15} /> },
      { route: 'multiview', label: 'Multi-view', icon: <IconGrid size={15} /> },
      { route: 'movies', label: 'Movies', icon: <IconFilm size={15} /> },
      { route: 'series', label: 'Series', icon: <IconStack size={15} /> },
      { route: 'library', label: 'Library', icon: <IconLibrary size={15} /> },
      { route: 'settings', label: 'Settings', icon: <IconSearch size={15} /> }
    ]

    const needle = query.trim().toLowerCase()
    return screens
      .filter((screen) => needle === '' || screen.label.toLowerCase().includes(needle))
      .map((screen) => ({
        key: `route:${screen.route}`,
        icon: screen.icon,
        title: screen.label,
        hint: 'Go to',
        run: () => goTo(screen.route)
      }))
  }, [query, goTo])

  useEffect(() => {
    const needle = query.trim()
    if (needle.length < 2 || activePlaylistId === null) {
      setResults(EMPTY)
      return
    }

    setLoading(true)
    const timer = setTimeout(() => {
      void invoke('search:global', { playlistId: activePlaylistId, query: needle, limit: 6 })
        .then(setResults)
        .catch((e) => setError(messageOf(e)))
        .finally(() => setLoading(false))
    }, 180)

    return () => clearTimeout(timer)
  }, [query, activePlaylistId])

  const rows: Row[] = useMemo(() => {
    const contentRows = (channels: ChannelWithState[], hint: string): Row[] =>
      channels.map((channel) => ({
        key: `${channel.kind}:${channel.id}`,
        icon: (
          <span className="palette__logo">
            {channel.logoUrl ? (
              <img src={channel.logoUrl} alt="" loading="lazy" />
            ) : (
              <span>{initials(channel.name)}</span>
            )}
          </span>
        ),
        title: channel.name,
        hint: channel.now ? `${hint} · ${channel.now.title}` : hint,
        run: () => openChannel(channel)
      }))

    return [
      ...contentRows(results.live, 'Live'),
      ...contentRows(results.movies, 'Movie'),
      ...contentRows(results.series, 'Series'),
      ...navigationRows
    ]
  }, [results, navigationRows, openChannel])

  useEffect(() => setActive(0), [rows.length])

  // The list scrolls, so the highlighted row has to be brought into view or
  // arrow navigation walks off the bottom invisibly.
  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)
    node?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => (rows.length === 0 ? 0 : (index + 1) % rows.length))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => (rows.length === 0 ? 0 : (index - 1 + rows.length) % rows.length))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      rows[active]?.run()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  const totals = results.totals.live + results.totals.movies + results.totals.series

  return (
    <div className="scrim scrim--top" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search">
        <div className="palette__input">
          <IconSearch size={17} />
          <input
            autoFocus
            placeholder={
              playlists.length === 0
                ? 'Add a source to search your channels…'
                : 'Search channels, movies, series — or jump to a screen'
            }
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            aria-label="Search"
          />
          {loading && <span className="spinner" />}
          <kbd>Esc</kbd>
        </div>

        {error && <div className="notice notice--error" style={{ margin: '0 10px 10px' }}>{error}</div>}

        <div className="palette__list" ref={listRef}>
          {rows.map((row, index) => (
            <button
              key={row.key}
              data-index={index}
              className={`palette__row ${index === active ? 'palette__row--on' : ''}`}
              onMouseEnter={() => setActive(index)}
              onClick={row.run}
            >
              <span className="palette__icon">{row.icon}</span>
              <span className="palette__title">{row.title}</span>
              <span className="palette__hint">{row.hint}</span>
            </button>
          ))}

          {rows.length === 0 && (
            <p className="palette__empty">
              {query.trim().length < 2
                ? 'Type at least two characters.'
                : 'Nothing matched. Try a shorter search, or sync the source first.'}
            </p>
          )}
        </div>

        <div className="palette__foot">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> to move
          </span>
          <span>
            <kbd>↵</kbd> to open
          </span>
          <span className="spacer" />
          {totals > rows.length && <span>{totals.toLocaleString()} matches in total</span>}
        </div>
      </div>
    </div>
  )
}
