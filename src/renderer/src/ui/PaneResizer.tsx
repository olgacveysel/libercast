import { useRef, type JSX, type PointerEvent as ReactPointerEvent, type KeyboardEvent } from 'react'
import { clampPaneWidth, PANE_WIDTHS, type PaneKind } from '@shared/panes'

interface Props {
  kind: PaneKind
  /** The pane's width now, so the keyboard steps start from the right place. */
  width: number
  label: string
  /** Called continuously while dragging. Cheap — it only moves a CSS variable. */
  onResize: (width: number) => void
  /** Called once the gesture ends, which is when the width is worth storing. */
  onCommit: (width: number) => void
  onDragStart: () => void
  onDragEnd: () => void
}

/** Arrow keys move by this; held with shift, by the larger step. */
const STEP = 16
const BIG_STEP = 64

/**
 * The divider between two Live TV lists, dragged with the mouse.
 *
 * It sits inside the pane it resizes rather than between the two, because the
 * panes are grid columns and a third element between them would be a third
 * column. Being inside also means `.pane`'s `overflow: hidden` keeps it from
 * spilling over the picture when the lists fold to zero.
 *
 * The width is applied by the parent to a CSS variable during the drag and
 * written to settings only on release: a pointermove fires on every frame,
 * and a database write per frame would be a write per pixel.
 */
export function PaneResizer({
  kind,
  width,
  label,
  onResize,
  onCommit,
  onDragStart,
  onDragEnd
}: Props): JSX.Element {
  const drag = useRef<{ x: number; from: number; at: number } | null>(null)

  /*
    How much room the lists and the picture have to share. Measured from the
    grid rather than the window so that the sidebar, which is outside it and
    folds on its own, is already accounted for.
  */
  const room = (el: HTMLElement): number =>
    el.closest('.live')?.getBoundingClientRect().width ?? window.innerWidth

  function begin(e: ReactPointerEvent<HTMLButtonElement>): void {
    // Only the primary button, and never a second pointer mid-drag.
    if (e.button !== 0 || drag.current) return
    e.preventDefault()
    /*
      Capture keeps the moves coming while the pointer is over the player or
      off the window, which is most of a real drag. It throws when there is no
      live pointer behind the event — a synthesised one, as the harness sends
      — and the drag works without it there, because those are dispatched at
      this element anyway.
    */
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // No capture; the gesture still tracks while the pointer is over us.
    }
    drag.current = { x: e.clientX, from: width, at: width }
    onDragStart()
  }

  function move(e: ReactPointerEvent<HTMLButtonElement>): void {
    const state = drag.current
    if (!state) return
    state.at = clampPaneWidth(kind, state.from + (e.clientX - state.x), room(e.currentTarget))
    onResize(state.at)
  }

  function end(e: ReactPointerEvent<HTMLButtonElement>): void {
    const state = drag.current
    if (!state) return
    drag.current = null
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }
    } catch {
      // Never captured, or the pointer is already gone. Nothing to release.
    }
    onDragEnd()
    // Unchanged widths are not worth a write; a click that never moved is one.
    if (state.at !== state.from) onCommit(state.at)
  }

  function keys(e: KeyboardEvent<HTMLButtonElement>): void {
    const step = e.shiftKey ? BIG_STEP : STEP
    const space = room(e.currentTarget)
    let next: number | null = null
    if (e.key === 'ArrowLeft') next = clampPaneWidth(kind, width - step, space)
    else if (e.key === 'ArrowRight') next = clampPaneWidth(kind, width + step, space)
    else if (e.key === 'Home' || e.key === 'Enter') {
      next = clampPaneWidth(kind, PANE_WIDTHS[kind].preset, space)
    }
    if (next === null) return
    e.preventDefault()
    e.stopPropagation()
    onResize(next)
    onCommit(next)
  }

  const { min, max } = PANE_WIDTHS[kind]
  return (
    <button
      type="button"
      className="paneresize"
      // A separator rather than a button to assistive technology: it reports a
      // value and a range, which is what this actually is. The element stays a
      // button so that it is focusable and keyboard-operable for free.
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(width)}
      aria-valuemin={min}
      aria-valuemax={max}
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={keys}
      onDoubleClick={(e) => {
        const next = clampPaneWidth(kind, PANE_WIDTHS[kind].preset, room(e.currentTarget))
        onResize(next)
        onCommit(next)
      }}
    />
  )
}
