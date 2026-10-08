import type { JSX } from 'react'

export function ListSkeleton({ rows = 8 }: { rows?: number }): JSX.Element {
  return (
    <div style={{ paddingTop: 6 }}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ opacity: 1 - i * 0.08 }} />
      ))}
    </div>
  )
}
