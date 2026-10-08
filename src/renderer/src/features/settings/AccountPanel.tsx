import { useCallback, useEffect, useState, type JSX } from 'react'
import type { Playlist, XtreamAccountInfo } from '@shared/types'
import { invoke, messageOf } from '@renderer/lib/api'
import { useAppStore } from '@renderer/store/useAppStore'
import { connectionPlan } from './connectionPlan'

interface Props {
  playlist: Playlist
}

/** Warn this far ahead of expiry, which is enough notice to renew. */
const EXPIRY_WARNING_DAYS = 14

/**
 * What the provider says about the account.
 *
 * The two numbers here answer questions the app was previously left to infer
 * from failures: how many streams the account may have open at once, and how
 * long it has left. A connection limit reached mid-film looks like a broken
 * player, and an expired subscription looks like every channel dying at once —
 * neither is guessable from the symptom, and both are stated plainly here.
 *
 * Fetched on demand rather than on a timer, because asking is itself a request
 * to the provider.
 */
export function AccountPanel({ playlist }: Props): JSX.Element | null {
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)

  const [account, setAccount] = useState<XtreamAccountInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [applied, setApplied] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setApplied(null)
    try {
      setAccount(await invoke('playlists:account', playlist.id))
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setLoading(false)
    }
  }, [playlist.id])

  useEffect(() => {
    setAccount(null)
    setError(null)
  }, [playlist.id])

  if (playlist.kind !== 'xtream') return null

  const limit = account?.maxConnections ?? 0
  const tight = limit > 0 && limit <= 1

  /**
   * Sets the connection-related settings to what the account can actually
   * support. Nothing here is guesswork — the provider stated the number.
   */
  const applyLimit = (): void => {
    const plan = connectionPlan(limit)
    if (!plan) return

    void updateSettings(plan)
    setApplied(
      plan.singleConnection
        ? 'Set to spend as few connections as possible, and one download at a time.'
        : `Set to ${plan.maxConcurrentDownloads} download${plan.maxConcurrentDownloads === 1 ? '' : 's'} at a time, leaving one for playback.`
    )
  }

  const daysLeft =
    account?.expiresAt != null
      ? Math.ceil((account.expiresAt - Date.now()) / (24 * 3600_000))
      : null

  return (
    <div
      className="plcard"
      style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10, marginBottom: 8 }}
    >
      {!account && !error && (
        <div className="settings__row" style={{ border: 0, padding: 0 }}>
          <div>
            <strong>Account</strong>
            <span>
              How many streams this account may have open at once, and when it expires. Asking is a
              request to your provider, so it is not done automatically.
            </span>
          </div>
          <button className="btn" onClick={() => void load()} disabled={loading}>
            {loading ? <span className="spinner" /> : null}
            {loading ? 'Checking…' : 'Check account'}
          </button>
        </div>
      )}

      {error && <div className="notice notice--error">{error}</div>}

      {account && (
        <>
          <div className="acctgrid">
            <Stat
              label="Connections"
              value={
                account.maxConnections > 0
                  ? `${account.activeConnections} of ${account.maxConnections}`
                  : 'Not stated'
              }
              tone={
                account.maxConnections > 0 && account.activeConnections >= account.maxConnections
                  ? 'bad'
                  : tight
                    ? 'warn'
                    : 'ok'
              }
            />
            <Stat
              label="Status"
              value={account.status}
              tone={account.status.toLowerCase() === 'active' ? 'ok' : 'bad'}
            />
            <Stat
              label="Expires"
              value={
                account.expiresAt === null
                  ? 'Never'
                  : new Date(account.expiresAt).toLocaleDateString()
              }
              tone={
                daysLeft === null ? 'ok' : daysLeft < 0 ? 'bad' : daysLeft <= EXPIRY_WARNING_DAYS ? 'warn' : 'ok'
              }
            />
            <Stat label="Username" value={account.username} tone="ok" />
          </div>

          {daysLeft !== null && daysLeft < 0 && (
            <div className="notice notice--error">
              This subscription expired. Every channel will fail until it is renewed — which looks
              like a broken app rather than an expired account.
            </div>
          )}

          {daysLeft !== null && daysLeft >= 0 && daysLeft <= EXPIRY_WARNING_DAYS && (
            <div className="notice">
              Expires in {daysLeft} day{daysLeft === 1 ? '' : 's'}.
            </div>
          )}

          {account.isTrial && <div className="notice">This is a trial account.</div>}

          {tight && (
            <div className="notice">
              This account allows a single stream at a time. Anything else using it — another device,
              a download, a recording — will stop playback here.
            </div>
          )}

          {limit > 0 && (
            <div className="settings__row" style={{ border: 0, padding: 0 }}>
              <div>
                <strong>Match the app to this limit</strong>
                <span>
                  Sets how many downloads run at once and whether to play live channels without
                  identifying them first, from the number your provider just reported.
                </span>
              </div>
              <button className="btn btn--primary" onClick={applyLimit}>
                Apply
              </button>
            </div>
          )}

          {applied && <div className="notice notice--success">{applied}</div>}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 11.5, color: 'var(--text-dim)', flex: 1 }}>
              {account.serverUrl}
              {account.timezone ? ` · ${account.timezone}` : ''}
            </span>
            <button className="btn btn--ghost" onClick={() => void load()} disabled={loading}>
              {loading ? <span className="spinner" /> : null}
              Refresh
            </button>
          </div>
        </>
      )}

      {/* Shown whether or not the account has been checked, because it explains
          what the setting above the panel is for. */}
      {settings.singleConnection && (
        <span style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>
          The app is currently set to spend as few connections as possible.
        </span>
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  tone
}: {
  label: string
  value: string
  tone: 'ok' | 'warn' | 'bad'
}): JSX.Element {
  return (
    <div className={`acctstat acctstat--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}
