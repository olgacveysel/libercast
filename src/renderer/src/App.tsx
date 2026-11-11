import { useEffect, useState, type JSX } from 'react'
import { invoke, subscribe } from '@renderer/lib/api'
import { useAppStore } from '@renderer/store/useAppStore'
import { Empty } from '@renderer/ui/Empty'
import { Sidebar } from '@renderer/ui/Sidebar'
import { useSidebarRail } from '@renderer/ui/useSidebarRail'
import { useSleepTimer } from '@renderer/features/player/useSleepTimer'
import { TitleBar } from '@renderer/ui/TitleBar'
import { Guide } from '@renderer/features/guide/Guide'
import { Home } from '@renderer/features/home/Home'
import { Library } from '@renderer/features/library/Library'
import { MultiView } from '@renderer/features/multiview/MultiView'
import { CommandPalette } from '@renderer/features/search/CommandPalette'
import { LiveTv, type LiveDisplay } from '@renderer/features/live/LiveTv'
import { VodBrowser } from '@renderer/features/vod/VodBrowser'
import { AddSourceDialog } from '@renderer/features/onboarding/AddSourceDialog'
import { Settings } from '@renderer/features/settings/Settings'
import { UpdateBanner } from '@renderer/features/settings/UpdateBanner'
import { UpdatePrompt } from '@renderer/features/settings/UpdatePrompt'
import { useT } from '@renderer/i18n'

/** Typing "/" in a field must insert a slash, not open the palette. */
function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  const tag = element.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable
}

export function App(): JSX.Element {
  const { route, ready, bootstrap, refreshPlaylists, setSyncing, setActivePlaylist, setRoute, capabilities } =
    useAppStore()
  const setActiveChannel = useAppStore((s) => s.setActiveChannel)
  const [showAddSource, setShowAddSource] = useState(false)
  const [showPalette, setShowPalette] = useState(false)
  /** Set when the corner window is dismissed, cleared by going back to Live TV. */
  const [miniClosed, setMiniClosed] = useState(false)
  const activeChannel = useAppStore((s) => s.activeChannel)

  /**
   * Which screens the player follows you to.
   *
   * Favourites is this same screen with the favourites filter pinned on, and
   * multi-view runs several streams of its own. A corner window on either
   * would mean two sessions open at once — which on an account that allows a
   * single connection is not a cosmetic problem: the provider refuses one of
   * them, and the user sees a channel that will not start. So those two stop
   * it, and everywhere else it keeps playing.
   */
  const liveDisplay: LiveDisplay =
    route === 'live'
      ? 'full'
      : route === 'favorites' || route === 'multiview'
        ? 'hidden'
        : activeChannel && !miniClosed
          ? 'mini'
          : 'hidden'

  // Arriving back at Live TV is the natural way to say "show it again".
  useEffect(() => {
    if (route === 'live') setMiniClosed(false)
  }, [route])
  const rail = useSidebarRail()
  const t = useT()

  // Runs for the whole session, not inside a player: the timer has to keep
  // counting while you are browsing the guide or the catalogue.
  useSleepTimer()

  useEffect(() => {
    void bootstrap()
    return subscribe('sync:progress', setSyncing)
  }, [bootstrap, setSyncing])

  /**
   * A reminder toast that only announced a programme would leave the person to
   * go and find the channel themselves, by which time they have missed the
   * opening. Clicking it tunes straight to it.
   */
  // A refresh that happened in the background must not leave stale counts and
  // a stale "last synced" on screen.
  /*
   * A background refresh updates the data, nothing else.
   *
   * This used to call `bootstrap`, which also sets the route to Live and the
   * active source to the first one — so an automatic refresh while somebody
   * was reading the guide, or watching a channel on their second source,
   * moved them without being asked.
   */
  useEffect(
    () => subscribe('sources:refreshed', () => void refreshPlaylists()),
    [refreshPlaylists]
  )

  useEffect(() => {
    return subscribe('reminders:tune', (reminder) => {
      void invoke('channels:get', reminder.channelId)
        .then((channel) => {
          if (!channel) return
          setActiveChannel(channel)
          setRoute('live')
        })
        .catch(() => undefined)
    })
  }, [setActiveChannel, setRoute])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      // Ctrl+K is the convention people already expect from other apps, and
      // plain "/" matches the browsers and readers they use all day.
      const isPaletteKey =
        ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') ||
        (event.key === '/' && !isTyping(event.target))

      if (isPaletteKey) {
        event.preventDefault()
        setShowPalette(true)
        return
      }

      // Ctrl+B, as in the editors and chat apps people already have open.
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault()
        rail.toggle()
        return
      }

      if (event.key === 'Escape') setShowAddSource(false)
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rail])

  const openAddSource = (): void => setShowAddSource(true)

  return (
    <div className="app">
      <TitleBar onOpenSearch={() => setShowPalette(true)} />

      <UpdatePrompt />
      <UpdateBanner />

      <div className={`app-body ${rail.collapsed ? 'app-body--rail' : ''}`}>
        <Sidebar onAddSource={openAddSource} collapsed={rail.collapsed} />

        <main className="main">
          {!ready ? (
            <Empty title={t('app.startingUp')} />
          ) : (
            <>
              {route === 'home' && (
                <Home onAddSource={openAddSource} onOpenSearch={() => setShowPalette(true)} />
              )}
              {route === 'guide' && <Guide onAddSource={openAddSource} capabilities={capabilities} />}
              {route === 'multiview' && <MultiView onAddSource={openAddSource} />}
              {route === 'favorites' && <LiveTv mode="favorites" onAddSource={openAddSource} />}
              {route === 'movies' && <VodBrowser kind="movie" onAddSource={openAddSource} />}
              {route === 'series' && <VodBrowser kind="series" onAddSource={openAddSource} />}
              {route === 'library' && (
                <Library capabilities={capabilities} onOpenSettings={() => setRoute('settings')} />
              )}
              {route === 'settings' && <Settings onAddSource={openAddSource} />}

              {/*
                Live TV is rendered here whatever route is showing, and told
                how to draw itself. That is the whole mechanism: a component
                rendered in a different branch is a different position to
                React, so moving it would unmount it — and an unmounted player
                is a closed stream, a dropped provider connection, and the
                match you were watching gone.
              */}
              <LiveTv
                mode="live"
                onAddSource={openAddSource}
                display={liveDisplay}
                onExpand={() => setRoute('live')}
                onClose={() => setMiniClosed(true)}
              />
            </>
          )}
        </main>
      </div>

      {showPalette && <CommandPalette onClose={() => setShowPalette(false)} />}

      {showAddSource && (
        <AddSourceDialog
          onClose={() => setShowAddSource(false)}
          onCreated={(playlistId) => {
            setShowAddSource(false)
            setActivePlaylist(playlistId)
            setRoute('live')
          }}
        />
      )}
    </div>
  )
}
