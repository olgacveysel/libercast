import { create } from 'zustand'
import type { AppSettings, ChannelWithState, MediaCapabilities, Playlist, SyncProgress } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import { invoke } from '@renderer/lib/api'
import { setFormatLocale } from '@renderer/lib/format'
import { localeOf } from '@renderer/i18n/locale'
import { normalizeSubtitleStyle, subtitleCss } from '@renderer/features/player/subtitleStyle'

export type Route =
  | 'home'
  | 'live'
  | 'guide'
  | 'multiview'
  | 'movies'
  | 'series'
  | 'favorites'
  | 'library'
  | 'settings'

interface AppState {
  route: Route
  settings: AppSettings
  playlists: Playlist[]
  activePlaylistId: number | null
  activeChannel: ChannelWithState | null
  syncing: SyncProgress | null
  capabilities: MediaCapabilities | null
  ready: boolean
  /**
   * When the sleep timer should stop playback, as a timestamp, or null.
   *
   * Deliberately not persisted: a timer that survived a restart would stop
   * playback at a time nobody set, hours later, with no way to see why.
   */
  sleepAt: number | null

  setRoute: (route: Route) => void
  setActivePlaylist: (id: number | null) => void
  setActiveChannel: (channel: ChannelWithState | null) => void
  setSyncing: (progress: SyncProgress | null) => void
  setSleepAt: (at: number | null) => void

  bootstrap: () => Promise<void>
  refreshPlaylists: () => Promise<Playlist[]>
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>
  refreshCapabilities: () => Promise<void>
}

export const useAppStore = create<AppState>((set, get) => ({
  route: 'home',
  settings: DEFAULT_SETTINGS,
  playlists: [],
  activePlaylistId: null,
  activeChannel: null,
  syncing: null,
  capabilities: null,
  ready: false,
  sleepAt: null,

  setRoute: (route) => set({ route }),
  setActivePlaylist: (activePlaylistId) => set({ activePlaylistId }),
  setActiveChannel: (activeChannel) => set({ activeChannel }),
  setSyncing: (syncing) => set({ syncing }),
  setSleepAt: (sleepAt) => set({ sleepAt }),

  bootstrap: async () => {
    const [settings, playlists, capabilities] = await Promise.all([
      invoke('settings:get'),
      invoke('playlists:list'),
      invoke('media:capabilities')
    ])
    set({
      settings,
      playlists,
      capabilities,
      activePlaylistId: playlists[0]?.id ?? null,
      route: playlists.length > 0 ? 'live' : 'home',
      ready: true
    })
    applyTheme(settings)
  },

  refreshPlaylists: async () => {
    const playlists = await invoke('playlists:list')
    const current = get().activePlaylistId
    const stillExists = playlists.some((p) => p.id === current)
    set({ playlists, activePlaylistId: stillExists ? current : playlists[0]?.id ?? null })
    return playlists
  },

  updateSettings: async (patch) => {
    const settings = await invoke('settings:set', patch)
    set({ settings })
    applyTheme(settings)
    // The ffmpeg path change only takes effect once it is re-resolved.
    if (patch.ffmpegPath !== undefined) set({ capabilities: await invoke('media:capabilities') })
  },

  refreshCapabilities: async () => {
    set({ capabilities: await invoke('media:capabilities') })
  }
}))

/**
 * Applies everything about the settings that lives outside React.
 *
 * The document's `lang` belongs here alongside the theme: it is what screen
 * readers announce in and what CSS language selectors match, and it has to
 * follow the chosen language rather than being set once at startup.
 */
export function applyTheme(settings: AppSettings): void {
  document.documentElement.lang = settings.language
  setFormatLocale(localeOf(settings.language))
  applyThemeOnly(settings)
  applySubtitleStyle(settings)
}

/** The element holding the generated `::cue` rule. */
const SUBTITLE_STYLE_ID = 'subtitle-appearance'

/**
 * Writes the subtitle appearance into a stylesheet of its own.
 *
 * It has to be a real stylesheet rather than inline style or a custom property:
 * cues are drawn by the browser inside the video element, so the only way to
 * reach them is the `::cue` pseudo-element, which cannot be addressed inline and
 * which custom properties do not reach reliably in Chromium.
 *
 * The element is appended last, after the bundled stylesheet, so its rule wins
 * over the default in global.css without needing `!important`.
 */
export function applySubtitleStyle(settings: AppSettings): void {
  let element = document.getElementById(SUBTITLE_STYLE_ID) as HTMLStyleElement | null
  if (!element) {
    element = document.createElement('style')
    element.id = SUBTITLE_STYLE_ID
    document.head.append(element)
  }

  const css = subtitleCss(normalizeSubtitleStyle(settings))
  // Assigning an unchanged string still invalidates style for the whole
  // document, and this runs on every settings change.
  if (element.textContent !== css) element.textContent = css
}

function applyThemeOnly(settings: AppSettings): void {
  const root = document.documentElement
  const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches
  const resolved = settings.theme === 'system' ? (prefersLight ? 'light' : 'dark') : settings.theme

  root.dataset.theme = resolved
  root.style.setProperty('--accent', settings.accentColor)
  root.style.setProperty('--accent-soft', hexToRgba(settings.accentColor, 0.14))

  // Scaling the root font size carries every rem-based dimension with it, so
  // one value changes text, spacing and control heights together.
  const scale = Math.min(1.6, Math.max(0.8, settings.uiScale || 1))
  root.style.setProperty('--ui-scale', String(scale))
}

function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace('#', '')
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value
  const int = Number.parseInt(full, 16)
  if (!Number.isFinite(int)) return `rgba(79, 140, 255, ${alpha})`
  return `rgba(${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}, ${alpha})`
}
