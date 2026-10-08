import { useEffect, useRef, useState } from 'react'
import type { ChannelWithState } from '@shared/types'

/**
 * Typing a channel number to jump to it.
 *
 * The behaviour every television has: digits accumulate, the entry is shown
 * while it is being typed, and it resolves on its own after a pause — so "1"
 * followed by "0" and "1" reaches channel 101 rather than stopping at 1. Enter
 * commits early, Escape abandons it, Backspace corrects a mistyped digit.
 */
const COMMIT_AFTER_MS = 1300
const MAX_DIGITS = 5

export interface NumberEntry {
  /** What has been typed so far, or null when nothing is being entered. */
  digits: string | null
  /** The channel those digits point at, if one exists. */
  match: ChannelWithState | null
}

export function useNumberEntry(
  channels: ChannelWithState[],
  onPick: (channel: ChannelWithState) => void,
  enabled = true
): NumberEntry {
  const [digits, setDigits] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Read through refs so the key handler does not have to be rebuilt every time
  // the channel list changes, which would drop a half-typed number.
  const channelsRef = useRef(channels)
  channelsRef.current = channels
  const onPickRef = useRef(onPick)
  onPickRef.current = onPick

  useEffect(() => {
    if (!enabled) return

    const commit = (value: string): void => {
      const target = findByNumber(channelsRef.current, value)
      setDigits(null)
      if (target) onPickRef.current(target)
    }

    const onKey = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey || event.altKey) return

      const target = event.target as HTMLElement | null
      if (target) {
        const tag = target.tagName
        // Typing a number into the search box must search, not change channel.
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return
      }

      if (/^[0-9]$/.test(event.key)) {
        event.preventDefault()
        setDigits((current) => {
          const next = ((current ?? '') + event.key).slice(0, MAX_DIGITS)
          if (timer.current) clearTimeout(timer.current)
          timer.current = setTimeout(() => commit(next), COMMIT_AFTER_MS)
          return next
        })
        return
      }

      if (digits === null) return

      if (event.key === 'Enter') {
        event.preventDefault()
        if (timer.current) clearTimeout(timer.current)
        commit(digits)
      } else if (event.key === 'Escape') {
        event.preventDefault()
        // Stops Escape also closing whatever is behind: abandoning the number
        // is what the key means while one is being typed.
        event.stopPropagation()
        if (timer.current) clearTimeout(timer.current)
        setDigits(null)
      } else if (event.key === 'Backspace') {
        event.preventDefault()
        setDigits((current) => {
          const next = (current ?? '').slice(0, -1)
          return next.length === 0 ? null : next
        })
      }
    }

    // Capture, so the number can claim Escape before a dialog behind it does.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [enabled, digits])

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  return {
    digits,
    match: digits === null ? null : findByNumber(channels, digits)
  }
}

/**
 * The channel carrying that number.
 *
 * Compared numerically so "07" and "7" are the same channel, which is how
 * providers and viewers both treat leading zeroes.
 */
export function findByNumber(
  channels: ChannelWithState[],
  digits: string
): ChannelWithState | null {
  const wanted = Number(digits)
  if (!Number.isFinite(wanted)) return null
  return channels.find((channel) => channel.number === wanted) ?? null
}
