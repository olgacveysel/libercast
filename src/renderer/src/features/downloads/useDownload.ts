import { useCallback, useEffect, useState } from 'react'
import type { Download, ProgressItemType } from '@shared/types'
import { invoke, subscribe } from '@renderer/lib/api'

/**
 * Tracks the download state of one title.
 *
 * Progress arrives as a push from the main process rather than by polling,
 * because it is produced by a stream, not by anything the UI does.
 */
export function useDownload(itemType: ProgressItemType, itemId: number | null): {
  download: Download | null
  refresh: () => void
} {
  const [download, setDownload] = useState<Download | null>(null)

  const refresh = useCallback(() => {
    if (itemId === null) {
      setDownload(null)
      return
    }
    void invoke('downloads:forItem', { itemType, itemId })
      .then(setDownload)
      .catch(() => setDownload(null))
  }, [itemType, itemId])

  useEffect(() => {
    refresh()
    return subscribe('downloads:changed', (updated) => {
      if (updated.itemType === itemType && updated.itemId === itemId) setDownload(updated)
    })
  }, [refresh, itemType, itemId])

  return { download, refresh }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(0)} MB`
  return `${(bytes / 1_073_741_824).toFixed(2)} GB`
}

export function formatSpeed(bytesPerSecond: number | undefined): string {
  if (!bytesPerSecond || bytesPerSecond <= 0) return ''
  return `${formatBytes(bytesPerSecond)}/s`
}

/** Remaining time from the current rate. Null while it cannot be estimated. */
export function estimateRemaining(download: Download): string | null {
  if (!download.speed || download.speed <= 0 || download.bytesTotal <= 0) return null
  const remaining = download.bytesTotal - download.bytesDone
  if (remaining <= 0) return null

  const seconds = Math.round(remaining / download.speed)
  if (seconds < 60) return `${seconds}s left`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m left`
  return `${(seconds / 3600).toFixed(1)}h left`
}
