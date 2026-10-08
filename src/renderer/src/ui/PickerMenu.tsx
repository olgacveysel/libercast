import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react'

export interface PickerOption<T> {
  value: T
  label: string
  /** Shown under the label. Explains what the option actually does. */
  hint?: string
}

interface Props<T> {
  label: string
  icon?: ReactNode
  /** Shown on the button itself, e.g. "1.5×". */
  current: string
  options: PickerOption<T>[]
  selected: T
  onSelect: (value: T) => void
  /** Rendered below the options — a slider, a reset button. */
  footer?: ReactNode
  title?: string
}

/**
 * A small popover list of mutually exclusive choices.
 *
 * The same shape as the audio and subtitle pickers, deliberately: playback
 * speed and picture fit sit next to those in the transport bar, and a control
 * that looks different for no reason reads as a different kind of thing.
 */
export function PickerMenu<T extends string | number>({
  label,
  icon,
  current,
  options,
  selected,
  onSelect,
  footer,
  title
}: Props<T>): JSX.Element {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

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

  return (
    <div className="trackmenu" ref={containerRef}>
      <button
        className={`btn btn--ghost ${open ? 'btn--on' : ''}`}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={title ?? `${label}: ${current}`}
      >
        {icon}
        <span className="trackmenu__current">{current}</span>
      </button>

      {open && (
        <div className="trackmenu__pop" role="menu">
          <div className="trackmenu__head">{label}</div>

          {options.map((option) => (
            <button
              key={String(option.value)}
              className={`trackmenu__item ${option.value === selected ? 'trackmenu__item--on' : ''}`}
              role="menuitemradio"
              aria-checked={option.value === selected}
              onClick={() => {
                onSelect(option.value)
                setOpen(false)
              }}
            >
              <span className="trackmenu__tick">{option.value === selected ? '✓' : ''}</span>
              <span className="trackmenu__label">
                {option.label}
                {option.hint && <small className="trackmenu__hint">{option.hint}</small>}
              </span>
            </button>
          ))}

          {footer}
        </div>
      )}
    </div>
  )
}
