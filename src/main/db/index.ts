import { join } from 'node:path'
import { app } from 'electron'
import Database from 'better-sqlite3'
import { backfillMatchKeys } from './backfill'
import { migrate } from './migrations'
import { adoptPreviousUserData, databaseFileName } from './relocate'

let instance: Database.Database | null = null

export function getDb(): Database.Database {
  if (instance) return instance

  // Renaming the app moved this folder, so anything left behind by an earlier
  // name is carried over before the database is opened — otherwise the rename
  // would look to the user like the app forgetting everything.
  adoptPreviousUserData()

  const file = join(app.getPath('userData'), databaseFileName())
  const db = new Database(file)

  // WAL keeps reads fast while a sync writes tens of thousands of rows.
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  // A large playlist import touches a lot of pages; give SQLite room to cache.
  db.pragma('cache_size = -32000')

  migrate(db)
  // Needs JavaScript, so it cannot live in a migration.
  backfillMatchKeys(db)

  instance = db
  return db
}

export function closeDb(): void {
  instance?.close()
  instance = null
}

/**
 * Normalizes a name for search and matching: lowercased, accent-stripped,
 * punctuation collapsed. Stored alongside the display name so LIKE queries
 * stay index-friendly instead of calling a function per row.
 */
export function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
