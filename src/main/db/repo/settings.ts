import { DEFAULT_SETTINGS, failoverMode, type AppSettings } from '@shared/types'
import { getDb } from '../index'

export function getSettings(): AppSettings {
  const rows = getDb().prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
  const stored: Record<string, unknown> = {}

  for (const row of rows) {
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
      upsert.run(key, JSON.stringify(value))
    }
  })
  write()

  return getSettings()
}
