import { useCallback, useEffect, useState, type JSX } from 'react'
import type { Download } from '@shared/types'
import { invoke, messageOf, subscribe } from '@renderer/lib/api'
import { useT, type TranslationKey } from '@renderer/i18n'
import { Empty } from '@renderer/ui/Empty'
import { IconFolder, IconPause, IconPlay, IconTrash } from '@renderer/ui/Icon'
import { VodPlayer, type VodTarget } from '@renderer/features/vod/VodPlayer'
import { estimateRemaining, formatBytes, formatSpeed } from './useDownload'

const STATUS_LABEL: Record<Download['status'], TranslationKey> = {
  queued: 'downloads.queued',
  downloading: 'downloads.downloading',
  paused: 'downloads.paused',
  completed: 'common.ready',
  failed: 'common.failed',
  cancelled: 'common.cancelled'
}

export function DownloadsPanel(): JSX.Element {
  const t = useT()
  const [downloads, setDownloads] = useState<Download[]>([])
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState<VodTarget | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(() => {
    void invoke('downloads:list')
      .then(setDownloads)
      .catch((e) => setError(messageOf(e)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    reload()
    return subscribe('downloads:changed', (updated) => {
      setDownloads((current) => {
        const index = current.findIndex((d) => d.id === updated.id)
        if (index === -1) return [updated, ...current]
        const next = [...current]
        next[index] = updated
        return next
      })
    })
  }, [reload])

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    try {
      await fn()
    } catch (e) {
      setError(messageOf(e))
    }
  }

  const remove = async (download: Download): Promise<void> => {
    const hasFile = download.filePath && download.bytesDone > 0
    const deleteFile = hasFile
      ? window.confirm(`${t('downloads.deleteFile')}\n\n${download.filePath}`)
      : false

    await act(() => invoke('downloads:remove', { id: download.id, deleteFile }))
    setDownloads((current) => current.filter((d) => d.id !== download.id))
  }

  if (downloads.length === 0 && !loading) {
    return (
      <Empty title={t('downloads.emptyTitle')} description={t('downloads.emptyBody')} />
    )
  }

  return (
    <>
      {error && (
        <div className="notice notice--error" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}

      {downloads.map((download) => {
        const percent =
          download.bytesTotal > 0 ? Math.min(100, (download.bytesDone / download.bytesTotal) * 100) : 0
        const active = download.status === 'downloading'

        return (
          <div key={download.id} className="reccard">
            <span className={`recdot recdot--${dotClass(download.status)}`} />

            {download.posterUrl ? (
              <img className="dlcard__art" src={download.posterUrl} alt="" loading="lazy" />
            ) : (
              <span className="dlcard__art" />
            )}

            <div className="reccard__text">
              <strong>{download.title}</strong>
              {download.subtitle && <span>{download.subtitle}</span>}

              {download.status !== 'completed' && (
                <span className="progressbar" style={{ maxWidth: 320 }}>
                  <span className="progressbar__fill" style={{ width: `${percent}%` }} />
                </span>
              )}

              <span>
                {download.status === 'completed'
                  ? formatBytes(download.bytesTotal)
                  : download.bytesTotal > 0
                    ? t('downloads.ofTotal', {
                        done: formatBytes(download.bytesDone),
                        total: formatBytes(download.bytesTotal)
                      })
                    : formatBytes(download.bytesDone)}
                {active && download.speed ? ` · ${formatSpeed(download.speed)}` : ''}
                {active && estimateRemaining(download) ? ` · ${estimateRemaining(download)}` : ''}
              </span>

              {download.error && <span style={{ color: 'var(--danger)' }}>{download.error}</span>}
            </div>

            <span className={`badge ${active ? 'badge--live' : ''}`}>{t(STATUS_LABEL[download.status])}</span>

            {download.status === 'completed' && (
              <>
                <button
                  className="btn"
                  onClick={() =>
                    setPlaying({
                      itemType: download.itemType,
                      itemId: download.itemId,
                      channelId: download.channelId ?? download.id,
                      title: [download.title, download.subtitle].filter(Boolean).join(' — '),
                      source: { type: 'download', id: download.id }
                    })
                  }
                >
                  <IconPlay size={14} />
                  {t('common.play')}
                </button>
                <button
                  className="btn btn--ghost"
                  onClick={() => void invoke('downloads:reveal', download.id)}
                  aria-label={t('library.showInFolder')}
                  title={t('library.showInFolder')}
                >
                  <IconFolder size={15} />
                </button>
              </>
            )}

            {(download.status === 'downloading' || download.status === 'queued') && (
              <button className="btn" onClick={() => void act(() => invoke('downloads:pause', download.id))}>
                <IconPause size={14} />
                {t('common.pause')}
              </button>
            )}

            {(download.status === 'paused' || download.status === 'failed') && (
              <button className="btn" onClick={() => void act(() => invoke('downloads:resume', download.id))}>
                <IconPlay size={14} />
                {t('downloads.resume')}
              </button>
            )}

            <button className="btn btn--danger" onClick={() => void remove(download)} aria-label={t('common.remove')}>
              <IconTrash size={15} />
            </button>
          </div>
        )
      })}

      {playing && <VodPlayer target={{ ...playing, trackProgress: true }} onClose={() => setPlaying(null)} />}
    </>
  )
}

function dotClass(status: Download['status']): string {
  if (status === 'downloading') return 'recording'
  if (status === 'queued' || status === 'paused') return 'scheduled'
  if (status === 'completed') return 'completed'
  return 'failed'
}
