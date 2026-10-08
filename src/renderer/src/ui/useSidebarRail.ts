import { useCallback } from 'react'
import { useAppStore } from '@renderer/store/useAppStore'

export interface SidebarRail {
  /** True when the sidebar is reduced to a rail of icons. */
  collapsed: boolean
  toggle: () => void
}

/**
 * The sidebar's collapsed state, shared by the layout and the toggle button.
 *
 * There is deliberately no automatic collapse at small window sizes: the window
 * has a 1024px minimum (see src/main/window.ts), so a breakpoint below that can
 * never fire, and one above it would take the choice away from the user at a
 * size where the full sidebar still fits. If that minimum is ever lowered, this
 * is the place to add it back.
 */
export function useSidebarRail(): SidebarRail {
  const collapsed = useAppStore((state) => state.settings.sidebarCollapsed)
  const updateSettings = useAppStore((state) => state.updateSettings)

  const toggle = useCallback(() => {
    void updateSettings({ sidebarCollapsed: !collapsed })
  }, [collapsed, updateSettings])

  return { collapsed, toggle }
}
