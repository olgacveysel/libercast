import { useCallback, useEffect, useState, type JSX } from 'react'
import type { EpgReminder, MediaCapabilities, Recording, RecordingStatus } from '@shared/types'
import { invoke, messageOf, subscribe } from '@renderer/lib/api'
import { formatDate, formatTime } from '@renderer/lib/format'
import { useT } from '@renderer/i18n'
import { Empty } from '@renderer/ui/Empty'
import { IconFolder, IconPlay, IconRecord, IconTrash } from '@renderer/ui/Icon'
import { VodPlayer, type VodTarget } from '@renderer/features/vod/VodPlayer'
import { DownloadsPanel } from '@renderer/features/downloads/DownloadsPanel'

interface Props {
  capabilities: MediaCapabilities | null
  onOpenSettings: () => void
}

const STATUS_LABEL: Record<RecordingStatus, string> = {
  scheduled: 'Scheduled',
  recording: 'Recording',
  completed: 'Ready',
  failed: 'Failed',
  cancelled: 'Cancelled'
}

export function Library({ capabilities, onOpenSettings }: Props): JSX.Element {
  const t = useT()
  const [tab, setTab] = useState<'recordings' | 'downloads' | 'reminders'>('recordings')
  const [reminders, setReminders] = useState<EpgReminder[]>([])
  const [recordings, setRecordings] = useState<Recording[]>([])
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState<VodTarget | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(() => {
    void invoke('recordings:list')
      .then(setRecordings)
      .catch((e) => setError(messageOf(e)))
      .finally(() => setLoading(false))
  }, [])

  const loadReminders = useCallback(() => {
    void invoke('reminders:list').then(setReminders).catch(() => setReminders([]))
  }, [])

  // Refreshed whenever the tab is opened as well as on mount: a reminder set
  // from the Guide a moment ago has to appear without a restart.
  useEffect(loadReminders, [loadReminders, tab])

  const removeReminder = async (id: number): Promise<void> => {
    setReminders((current) => current.filter((item) => item.id !== id))
    await invoke('reminders:remove', id).catch(() => loadReminders())
  }

  useEffect(() => {
    reload()
    // Recording state changes come from timers and child processes, so the main
    // process pushes updates rather than the UI polling for them.
    return subscribe('recordings:changed', (updated) => {
      setRecordings((current) => {
        const index = current.findIndex((r) => r.id === updated.id)
        if (index === -1) return [updated, ...current]
        const next = [...current]
        next[index] = updated
        return next
      })
    })
  }, [reload])

  const stop = async (id: number): Promise<void> => {
    try {
      await invoke('recordings:stop', id)
    } catch (e) {
      setError(messageOf(e))
    }
  }

  const remove = async (recording: Recording): Promise<void> => {
    const hasFile = recording.status === 'completed' && recording.filePath
    const deleteFile = hasFile
      ? window.confirm(`Delete the recorded file as well?\n\n${recording.filePath}`)
      : false

    try {
      await invoke('recordings:remove', { id: recording.id, deleteFile })
      setRecordings((current) => current.filter((r) => r.id !== recording.id))
    } catch (e) {
      setError(messageOf(e))
    }
  }

  if (capabilities && !capabilities.ffmpeg) {
    return (
      <>
        <div className="toolbar">
          <h1 className="toolbar__title">{t('library.title')}</h1>
        </div>
        <Empty
          title="Recording needs ffmpeg"
          description="No working ffmpeg was found, so recordings cannot be made or played back."
          action={
            <button className="btn btn--primary" onClick={onOpenSettings}>
              Open settings
            </button>
          }
        />
      </>
    )
  }

  return (
    <>
      <div className="toolbar">
        <h1 className="toolbar__title">{t('library.title')}</h1>

        <div className="segmented">
          <button aria-pressed={tab === 'recordings'} onClick={() => setTab('recordings')}>
            {t('library.recordings')}
          </button>
          <button aria-pressed={tab === 'downloads'} onClick={() => setTab('downloads')}>
            {t('library.downloads')}
          </button>
          <button aria-pressed={tab === 'reminders'} onClick={() => setTab('reminders')}>
            {t('library.reminders')}{reminders.length > 0 ? ` (${reminders.length})` : ''}
          </button>
        </div>

        <div className="spacer" />

        {tab === 'recordings' && (
          <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            {recordings.filter((r) => r.status === 'completed').length} ready ·{' '}
            {recordings.filter((r) => r.status === 'scheduled').length} scheduled
          </span>
        )}
      </div>

      {error && (
        <div className="notice notice--error" style={{ margin: '10px 14px 0' }}>
          {error}
        </div>
      )}

      <div style={{ overflowY: 'auto', padding: '14px 18px 32px', position: 'relative', flex: 1 }}>
        {tab === 'reminders' ? (
          <RemindersList reminders={reminders} onRemove={removeReminder} />
        ) : tab === 'downloads' ? (
          <DownloadsPanel />
        ) : recordings.length === 0 && !loading ? (
          <Empty
            title={t('library.nothingRecorded')}
            description={t('library.nothingRecordedBody')}
          />
        ) : (
          recordings.map((recording) => (
            <div key={recording.id} className="reccard">
              <span className={`recdot recdot--${recording.status}`} />

              <div className="reccard__text">
                <strong>{recording.title}</strong>
                <span>
                  {recording.channelName} · {formatDate(recording.startsAt)}{' '}
                  {formatTime(recording.startsAt)}–{formatTime(recording.endsAt)}
                  {recording.bytes > 0 && ` · ${formatSize(recording.bytes)}`}
                </span>
                {recording.error && <span style={{ color: 'var(--danger)' }}>{recording.error}</span>}
              </div>

              <span className={`badge ${recording.status === 'recording' ? 'badge--live' : ''}`}>
                {STATUS_LABEL[recording.status]}
              </span>

              {recording.status === 'completed' && (
                <>
                  <button
                    className="btn"
                    onClick={() =>
                      setPlaying({
                        itemType: 'movie',
                        itemId: recording.id,
                        channelId: recording.id,
                        title: recording.title,
                        source: { type: 'recording', id: recording.id },
                        trackProgress: false
                      })
                    }
                  >
                    <IconPlay size={14} />
                    Play
                  </button>
                  <button
                    className="btn btn--ghost"
                    onClick={() => void invoke('recordings:reveal', recording.id)}
                    aria-label={t('library.showInFolder')}
                    title={t('library.showInFolder')}
                  >
                    <IconFolder size={15} />
                  </button>
                </>
              )}

              {(recording.status === 'recording' || recording.status === 'scheduled') && (
                <button className="btn" onClick={() => void stop(recording.id)}>
                  <IconRecord size={14} filled />
                  {recording.status === 'recording' ? 'Stop' : 'Cancel'}
                </button>
              )}

              <button
                className="btn btn--danger"
                onClick={() => void remove(recording)}
                aria-label="Remove"
              >
                <IconTrash size={15} />
              </button>
            </div>
          ))
        )}

        {playing && <VodPlayer target={playing} onClose={() => setPlaying(null)} />}
      </div>
    </>
  )
}

