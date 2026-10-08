import { safeStorage } from 'electron'
import { getDb } from '@main/db'

/**
 * Provider passwords are encrypted with the OS keychain (DPAPI on Windows) and
 * only the ciphertext is written to disk. They are never sent to the renderer.
 */

const KEY_PREFIX = 'credential:'

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
