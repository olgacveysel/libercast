import { useState, type JSX } from 'react'
import type { BackupSummary, RestoreSummary } from '@shared/types'
import { invoke, messageOf } from '@renderer/lib/api'
import { useAppStore } from '@renderer/store/useAppStore'
import { useT } from '@renderer/i18n'

/**
 * Backup and restore.
 *
 * Provider passwords are the one genuinely sensitive thing in the database, so
 * including them is opt-in and forces the whole file to be encrypted. A backup
 * without them is plain JSON the user can read and keep anywhere.
 */
export function BackupSection(): JSX.Element {
  const refreshPlaylists = useAppStore((s) => s.refreshPlaylists)
  const t = useT()

  const [includeCredentials, setIncludeCredentials] = useState(false)
  const [passphrase, setPassphrase] = useState('')
  const [restorePassphrase, setRestorePassphrase] = useState('')
  const [mode, setMode] = useState<'merge' | 'replace'>('merge')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exported, setExported] = useState<BackupSummary | null>(null)
  const [restored, setRestored] = useState<RestoreSummary | null>(null)

  const runExport = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setExported(null)
    try {
      const summary = await invoke('backup:export', {
        includeCredentials,
        passphrase: passphrase || undefined
      })
      setExported(summary)
      setPassphrase('')
    } catch (e) {
      const message = messageOf(e)
      if (message !== 'Cancelled') setError(message)
    } finally {
      setBusy(false)
    }
  }

  const runImport = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setRestored(null)
    try {
      const filePath = await invoke('backup:pickFile')
      if (!filePath) return

      if (
        mode === 'replace' &&
        !window.confirm(t('backup.replaceConfirm'))
      ) {
        return
      }

      const summary = await invoke('backup:import', {
        filePath,
        passphrase: restorePassphrase || undefined,
        mode
      })
      setRestored(summary)
      setRestorePassphrase('')
      await refreshPlaylists()
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="settings__row">
        <div>
          <strong>{t('backup.includePasswords')}</strong>
          <span>{t('backup.includePasswordsBody')}</span>
        </div>
        <input
          type="checkbox"
          checked={includeCredentials}
          onChange={(event) => {
            setIncludeCredentials(event.target.checked)
            if (!event.target.checked) setPassphrase('')
          }}
        />
      </div>

      <div className="settings__row">
        <div>
          <strong>{t('backup.create')}</strong>
          <span>{t('backup.createBody')}</span>
        </div>
        <input
          className="input"
          style={{ width: 170 }}
          type="password"
          placeholder={t(includeCredentials ? 'backup.passphraseRequired' : 'backup.passphraseOptional')}
          value={passphrase}
          onChange={(event) => setPassphrase(event.target.value)}
        />
        <button
          className="btn btn--primary"
          disabled={busy || (includeCredentials && passphrase.length < 4)}
          onClick={() => void runExport()}
        >
          {busy ? <span className="spinner" /> : null}
          {t('backup.export')}
        </button>
      </div>

      {exported && (
        <div className="notice notice--success">
          {t(
            exported.playlists === 1
              ? exported.encrypted
                ? 'backup.savedOneEncrypted'
                : 'backup.savedOne'
              : exported.encrypted
                ? 'backup.savedManyEncrypted'
                : 'backup.savedMany',
            {
              playlists: exported.playlists,
              favorites: exported.favorites,
              progress: exported.progress,
              path: exported.filePath
            }
          )}
        </div>
      )}

      <div className="settings__row">
        <div>
          <strong>{t('backup.restore')}</strong>
          <span>{t('backup.restoreBody')}</span>
        </div>

        <div className="segmented">
          <button aria-pressed={mode === 'merge'} onClick={() => setMode('merge')}>
            {t('backup.merge')}
          </button>
          <button aria-pressed={mode === 'replace'} onClick={() => setMode('replace')}>
            {t('backup.replace')}
          </button>
        </div>

        <input
          className="input"
          style={{ width: 150 }}
          type="password"
          placeholder={t('backup.passphrase')}
          value={restorePassphrase}
          onChange={(event) => setRestorePassphrase(event.target.value)}
        />
        <button className="btn" disabled={busy} onClick={() => void runImport()}>
          {t('backup.open')}
        </button>
      </div>

      {restored && (
        <div className="notice notice--success">
          {t(restored.playlists === 1 ? 'backup.restoredOne' : 'backup.restoredMany', {
            playlists: restored.playlists,
            favorites: restored.favorites,
            progress: restored.progress
          })}
          {restored.needCredentials.length > 0 && (
            <>
              {' '}
              {t('backup.reenterPassword')} <strong>{restored.needCredentials.join(', ')}</strong>.
            </>
          )}{' '}
          {t('backup.syncToReattach')}
        </div>
      )}

      {error && <div className="notice notice--error">{error}</div>}
    </>
  )
}
