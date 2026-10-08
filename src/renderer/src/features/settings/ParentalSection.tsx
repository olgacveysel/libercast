import { useCallback, useEffect, useState, type JSX } from 'react'
import type { Category, ParentalStatus } from '@shared/types'
import { invoke, messageOf } from '@renderer/lib/api'
import { useAppStore } from '@renderer/store/useAppStore'

/**
 * Parental controls.
 *
 * Everything here is gated behind the PIN once one is set — including this
 * screen's own controls, since a lock a child can simply switch off is not a
 * lock at all.
 */
export function ParentalSection(): JSX.Element {
  const { activePlaylistId, refreshCapabilities } = useAppStore()

  const [status, setStatus] = useState<ParentalStatus | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [pin, setPin] = useState('')
  const [currentPin, setCurrentPin] = useState('')
  const [unlockPin, setUnlockPin] = useState('')
  const [keyword, setKeyword] = useState('')

  const reload = useCallback(() => {
    void invoke('parental:status').then(setStatus).catch((e) => setError(messageOf(e)))
  }, [])

  useEffect(reload, [reload])

  useEffect(() => {
    if (activePlaylistId === null) return
    void Promise.all([
      invoke('categories:list', { playlistId: activePlaylistId, kind: 'live' }),
      invoke('categories:list', { playlistId: activePlaylistId, kind: 'movie' })
    ])
      .then(([live, movies]) => setCategories([...live, ...movies]))
      .catch(() => setCategories([]))
  }, [activePlaylistId, status?.unlocked])

  const act = async (fn: () => Promise<unknown>, message?: string): Promise<void> => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await fn()
      if (message) setNotice(message)
      reload()
      void refreshCapabilities()
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(false)
    }
  }

  if (!status) return <p style={{ color: 'var(--text-dim)', fontSize: 12.5 }}>Loading…</p>

  /* ---------------- no PIN yet ---------------- */

  if (!status.enabled) {
    return (
      <>
        <div className="settings__row">
          <div>
            <strong>Set a PIN</strong>
            <span>
              4 to 8 digits. Locked categories, matching titles and adult content are hidden from every
              screen — including search and Continue Watching — until it is entered.
            </span>
          </div>
          <input
            className="input"
            style={{ width: 120 }}
            type="password"
            inputMode="numeric"
            placeholder="New PIN"
            value={pin}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 8))}
          />
          <button
            className="btn btn--primary"
            disabled={busy || pin.length < 4}
            onClick={() =>
              void act(() => invoke('parental:setPin', { currentPin: null, newPin: pin }), 'PIN set.').then(
                () => setPin('')
              )
            }
          >
            Turn on
          </button>
        </div>

        {error && <div className="notice notice--error">{error}</div>}
        {notice && <div className="notice notice--success">{notice}</div>}
      </>
    )
  }

  /* ---------------- locked ---------------- */

  if (!status.unlocked) {
    return (
      <>
        <div className="settings__row">
          <div>
            <strong>Locked</strong>
            <span>Enter your PIN to change these settings or reveal hidden content.</span>
          </div>
          <input
            className="input"
            style={{ width: 120 }}
            type="password"
            inputMode="numeric"
            placeholder="PIN"
            value={unlockPin}
            onChange={(event) => setUnlockPin(event.target.value.replace(/\D/g, '').slice(0, 8))}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void unlock()
            }}
          />
          <button className="btn btn--primary" disabled={busy || unlockPin.length < 4} onClick={() => void unlock()}>
            Unlock
          </button>
        </div>

        {error && <div className="notice notice--error">{error}</div>}
      </>
    )
  }

  /* ---------------- unlocked ---------------- */

  const toggleCategory = (id: number): void => {
    const next = status.lockedCategoryIds.includes(id)
      ? status.lockedCategoryIds.filter((value) => value !== id)
      : [...status.lockedCategoryIds, id]

    void act(() => invoke('parental:setRules', { ...status, lockedCategoryIds: next }))
  }

  const addKeyword = (): void => {
    const word = keyword.trim().toLowerCase()
    if (word.length < 2 || status.keywords.includes(word)) return
    void act(() => invoke('parental:setRules', { ...status, keywords: [...status.keywords, word] }))
    setKeyword('')
  }

  return (
    <>
      <div className="notice notice--success" style={{ marginBottom: 12 }}>
        Unlocked. It re-locks {status.autoLockMinutes > 0 ? `after ${status.autoLockMinutes} minutes idle` : 'when the app closes'}.
      </div>

      <div className="settings__row">
        <div>
          <strong>Hide adult content</strong>
          <span>Applies to anything the provider or the playlist parser flagged.</span>
        </div>
        <input
          type="checkbox"
          checked={status.lockAdult}
          onChange={(event) =>
            void act(() => invoke('parental:setRules', { ...status, lockAdult: event.target.checked }))
          }
        />
      </div>

      <div className="settings__row">
        <div>
          <strong>Auto-lock after</strong>
          <span>Minutes of inactivity before the PIN is needed again. 0 stays unlocked.</span>
        </div>
        <select
          className="input"
          style={{ width: 110 }}
          value={status.autoLockMinutes}
          onChange={(event) =>
            void act(() =>
              invoke('parental:setRules', { ...status, autoLockMinutes: Number(event.target.value) })
            )
          }
        >
          {[0, 5, 15, 30, 60, 120].map((value) => (
            <option key={value} value={value}>
              {value === 0 ? 'Never' : `${value} min`}
            </option>
          ))}
        </select>
      </div>

      <div className="settings__row" style={{ alignItems: 'flex-start' }}>
        <div>
          <strong>Blocked words</strong>
          <span>Titles containing any of these are hidden while locked.</span>
        </div>
        <div style={{ display: 'grid', gap: 8, justifyItems: 'end' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              className="input"
              style={{ width: 150 }}
              placeholder="Add a word"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') addKeyword()
              }}
            />
            <button className="btn" onClick={addKeyword} disabled={busy || keyword.trim().length < 2}>
              Add
            </button>
          </div>

          {status.keywords.length > 0 && (
            <div className="langpicker">
              {status.keywords.map((word) => (
                <button
                  key={word}
                  className="langchip langchip--on"
                  onClick={() =>
                    void act(() =>
                      invoke('parental:setRules', {
                        ...status,
                        keywords: status.keywords.filter((value) => value !== word)
                      })
                    )
                  }
                  title="Remove"
                >
                  {word} ✕
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="settings__row" style={{ alignItems: 'flex-start' }}>
        <div>
          <strong>Locked categories</strong>
          <span>
            {categories.length === 0
              ? 'Sync a source to list its categories.'
              : `${status.lockedCategoryIds.length} of ${categories.length} locked.`}
          </span>
        </div>
        <div className="catlock">
          {categories.map((category) => (
            <label key={category.id} className="catlock__item">
              <input
                type="checkbox"
                checked={status.lockedCategoryIds.includes(category.id)}
                onChange={() => toggleCategory(category.id)}
              />
              <span>{category.name}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="settings__row">
        <div>
          <strong>Change or remove the PIN</strong>
          <span>Removing it makes all hidden content visible again.</span>
        </div>
        <input
          className="input"
          style={{ width: 100 }}
          type="password"
          inputMode="numeric"
          placeholder="Current"
          value={currentPin}
          onChange={(event) => setCurrentPin(event.target.value.replace(/\D/g, '').slice(0, 8))}
        />
        <input
          className="input"
          style={{ width: 100 }}
          type="password"
          inputMode="numeric"
          placeholder="New"
          value={pin}
          onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 8))}
        />
        <button
          className="btn"
          disabled={busy || currentPin.length < 4 || pin.length < 4}
          onClick={() =>
            void act(() => invoke('parental:setPin', { currentPin, newPin: pin }), 'PIN changed.').then(() => {
              setPin('')
              setCurrentPin('')
            })
          }
        >
          Change
        </button>
        <button
          className="btn btn--danger"
          disabled={busy || currentPin.length < 4}
          onClick={() =>
            void act(() => invoke('parental:disable', currentPin), 'Parental controls turned off.').then(
              () => setCurrentPin('')
            )
          }
        >
          Turn off
        </button>
      </div>

      <div className="settings__row">
        <div>
          <strong>Lock now</strong>
          <span>Hides the locked content again without waiting for the timer.</span>
        </div>
        <button className="btn" onClick={() => void act(() => invoke('parental:lock'), 'Locked.')}>
          Lock
        </button>
      </div>

      {error && <div className="notice notice--error">{error}</div>}
      {notice && <div className="notice notice--success">{notice}</div>}
    </>
  )

  async function unlock(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const ok = await invoke('parental:unlock', unlockPin)
      if (!ok) setError('That PIN is not correct.')
      else setUnlockPin('')
      reload()
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(false)
    }
  }
}
