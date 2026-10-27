import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { parseDetached } from '@shared/detached'
import { App } from './App'
import { DetachedWindow } from './features/multiview/DetachedWindow'
import './styles/global.css'

const container = document.getElementById('root')
if (!container) throw new Error('Root element missing from index.html')

/**
 * The same bundle serves two kinds of window.
 *
 * A detached multi-view tile mounts only its own player: mounting the whole
 * application a second time would re-open every grid tile and spend a provider
 * connection on each, which is exactly what detaching is meant to avoid.
 */
const detached = parseDetached(window.location.search)

createRoot(container).render(
  <StrictMode>
    {detached ? <DetachedWindow channelId={detached.channelId} tile={detached.tile} /> : <App />}
  </StrictMode>
)
