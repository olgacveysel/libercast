import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react'
import type { MediaTrack } from '@shared/types'
import { useT } from '@renderer/i18n'

interface Props {
  label: string
  icon: ReactNode
  tracks: MediaTrack[]
  selected: number | null
  /** Adds an "Off" entry, used for subtitles. */
  allowNone?: boolean
  disabled?: boolean
  onSelect: (index: number | null) => void
  /** Shown under the list, e.g. a warning that switching restarts the stream. */
  note?: string
  /** Name of a subtitle file the user opened; shown as the active entry. */
  externalLabel?: string | null
  onOpenFile?: () => void
  onClearExternal?: () => void
  /** Seconds the external file is shifted by, and its control. */
  offsetSecs?: number
  onOffsetChange?: (seconds: number) => void
}

/**
 * Audio and subtitle picker.
 *
 * Deliberately not a native `<select>`: track labels run long ("English
 * (Director's Commentary, 5.1)") and the selected item needs a check mark
 * rather than truncated text in a control bar.
 */
export function TrackMenu({
  label,
  icon,
  tracks,
  selected,
  allowNone,
  disabled,
  onSelect,
  note,
  externalLabel,
  onOpenFile,
  onClearExternal,
  offsetSecs = 0,
  onOffsetChange
}: Props): JSX.Element | null {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const t = useT()

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Nothing to choose between, so the control would only be noise.
  if (tracks.length === 0 && !allowNone) return null
  if (tracks.length <= 1 && !allowNone) return null

  const current = selected === null ? null : tracks.find((track) => track.index === selected) ?? null
  const currentLabel = externalLabel ?? (current ? shortLabel(current) : t('common.off'))

  return (
    <div className="trackmenu" ref={containerRef}>
      <button
        className={`btn btn--ghost ${open ? 'btn--on' : ''}`}
        onClick={() => setOpen((value) => !value)}
        disabled={disabled || (tracks.length === 0 && !allowNone)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${label}: ${externalLabel ?? current?.label ?? t('common.off')}`}
      >
        {icon}
        <span className="trackmenu__current">{currentLabel}</span>
      </button>

      {open && (
        <div className="trackmenu__pop" role="menu">
          <div className="trackmenu__head">{label}</div>

          {allowNone && (
            <button
              className={`trackmenu__item ${selected === null && !externalLabel ? 'trackmenu__item--on' : ''}`}
              role="menuitemradio"
              aria-checked={selected === null && !externalLabel}
              onClick={() => {
                onClearExternal?.()
                onSelect(null)
                setOpen(false)
              }}
            >
              <span className="trackmenu__tick">{selected === null && !externalLabel ? '✓' : ''}</span>
              {t('common.off')}
            </button>
          )}

          {externalLabel && (
            <button
              className="trackmenu__item trackmenu__item--on"
              role="menuitemradio"
              aria-checked
              onClick={() => setOpen(false)}
            >
              <span className="trackmenu__tick">✓</span>
              <span className="trackmenu__label">{externalLabel}</span>
              <span className="trackmenu__codec">{t('tracks.file')}</span>
            </button>
          )}

          {tracks.map((track) => (
            <button
              key={track.index}
              className={`trackmenu__item ${selected === track.index ? 'trackmenu__item--on' : ''}`}
              role="menuitemradio"
              aria-checked={selected === track.index}
              onClick={() => {
                onClearExternal?.()
                onSelect(track.index)
                setOpen(false)
              }}
            >
              <span className="trackmenu__tick">{selected === track.index && !externalLabel ? '✓' : ''}</span>
              <span className="trackmenu__label">{track.label}</span>
              <span className="trackmenu__codec">{track.codec}</span>
            </button>
          ))}

          {tracks.length === 0 && !externalLabel && (
            <div className="trackmenu__empty">{t('tracks.noSubtitleTracks')}</div>
          )}

          {onOpenFile && (
            <>
              <button
                className="trackmenu__item"
                onClick={() => {
                  onOpenFile()
                  setOpen(false)
                }}
              >
                <span className="trackmenu__tick" />
                <span className="trackmenu__label">{t('tracks.openFile')}</span>
              </button>

              {externalLabel && onOffsetChange && (
                <div className="trackmenu__offset">
                  <span>{t('tracks.timing')}</span>
                  <button className="btn btn--ghost" onClick={() => onOffsetChange(offsetSecs - 0.5)}>
                    −0.5s
                  </button>
                  <strong>
                    {offsetSecs > 0 ? '+' : ''}
                    {offsetSecs.toFixed(1)}s
                  </strong>
                  <button className="btn btn--ghost" onClick={() => onOffsetChange(offsetSecs + 0.5)}>
                    +0.5s
                  </button>
                </div>
              )}
            </>
          )}

          {note && <div className="trackmenu__note">{note}</div>}
        </div>
      )}
    </div>
  )
}

/** The control bar has little room, so only the language survives. */
function shortLabel(track: MediaTrack): string {
  return track.label.split(' (')[0] ?? track.label
}
