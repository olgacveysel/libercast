import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import type { Category, ChannelQuery, ChannelWithState, ContentKind, SeriesEpisode } from '@shared/types'
import { invoke, messageOf } from '@renderer/lib/api'
import { formatCount, initials } from '@renderer/lib/format'
import { useAppStore } from '@renderer/store/useAppStore'
import { useT } from '@renderer/i18n'
import { Empty } from '@renderer/ui/Empty'
import { IconRefresh, IconSearch } from '@renderer/ui/Icon'
import { VodDetail } from './VodDetail'
import { VodPlayer, type VodTarget } from './VodPlayer'

interface Props {
  kind: Extract<ContentKind, 'movie' | 'series'>
  onAddSource: () => void
}

/** Poster grids get heavy fast; this caps one page of results. */
const PAGE_SIZE = 300

export function VodBrowser({ kind, onAddSource }: Props): JSX.Element {
  const { activePlaylistId, playlists } = useAppStore()
  const t = useT()

  const [categories, setCategories] = useState<Category[]>([])
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [items, setItems] = useState<ChannelWithState[]>([])
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<ChannelWithState | null>(null)
  const [playing, setPlaying] = useState<VodTarget | null>(null)
  const [syncing, setSyncing] = useState(false)

  const playlist = useMemo(
    () => playlists.find((p) => p.id === activePlaylistId) ?? null,
    [playlists, activePlaylistId]
  )

  const isMovies = kind === 'movie'

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 220)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    setCategoryId(null)
    setSearch('')
    setSelected(null)
    if (activePlaylistId == null) {
      setCategories([])
      return
    }
    void invoke('categories:list', { playlistId: activePlaylistId, kind })
      .then(setCategories)
      .catch((e) => setError(messageOf(e)))
  }, [activePlaylistId, kind])

  const load = useCallback(async () => {
    if (activePlaylistId == null) {
      setItems([])
      setTotal(0)
      return
    }

    const query: ChannelQuery = {
      playlistId: activePlaylistId,
      kind,
      categoryId,
      search: debounced || undefined,
      sort: 'name',
      limit: PAGE_SIZE
    }

    setLoading(true)
    setError(null)
    try {
      const [rows, count] = await Promise.all([invoke('channels:query', query), invoke('channels:count', query)])
      setItems(rows)
      setTotal(count)
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setLoading(false)
    }
  }, [activePlaylistId, categoryId, debounced, kind])

  useEffect(() => {
    void load()
  }, [load])

  // The command palette can land on a title directly; it asks this screen to
  // open the detail sheet once it has mounted.
  useEffect(() => {
    const onOpen = (event: Event): void => {
      const id = (event as CustomEvent<number>).detail
      void invoke('channels:get', id).then((channel) => {
        if (channel && channel.kind === kind) setSelected(channel)
      })
    }
    window.addEventListener('libercast:open-vod', onOpen)
    return () => window.removeEventListener('libercast:open-vod', onOpen)
  }, [kind])

  const toggleFavorite = useCallback(async (channel: ChannelWithState) => {
    const favorite = await invoke('channels:toggleFavorite', channel.id)
    setItems((rows) => rows.map((r) => (r.id === channel.id ? { ...r, favorite } : r)))
    setSelected((current) => (current && current.id === channel.id ? { ...current, favorite } : current))
  }, [])

  const runSync = async (): Promise<void> => {
    if (activePlaylistId == null) return
    setSyncing(true)
    try {
      await invoke('playlists:sync', activePlaylistId)
      await useAppStore.getState().refreshPlaylists()
      setCategories(await invoke('categories:list', { playlistId: activePlaylistId, kind }))
      await load()
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setSyncing(false)
    }
  }

  const playEpisode = async (episode: SeriesEpisode): Promise<void> => {
    if (!selected) return
    const local = await invoke('downloads:forItem', { itemType: 'episode', itemId: episode.id }).catch(
      () => null
    )

    setPlaying({
      itemType: 'episode',
      itemId: episode.id,
      channelId: selected.id,
      title: `${selected.name} — S${String(episode.season).padStart(2, '0')}E${String(episode.episode).padStart(2, '0')} ${episode.title}`,
      source: local?.status === 'completed' ? { type: 'download', id: local.id } : undefined
    })
  }

  if (!playlist) {
    return (
      <Empty
        title={t('mv.noSource')}
        description={t(isMovies ? 'vod.addSourceMovies' : 'vod.addSourceSeries')}
        action={
          <button className="btn btn--primary" onClick={onAddSource}>
            {t('nav.addSource')}
          </button>
        }
      />
    )
  }

  return (
    <>
      <div className="toolbar">
        <h1 className="toolbar__title">{t(isMovies ? 'nav.movies' : 'nav.series')}</h1>

        <div className="search">
          <IconSearch size={15} />
          <input
            className="input"
            placeholder={t(isMovies ? 'vod.searchMovies' : 'vod.searchSeries')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <div className="spacer" />

        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          {formatCount(total)} {total > PAGE_SIZE ? t('vod.showing', { count: PAGE_SIZE }) : ''}
        </span>

        <button className="btn" onClick={() => void runSync()} disabled={syncing}>
          {syncing ? <span className="spinner" /> : <IconRefresh size={15} />}
          {t('common.sync')}
        </button>
      </div>

      {error && (
        <div className="notice notice--error" style={{ margin: '10px 14px 0' }}>
          {error}
        </div>
      )}

      <div className="vod" style={{ position: 'relative' }}>
        <div className="pane">
          <div className="pane__head">{t('live.categories')}</div>
          <div className="pane__scroll">
            <button
              className={`catitem ${categoryId === null ? 'catitem--active' : ''}`}
              onClick={() => setCategoryId(null)}
            >
              <span className="catitem__name">{t(isMovies ? 'vod.allMovies' : 'vod.allSeries')}</span>
            </button>
            {categories.map((category) => (
              <button
                key={category.id}
                className={`catitem ${categoryId === category.id ? 'catitem--active' : ''}`}
                onClick={() => setCategoryId(category.id)}
                title={category.name}
              >
                <span className="catitem__name">{category.name}</span>
                <span className="catitem__count">{category.channelCount}</span>
              </button>
            ))}
          </div>
        </div>

        {items.length === 0 && !loading ? (
          <Empty
            title={t(isMovies ? 'vod.noMovies' : 'vod.noSeries')}
            description={t(playlist.lastSyncedAt ? 'vod.noMatches' : 'vod.notSynced')}
            action={
              !playlist.lastSyncedAt ? (
                <button className="btn btn--primary" onClick={() => void runSync()} disabled={syncing}>
                  {t('live.syncNow')}
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="postergrid">
            {items.map((item) => (
              <button key={item.id} className="poster" onClick={() => setSelected(item)}>
                <span className="poster__art">
                  {item.logoUrl ? (
                    <img src={item.logoUrl} alt="" loading="lazy" />
                  ) : (
                    <span>{initials(item.name)}</span>
                  )}
                </span>
                <span className="poster__name">{item.name}</span>
              </button>
            ))}
          </div>
        )}

        {selected && (
          <VodDetail
            channel={selected}
            onClose={() => setSelected(null)}
            onPlay={setPlaying}
            onToggleFavorite={(c) => void toggleFavorite(c)}
          />
        )}

        {playing && (
          <VodPlayer
            target={playing}
            onClose={() => setPlaying(null)}
            onPlayEpisode={kind === 'series' ? (episode) => void playEpisode(episode) : undefined}
          />
        )}
      </div>
    </>
  )
}