/**
 * Upcoming reminders.
 *
 * Deliberately not merged into the recordings list: a reminder produces
 * nothing on disk and can be set on anything, so mixing it with items that
 * have a file and a size would misrepresent both.
 */
function RemindersList({
  reminders,
  onRemove
}: {
  reminders: EpgReminder[]
  onRemove: (id: number) => Promise<void>
}): JSX.Element {
  const t = useT()

  if (reminders.length === 0) {
    return (
      <Empty
        title={t('library.noReminders')}
        description={t('library.noRemindersBody')}
      />
    )
  }

  return (
    <>
      {reminders.map((reminder) => {
        const minutesAway = Math.round((reminder.startsAt - Date.now()) / 60_000)

        return (
          <div key={reminder.id} className="reccard">
            <span className="recdot recdot--scheduled" />

            <div className="reccard__text">
              <strong>{reminder.title}</strong>
              <span>
                {reminder.channelName} · {formatDate(reminder.startsAt)} {formatTime(reminder.startsAt)}–
                {formatTime(reminder.endsAt)}
                {reminder.leadMinutes > 0 && ` · alerts ${reminder.leadMinutes} min before`}
              </span>
            </div>

            <span className="badge">
              {reminder.notifiedAt
                ? t('library.notified')
                : minutesAway > 90
                  ? `in ${Math.round(minutesAway / 60)} h`
                  : minutesAway > 0
                    ? `in ${minutesAway} min`
                    : t('library.onNow')}
            </span>

            <button
              className="btn btn--danger"
              onClick={() => void onRemove(reminder.id)}
              aria-label={`Cancel the reminder for ${reminder.title}`}
            >
              <IconTrash size={15} />
            </button>
          </div>
        )
      })}
    </>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(0)} MB`
  return `${(bytes / 1_073_741_824).toFixed(2)} GB`
}
