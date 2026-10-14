import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import type { Category, ChannelQuery, ChannelWithState } from '@shared/types'
import { invoke, messageOf } from '@renderer/lib/api'
import { formatCount } from '@renderer/lib/format'
import { useAppStore } from '@renderer/store/useAppStore'
import { Empty } from '@renderer/ui/Empty'
import { IconEye, IconRefresh, IconSearch, IconSidebar } from '@renderer/ui/Icon'
import { ListSkeleton } from '@renderer/ui/Skeletons'
import { VirtualList } from '@renderer/ui/VirtualList'
import { Player } from '@renderer/features/player/Player'
import { CHANNEL_ROW_HEIGHT, ChannelRow } from './ChannelRow'
import { useNumberEntry } from './useNumberEntry'
import { HealthScan } from './HealthScan'
import { useT } from '@renderer/i18n'

interface Props {
  /** 'favorites' reuses this screen with the favorites filter pinned on. */
  mode: 'live' | 'favorites'
  onAddSource: () => void
}

type Sort = NonNullable<ChannelQuery['sort']>

export function LiveTv({ mode, onAddSource }: Props): JSX.Element {
  const { activePlaylistId, playlists, activeChannel, setActiveChannel, capabilities, setRoute } = useAppStore()
  const settings = useAppStore((state) => state.settings)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const listsCollapsed = settings.liveListsCollapsed

  const [categories, setCategories] = useState<Category[]>([])
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [channels, setChannels] = useState<ChannelWithState[]>([])
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [sort, setSort] = useState<Sort>('name')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  /**
   * Hidden channels are excluded everywhere by default; this reveals them in
   * place so one can be brought back. Without it, hiding a channel is a
   * one-way door.
   */
  const [showHidden, setShowHidden] = useState(false)
  const [scanning, setScanning] = useState(false)
  const t = useT()
  /**
   * Whether a channel has been chosen since this view was opened.
   *
   * Favorites shares the active channel with Live TV, so simply arriving here
   * used to reconnect to whatever was last watched — a channel that is often
   * not even in this list, and a provider connection spent on something nobody
   * asked to see. Live TV still resumes, because there the last channel is the
   * point.
   */
  const [pickedHere, setPickedHere] = useState(mode === 'live')

  useEffect(() => setPickedHere(mode === 'live'), [mode])

  const chooseChannel = useCallback(
    (channel: ChannelWithState) => {
      setPickedHere(true)
      setActiveChannel(channel)
    },
    [setActiveChannel]
  )

  const playlist = useMemo(
    () => playlists.find((p) => p.id === activePlaylistId) ?? null,
    [playlists, activePlaylistId]
  )

  // Debounce keeps a large playlist from re-querying on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 220)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    setCategoryId(null)
    setSearch('')
    if (activePlaylistId == null) {
      setCategories([])
      return
    }
    void invoke('categories:list', { playlistId: activePlaylistId, kind: 'live' })
      .then(setCategories)
      .catch((e) => setError(messageOf(e)))
  }, [activePlaylistId])

  const loadChannels = useCallback(async () => {
    if (activePlaylistId == null) {
      setChannels([])
      setTotal(0)
      return
    }

    const query: ChannelQuery = {
      playlistId: activePlaylistId,
      categoryId: mode === 'favorites' ? null : categoryId,
      search: debounced || undefined,
      favoritesOnly: mode === 'favorites',
      includeHidden: showHidden,
      sort,
      limit: 3000
    }

    setLoading(true)
    setError(null)
    try {
      const [rows, count] = await Promise.all([invoke('channels:query', query), invoke('channels:count', query)])
      setChannels(rows)
      setTotal(count)
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setLoading(false)
    }
  }, [activePlaylistId, categoryId, debounced, sort, mode, showHidden])

  useEffect(() => {
    void loadChannels()
  }, [loadChannels])

  const toggleHidden = useCallback(
    async (channel: ChannelWithState) => {
      const hidden = !channel.hidden
      await invoke('channels:setHidden', { id: channel.id, hidden })

      // While hidden channels are on screen the row stays and changes state;
      // otherwise it leaves the list, which is the whole point of hiding it.
      setChannels((rows) =>
        showHidden
          ? rows.map((r) => (r.id === channel.id ? { ...r, hidden } : r))
          : rows.filter((r) => r.id !== channel.id)
      )
      if (!showHidden) setTotal((count) => Math.max(0, count - 1))
    },
    [showHidden]
  )

  const toggleFavorite = useCallback(
    async (channel: ChannelWithState) => {
      const favorite = await invoke('channels:toggleFavorite', channel.id)
      setChannels((rows) => rows.map((r) => (r.id === channel.id ? { ...r, favorite } : r)))
      setActiveChannel(
        useAppStore.getState().activeChannel?.id === channel.id
          ? { ...channel, favorite }
          : useAppStore.getState().activeChannel
      )
      if (mode === 'favorites' && !favorite) void loadChannels()
    },
    [loadChannels, mode, setActiveChannel]
  )

  /** Page Up / Page Down walk the list currently on screen. */
  const stepChannel = useCallback(
    (delta: number) => {
      if (channels.length === 0) return
      const current = channels.findIndex((c) => c.id === activeChannel?.id)
      const next = current === -1 ? 0 : (current + delta + channels.length) % channels.length
      const target = channels[next]
      if (target) chooseChannel(target)
    },
    [channels, activeChannel?.id, chooseChannel]
  )

  // Typing a channel number jumps to it, as on a television. Only in the live
  // list: in Favorites the numbers on screen are a subset and jumping to one
  // that is filtered out would look like nothing happened.
  const numberEntry = useNumberEntry(channels, chooseChannel, mode === 'live')

  const runSync = async (): Promise<void> => {
    if (activePlaylistId == null) return
    setSyncing(true)
    setError(null)
    try {
      await invoke('playlists:sync', activePlaylistId)
      await useAppStore.getState().refreshPlaylists()
      const next = await invoke('categories:list', { playlistId: activePlaylistId, kind: 'live' })
      setCategories(next)
      await loadChannels()
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setSyncing(false)
    }
  }

  if (!playlist) {
    return (
      <Empty
        title="No source selected"
        description="Add an Xtream Codes account or an M3U playlist to start browsing channels."
        action={
          <button className="btn btn--primary" onClick={onAddSource}>
            Add a source
          </button>
        }
      />
    )
  }

  return (
    <>
      <div className="toolbar">
        <h1 className="toolbar__title">{mode === 'favorites' ? t('live.favoritesTitle') : t('live.title')}</h1>

        <div className="search">
          <IconSearch size={15} />
          <input
            className="input"
            placeholder={t('live.searchChannels')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <div className="segmented">
          {(['name', 'number', 'recent'] as Sort[]).map((option) => (
            <button key={option} aria-pressed={sort === option} onClick={() => setSort(option)}>
              {option === 'name' ? t('live.sortName') : option === 'number' ? t('live.sortNumber') : t('live.sortRecent')}
            </button>
          ))}
        </div>

        <div className="spacer" />

        <button
          className={`btn ${showHidden ? '' : 'btn--ghost'}`}
          onClick={() => setShowHidden((value) => !value)}
          title={showHidden ? t('live.hideHidden') : t('live.showHidden')}
          aria-pressed={showHidden}
        >
          <IconEye size={15} off={!showHidden} />
          {t('live.hidden')}
        </button>

        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{formatCount(total)} {t('common.channels')}</span>

        {/*
          The same fold the sidebar's own toggle does, for this screen's lists.
          Clicking Live TV in the sidebar while already on it does this too;
          this is the part you can see.
        */}
        <button
          className="btn btn--ghost"
          onClick={() => void updateSettings({ liveListsCollapsed: !listsCollapsed })}
          title={listsCollapsed ? t('live.showLists') : t('live.hideLists')}
          aria-label={listsCollapsed ? t('live.showLists') : t('live.hideLists')}
          aria-pressed={listsCollapsed}
        >
          <IconSidebar size={15} />
        </button>

        {/*
          Only offered on Favorites. Checking eight thousand channels one at a
          time would run for a day and hammer an account that allows one
          connection; thirty favourites is a job worth doing.
        */}
        {mode === 'favorites' && activePlaylistId !== null && (
          <button className="btn btn--ghost" onClick={() => setScanning(true)}>
            {t('health.scan')}
          </button>
        )}

        <button className="btn" onClick={() => void runSync()} disabled={syncing}>
          {syncing ? <span className="spinner" /> : <IconRefresh size={15} />}
          {syncing ? t('common.syncing') : t('common.sync')}
        </button>
      </div>

      {error && (
        <div className="notice notice--error" style={{ margin: '10px 14px 0' }}>
          {error}
        </div>
      )}

      {numberEntry.digits !== null && (
        <div className="numentry" role="status" aria-live="polite">
          <strong>{numberEntry.digits}</strong>
          <span>
            {numberEntry.match
              ? numberEntry.match.name
              : t('live.noChannelNumber', { number: Number(numberEntry.digits) })}
          </span>
        </div>
      )}

      {scanning && activePlaylistId !== null && (
        <HealthScan playlistId={activePlaylistId} onClose={() => setScanning(false)} />
      )}

      <div
        className={`live ${mode === 'favorites' ? 'live--nocats' : ''} ${
          listsCollapsed ? 'live--collapsed' : ''
        }`}
      >
        {mode === 'live' && (
          <div className="pane">
            <div className="pane__head">{t('live.categories')}</div>
            <div className="pane__scroll">
              <button
                className={`catitem ${categoryId === null ? 'catitem--active' : ''}`}
                onClick={() => setCategoryId(null)}
              >
                <span className="catitem__name">{t('live.allChannels')}</span>
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
        )}

        <div className="pane">
          <div className="pane__head">
            Channels {total > channels.length && `(showing ${formatCount(channels.length)})`}
          </div>

          {loading && channels.length === 0 ? (
            <ListSkeleton rows={9} />
          ) : (
            <VirtualList
              className="pane__scroll chanlist"
              items={channels}
              itemHeight={CHANNEL_ROW_HEIGHT}
              keyOf={(channel) => channel.id}
              emptyState={
                <Empty
                  title={mode === 'favorites' ? 'No favorites yet' : 'No channels'}
                  description={
                    mode === 'favorites'
                      ? 'Star a channel to keep it here.'
                      : playlist.lastSyncedAt
                        ? 'Nothing matches this filter.'
                        : 'This source has not been synced yet.'
                  }
                  action={
                    !playlist.lastSyncedAt && mode === 'live' ? (
                      <button className="btn btn--primary" onClick={() => void runSync()} disabled={syncing}>
                        {t('live.syncNow')}
                      </button>
                    ) : undefined
                  }
                />
              }
              renderItem={(channel) => (
                <ChannelRow
                  channel={channel}
                  active={activeChannel?.id === channel.id}
                  onSelect={chooseChannel}
                  onToggleFavorite={(c) => void toggleFavorite(c)}
                  onToggleHidden={(c) => void toggleHidden(c)}
                />
              )}
            />
          )}
        </div>

        <div className="pane pane--last">
          <Player
            channel={pickedHere ? activeChannel : null}
            onToggleFavorite={(c) => void toggleFavorite(c)}
            capabilities={capabilities}
            onOpenSettings={() => setRoute('settings')}
            onStepChannel={stepChannel}
          />
        </div>
      </div>
    </>
  )
}
