import { safeStorage } from 'electron'
import { describeCredentialStorage, type CredentialStorage } from '@shared/credentialStorage'
import { getDb } from '@main/db'

/**
 * Provider passwords go to the OS keychain where there is one, and never to
 * the renderer.
 *
 * Where there is not one, they are still stored — an IPTV player that forgets
 * your account on every launch is not a player anyone keeps — but the
 * interface says so rather than claiming an encryption that is not happening.
 * See `describeCredentialStorage`.
 */

const KEY_PREFIX = 'credential:'

/**
 * What is actually protecting these passwords on this machine.
 *
 * `getSelectedStorageBackend` exists only on Linux; everywhere else the
 * platform answers the question on its own.
 */
export function credentialStorage(): CredentialStorage {
  let backend: string | null = null
  if (process.platform === 'linux') {
    try {
      backend = safeStorage.getSelectedStorageBackend()
    } catch {
      // Older Electron, or a backend it cannot name. Treated as unprotected,
      // which is the safe direction to be wrong in.
      backend = null
    }
  }

  return describeCredentialStorage({
    platform: process.platform,
    available: safeStorage.isEncryptionAvailable(),
    backend
  })
}

export function setPassword(playlistId: number, password: string | null): void {
  const db = getDb()
  const key = KEY_PREFIX + playlistId

  if (!password) {
    db.prepare('DELETE FROM settings WHERE key = ?').run(key)
    return
  }

  const payload = safeStorage.isEncryptionAvailable()
    ? { enc: true, value: safeStorage.encryptString(password).toString('base64') }
    : { enc: false, value: Buffer.from(password, 'utf8').toString('base64') }

  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, JSON.stringify(payload))
}

export function getPassword(playlistId: number): string | null {
  const row = getDb()
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(KEY_PREFIX + playlistId) as { value: string } | undefined

  if (!row) return null

  try {
    const payload = JSON.parse(row.value) as { enc: boolean; value: string }
    const buffer = Buffer.from(payload.value, 'base64')
    return payload.enc ? safeStorage.decryptString(buffer) : buffer.toString('utf8')
  } catch {
    return null
  }
}

export function deletePassword(playlistId: number): void {
  setPassword(playlistId, null)
}
