import { chmodSync } from 'node:fs'
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

  // After the pragmas, not before: the -wal and -shm files do not exist until
  // WAL mode is switched on, so doing this earlier would silently set the mode
  // on the main file alone and leave the write-ahead log world-readable.
  //
  // It matters where the OS has no keyring, because then the password in this
  // file is only as private as the file. Owner-only is what a keyring would
  // have given us, and it costs nothing where there is one. Windows ignores
  // POSIX modes and protects the profile directory with its own ACL, so this
  // is skipped there rather than becoming a second mechanism to keep straight.
  if (process.platform !== 'win32') {
    for (const path of [file, `${file}-wal`, `${file}-shm`]) {
      try {
        chmodSync(path, 0o600)
      } catch {
        // A mode that cannot be set is not a reason to refuse to start.
      }
    }
  }

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
