import { DEFAULT_SETTINGS, failoverMode, type AppSettings } from '@shared/types'
import { getDb } from '../index'

/**
 * The keys that are actually settings.
 *
 * The `settings` table is a shared namespace: provider passwords live there
 * under `credential:`, application secrets under `secret:`, and the parental
 * PIN's hash and salt under `parental:`. Nothing stopped those rows being
 * read out as settings, and the consequences ran further than they look:
 *
 *   - `settings:get` handed every one of them to the renderer, which is the
 *     one place the passwords are deliberately never sent.
 *   - Backups embedded them, including when "include credentials" was off.
 *   - Restore wrote them back *after* restoring the real passwords, so a
 *     backup carried to a second machine could overwrite a good password
 *     with a blob that machine cannot decrypt.
 *
 * Derived from `DEFAULT_SETTINGS` rather than written out, so a new setting
 * is allowed automatically and a new secret prefix is excluded automatically.
 * Getting that the wrong way round is how this sort of thing comes back.
 */
const SETTING_KEYS = new Set(Object.keys(DEFAULT_SETTINGS))

export function getSettings(): AppSettings {
  const rows = getDb().prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
  const stored: Record<string, unknown> = {}

  for (const row of rows) {
    if (!SETTING_KEYS.has(row.key)) continue
    try {
      stored[row.key] = JSON.parse(row.value)
    } catch {
      // A corrupt row should not brick startup — fall back to the default.
    }
  }

  const merged = { ...DEFAULT_SETTINGS, ...stored } as AppSettings

  // Stored settings are loose JSON merged over the defaults, so a value whose
  // shape changed between releases arrives here in its old shape and no
  // migration ever sees it. Anything that has changed shape is read through a
  // coercion rather than trusted.
  merged.sourceFailover = failoverMode(stored.sourceFailover)

  return merged
}

export function setSettings(patch: Partial<AppSettings>): AppSettings {
  const db = getDb()
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )

  const write = db.transaction(() => {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue
      // The same gate on the way in. `patch` is typed, but it arrives from the
      // renderer over IPC, where types are a compile-time promise and not a
      // runtime one — and a write to `credential:1` here would land in the
      // same table the passwords use.
      if (!SETTING_KEYS.has(key)) continue
      upsert.run(key, JSON.stringify(value))
    }
  })
  write()

  return getSettings()
}
