import { useState, type JSX } from 'react'
import type { Download, ProgressItemType } from '@shared/types'
import { invoke, messageOf } from '@renderer/lib/api'
import { IconDownload, IconPause, IconPlay, IconTrash } from '@renderer/ui/Icon'
import { estimateRemaining, formatBytes, useDownload } from './useDownload'

interface Props {
  itemType: ProgressItemType
  itemId: number
  channelId: number
  title: string
  subtitle?: string | null
  posterUrl?: string | null
  /** Compact form for episode rows, full form for the detail page. */
  compact?: boolean
  disabled?: boolean
  onError?: (message: string) => void
}

export function DownloadButton(props: Props): JSX.Element {
  const { download } = useDownload(props.itemType, props.itemId)
  const [busy, setBusy] = useState(false)

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    try {
      await fn()
    } catch (error) {
      props.onError?.(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  const start = (): Promise<void> =>
    act(() =>
      invoke('downloads:enqueue', {
        itemType: props.itemType,
        itemId: props.itemId,
        channelId: props.channelId,
        title: props.title,
        subtitle: props.subtitle ?? null,
        posterUrl: props.posterUrl ?? null
      })
    )

  if (!download || download.status === 'cancelled' || download.status === 'failed') {
    return (
      <button
        className={props.compact ? 'btn btn--ghost' : 'btn'}
        onClick={(event) => {
          event.stopPropagation()
          void start()
        }}
        disabled={busy || props.disabled}
        title={download?.error ?? 'Download for offline viewing'}
      >
        <IconDownload size={15} />
        {!props.compact && (download?.status === 'failed' ? 'Retry download' : 'Download')}
      </button>
    )
  }

  if (download.status === 'completed') {
    return (
      <span className={`badge ${props.compact ? '' : 'badge--done'}`} title={download.filePath ?? undefined}>
        ✓ {props.compact ? '' : `Downloaded · ${formatBytes(download.bytesTotal)}`}
      </span>
    )
  }

  return (
    <div className="dlinline">
      <ProgressPill download={download} />

      {download.status === 'paused' ? (
        <button
          className="btn btn--ghost"
          onClick={(event) => {
            event.stopPropagation()
            void act(() => invoke('downloads:resume', download.id))
          }}
          disabled={busy}
          aria-label="Resume download"
        >
          <IconPlay size={14} />
        </button>
      ) : (
        <button
          className="btn btn--ghost"
          onClick={(event) => {
            event.stopPropagation()
            void act(() => invoke('downloads:pause', download.id))
          }}
          disabled={busy}
          aria-label="Pause download"
        >
          <IconPause size={14} />
        </button>
      )}

      <button
        className="btn btn--ghost"
        onClick={(event) => {
          event.stopPropagation()
          void act(() => invoke('downloads:cancel', download.id))
        }}
        disabled={busy}
        aria-label="Cancel download"
      >
        <IconTrash size={14} />
      </button>
    </div>
  )
}

function ProgressPill({ download }: { download: Download }): JSX.Element {
  const percent =
    download.bytesTotal > 0 ? Math.min(100, (download.bytesDone / download.bytesTotal) * 100) : 0

  const label =
    download.status === 'queued'
      ? 'Queued'
      : download.status === 'paused'
        ? `Paused · ${percent.toFixed(0)}%`
        : `${percent.toFixed(0)}%`

  return (
    <span className="dlpill" title={estimateRemaining(download) ?? undefined}>
      <span className="dlpill__bar" style={{ width: `${percent}%` }} />
      <span className="dlpill__text">{label}</span>
    </span>
  )
}
