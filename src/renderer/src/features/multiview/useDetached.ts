import { useEffect, useState } from 'react'
import { invoke, subscribe } from '@renderer/lib/api'

/**
 * Which multi-view tiles are currently playing in a window of their own.
 *
 * The main process owns this list, not the grid: a detached window can be
 * closed from the window manager, the taskbar or a keyboard shortcut, none of
 * which the grid would otherwise hear about — and a tile left believing it is
 * detached would show a placeholder over a channel nothing is playing.
 */
export function useDetached(): number[] {
  const [tiles, setTiles] = useState<number[]>([])

  useEffect(() => {
    // Asked for as well as subscribed to, so a renderer that reloaded while a
    // window was open comes back with the right tiles blanked.
    void invoke('multiview:detached').then(setTiles).catch(() => undefined)
    return subscribe('multiview:detachedChanged', setTiles)
  }, [])

  return tiles
}
