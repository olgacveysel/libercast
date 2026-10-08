import { useEffect } from 'react'

export interface HotkeyActions {
  togglePlay?: () => void
  seek?: (deltaSecs: number) => void
  adjustVolume?: (delta: number) => void
  toggleMute?: () => void
  toggleFullscreen?: () => void
  toggleStats?: () => void
  nextChannel?: () => void
  previousChannel?: () => void
  /** +1 faster, -1 slower. Only offered where speed makes sense. */
  stepSpeed?: (direction: 1 | -1) => void
  cycleFit?: () => void
  close?: () => void
}

/**
 * What the cheat sheet in Settings shows.
 *
 * Most of these are bound in this file. The last three are not — the sidebar
 * toggle uses a modifier, which this hook deliberately ignores, and the digits
 * mean different things in different screens — so they are listed here to keep
 * one reference for the user rather than three.
 */
export const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: 'Space / K', action: 'Play or pause' },
  { keys: '← / →', action: 'Back or forward 10 seconds' },
  { keys: 'J / L', action: 'Back or forward 30 seconds' },
  { keys: '↑ / ↓', action: 'Volume up or down' },
  { keys: 'M', action: 'Mute' },
  { keys: 'F', action: 'Fullscreen' },
  { keys: 'I', action: 'Show or hide stream info' },
  { keys: 'Z', action: 'Cycle picture fit (fit, fill, stretch, 16:9, 4:3)' },
  { keys: '[ / ]', action: 'Slower or faster playback' },
  { keys: 'Page Up / Page Down', action: 'Previous or next channel, or episode' },
  { keys: '0–9', action: 'Type a channel number to jump to it' },
  { keys: 'Esc', action: 'Close the player or dialog' },
  { keys: 'Ctrl B', action: 'Collapse or expand the sidebar' },
  { keys: '1–9', action: 'In multi-view, move the sound to that tile' },
  { keys: '0', action: 'In multi-view, mute' }
]

/**
 * Player key bindings.
 *
 * Typing in a field must never seek the video, so anything originating in an
 * input, textarea or contenteditable is ignored — as is any combination with a
 * modifier, which belongs to the OS or the browser.
 */
export function useHotkeys(actions: HotkeyActions, enabled = true): void {
  useEffect(() => {
    if (!enabled) return

    const onKey = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey || event.altKey) return

      const target = event.target as HTMLElement | null
      if (target) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return
      }

      const handled = (): void => {
        event.preventDefault()
        event.stopPropagation()
      }

      switch (event.key) {
        case ' ':
        case 'k':
        case 'K':
          if (actions.togglePlay) {
            handled()
            actions.togglePlay()
          }
          break

        case 'ArrowLeft':
          if (actions.seek) {
            handled()
            actions.seek(-10)
          }
          break
        case 'ArrowRight':
          if (actions.seek) {
            handled()
            actions.seek(10)
          }
          break
        case 'j':
        case 'J':
          if (actions.seek) {
            handled()
            actions.seek(-30)
          }
          break
        case 'l':
        case 'L':
          if (actions.seek) {
            handled()
            actions.seek(30)
          }
          break

        case 'ArrowUp':
          if (actions.adjustVolume) {
            handled()
            actions.adjustVolume(0.05)
          }
          break
        case 'ArrowDown':
          if (actions.adjustVolume) {
            handled()
            actions.adjustVolume(-0.05)
          }
          break

        case 'm':
        case 'M':
          if (actions.toggleMute) {
            handled()
            actions.toggleMute()
          }
          break

        case 'f':
        case 'F':
          if (actions.toggleFullscreen) {
            handled()
            actions.toggleFullscreen()
          }
          break

        case 'i':
        case 'I':
          if (actions.toggleStats) {
            handled()
            actions.toggleStats()
          }
          break

        case '[':
          if (actions.stepSpeed) {
            handled()
            actions.stepSpeed(-1)
          }
          break
        case ']':
          if (actions.stepSpeed) {
            handled()
            actions.stepSpeed(1)
          }
          break

        case 'z':
        case 'Z':
          if (actions.cycleFit) {
            handled()
            actions.cycleFit()
          }
          break

        case 'PageUp':
          if (actions.previousChannel) {
            handled()
            actions.previousChannel()
          }
          break
        case 'PageDown':
          if (actions.nextChannel) {
            handled()
            actions.nextChannel()
          }
          break

        case 'Escape':
          if (actions.close) {
            handled()
            actions.close()
          }
          break

        default:
          break
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [actions, enabled])
}
