import { useState, type JSX } from 'react'
import type { BackupSummary, RestoreSummary } from '@shared/types'
import { invoke, messageOf } from '@renderer/lib/api'
import { useAppStore } from '@renderer/store/useAppStore'

/**
 * Backup and restore.
 *
 * Provider passwords are the one genuinely sensitive thing in the database, so
 * including them is opt-in and forces the whole file to be encrypted. A backup
 * without them is plain JSON the user can read and keep anywhere.
 */
export function BackupSection(): JSX.Element {
  const refreshPlaylists = useAppStore((s) => s.refreshPlaylists)

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
        !window.confirm('Replace removes every source, favorite and watch position first. Continue?')
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
          <strong>Include provider passwords</strong>
          <span>
            Off by default. Turning it on requires a passphrase, and the whole backup is then encrypted
            with it.
          </span>
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
          <strong>Create a backup</strong>
          <span>Sources, favorites, watch history and positions, and your settings.</span>
        </div>
        <input
          className="input"
          style={{ width: 170 }}
          type="password"
          placeholder={includeCredentials ? 'Passphrase (required)' : 'Passphrase (optional)'}
          value={passphrase}
          onChange={(event) => setPassphrase(event.target.value)}
        />
        <button
          className="btn btn--primary"
          disabled={busy || (includeCredentials && passphrase.length < 4)}
          onClick={() => void runExport()}
        >
          {busy ? <span className="spinner" /> : null}
          Export…
        </button>
      </div>

      {exported && (
        <div className="notice notice--success">
          Saved {exported.playlists} source{exported.playlists === 1 ? '' : 's'}, {exported.favorites}{' '}
          favorites and {exported.progress} watch positions
          {exported.encrypted ? ', encrypted' : ''} to {exported.filePath}
        </div>
      )}

      <div className="settings__row">
        <div>
          <strong>Restore</strong>
          <span>
            Merge keeps what you already have. Replace clears everything first. Favorites and positions
            reattach after the sources are synced.
          </span>
        </div>

        <div className="segmented">
          <button aria-pressed={mode === 'merge'} onClick={() => setMode('merge')}>
            Merge
          </button>
          <button aria-pressed={mode === 'replace'} onClick={() => setMode('replace')}>
            Replace
          </button>
        </div>

        <input
          className="input"
          style={{ width: 150 }}
          type="password"
          placeholder="Passphrase"
          value={restorePassphrase}
          onChange={(event) => setRestorePassphrase(event.target.value)}
        />
        <button className="btn" disabled={busy} onClick={() => void runImport()}>
          Open…
        </button>
      </div>

      {restored && (
        <div className="notice notice--success">
          Restored {restored.playlists} source{restored.playlists === 1 ? '' : 's'}, {restored.favorites}{' '}
          favorites, {restored.progress} watch positions.
          {restored.needCredentials.length > 0 && (
            <>
              {' '}
              Re-enter the password for: <strong>{restored.needCredentials.join(', ')}</strong>.
            </>
          )}{' '}
          Sync each source to reattach anything that did not match yet.
        </div>
      )}

      {error && <div className="notice notice--error">{error}</div>}
    </>
  )
}
