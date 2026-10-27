import { useCallback, useEffect, useState, type JSX } from 'react'
import type { Playlist, XtreamAccountInfo } from '@shared/types'
import { invoke, messageOf } from '@renderer/lib/api'
import { useAppStore } from '@renderer/store/useAppStore'
import { useT } from '@renderer/i18n'
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
  const t = useT()

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
        ? t('account.appliedSingle')
        : t(
            plan.maxConcurrentDownloads === 1 ? 'account.appliedOne' : 'account.appliedMany',
            { count: plan.maxConcurrentDownloads }
          )
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
            <strong>{t('settings.account')}</strong>
            <span>{t('account.body')}</span>
          </div>
          <button className="btn" onClick={() => void load()} disabled={loading}>
            {loading ? <span className="spinner" /> : null}
            {t(loading ? 'settings.checking' : 'settings.checkAccount')}
          </button>
        </div>
      )}

      {error && <div className="notice notice--error">{error}</div>}

      {account && (
        <>
          <div className="acctgrid">
            <Stat
              label={t('settings.connectionsLabel')}
              value={
                account.maxConnections > 0
                  ? t('account.connectionsValue', {
                      active: account.activeConnections,
                      max: account.maxConnections
                    })
                  : t('account.notStated')
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
              label={t('settings.status')}
              value={account.status}
              tone={account.status.toLowerCase() === 'active' ? 'ok' : 'bad'}
            />
            <Stat
              label={t('settings.expires')}
              value={
                account.expiresAt === null
                  ? t('common.never')
                  : new Date(account.expiresAt).toLocaleDateString()
              }
              tone={
                daysLeft === null ? 'ok' : daysLeft < 0 ? 'bad' : daysLeft <= EXPIRY_WARNING_DAYS ? 'warn' : 'ok'
              }
            />
            <Stat label={t('settings.username')} value={account.username} tone="ok" />
          </div>

          {daysLeft !== null && daysLeft < 0 && (
            <div className="notice notice--error">{t('account.expired')}</div>
          )}

          {daysLeft !== null && daysLeft >= 0 && daysLeft <= EXPIRY_WARNING_DAYS && (
            <div className="notice">
              {t(daysLeft === 1 ? 'account.expiresInOne' : 'account.expiresInMany', {
                days: daysLeft
              })}
            </div>
          )}

          {account.isTrial && <div className="notice">{t('account.trial')}</div>}

          {tight && (
            <div className="notice">{t('account.singleStream')}</div>
          )}

          {limit > 0 && (
            <div className="settings__row" style={{ border: 0, padding: 0 }}>
              <div>
                <strong>{t('account.matchLimit')}</strong>
                <span>{t('account.matchLimitBody')}</span>
              </div>
              <button className="btn btn--primary" onClick={applyLimit}>
                {t('common.apply')}
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
              {t('common.refresh')}
            </button>
          </div>
        </>
      )}

      {/* Shown whether or not the account has been checked, because it explains
          what the setting above the panel is for. */}
      {settings.singleConnection && (
        <span style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>
          {t('account.singleConnectionNote')}
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
