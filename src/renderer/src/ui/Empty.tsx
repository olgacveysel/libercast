import type { JSX, ReactNode } from 'react'

interface Props {
  title: string
  description?: string
  action?: ReactNode
}

export function Empty({ title, description, action }: Props): JSX.Element {
  return (
    <div className="empty">
      <div>
        <h3>{title}</h3>
        {description && <p>{description}</p>}
        {action}
      </div>
    </div>
  )
}
