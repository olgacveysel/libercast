import { useCallback, useEffect, useRef, useState, type JSX, type ReactNode } from 'react'

interface Props<T> {
  items: T[]
  itemHeight: number
  renderItem: (item: T, index: number) => ReactNode
  keyOf: (item: T, index: number) => string | number
  /** Extra rows rendered above and below the viewport to hide scroll tearing. */
  overscan?: number
  className?: string
  emptyState?: ReactNode
}

/**
 * Fixed-height windowing list.
 *
 * A provider playlist can hold 50k+ channels; rendering them all costs seconds
 * and hundreds of MB. This keeps the DOM at roughly viewport size regardless of
 * list length, without pulling in a dependency.
 */
export function VirtualList<T>({
  items,
  itemHeight,
  renderItem,
  keyOf,
  overscan = 8,
  className,
  emptyState
}: Props<T>): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)

  useEffect(() => {
    const element = containerRef.current
    if (!element) return

    const observer = new ResizeObserver(() => setViewportHeight(element.clientHeight))
    observer.observe(element)
    setViewportHeight(element.clientHeight)
    return () => observer.disconnect()
  }, [])

  // Reset scroll when the underlying list changes identity (category switch).
  useEffect(() => {
    containerRef.current?.scrollTo({ top: 0 })
    setScrollTop(0)
  }, [items])

  const onScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop)
  }, [])

  if (items.length === 0 && emptyState) {
    return (
      <div ref={containerRef} className={className} onScroll={onScroll}>
        {emptyState}
      </div>
    )
  }

  const first = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan)
  const visibleCount = Math.ceil((viewportHeight || 600) / itemHeight) + overscan * 2
  const last = Math.min(items.length, first + visibleCount)
  const slice = items.slice(first, last)

  return (
    <div ref={containerRef} className={className} onScroll={onScroll}>
      <div style={{ height: items.length * itemHeight, position: 'relative' }}>
        <div style={{ transform: `translateY(${first * itemHeight}px)` }}>
          {slice.map((item, offset) => (
            <div key={keyOf(item, first + offset)} style={{ height: itemHeight }}>
              {renderItem(item, first + offset)}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
