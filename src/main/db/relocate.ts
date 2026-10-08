import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { app } from 'electron'
import { createLogger, errorMessage } from '@main/util/logger'

const log = createLogger('relocate')

/**
 * The folders this app used before it was called LiberCast.
 *
 * Electron derives the user-data folder from the application name, so renaming
 * the app moves it — and everything in it stops being found. The database, the
 * settings and the encrypted provider passwords all live there, so without this
 * a rename would present to the user as the app having forgotten everything.
 *
 * Ordered newest first. Only the first one that actually holds a database is
 * used, so a half-created folder from a launch that crashed cannot win over a
 * real one.
 */
const PREVIOUS_NAMES = ['ZeroIPTV', 'zeroiptv']

/** Database files, old name and new, in the order they should be looked for. */
const DATABASE_NAMES = ['libercast.db', 'zeroiptv.db']

/**
 * Moves data from an older name's folder, once, before anything opens it.
 *
 * A copy rather than a move: if anything here goes wrong the user still has
 * their original folder untouched, which matters more than tidiness. The old
 * folder is left behind deliberately.
 */
export function adoptPreviousUserData(): void {
  let current: string
  try {
    current = app.getPath('userData')
  } catch {
    // Called before the app is ready; nothing to do and nothing to break.
    return
  }

  // Already has data of its own — either a fresh install that has run, or a
  // previous adoption. Either way, never overwrite it.
  if (DATABASE_NAMES.some((name) => existsSync(join(current, name)))) return

  const parent = dirname(current)

  for (const previous of PREVIOUS_NAMES) {
    const folder = join(parent, previous)
    if (folder === current || !existsSync(folder)) continue

    const database = DATABASE_NAMES.map((name) => join(folder, name)).find((path) =>
      existsSync(path)
    )
    if (!database) continue

    try {
      copyUserData(folder, current, basename(database))
      log.info(`carried over the data from the previous "${previous}" folder`)
    } catch (error) {
      // Not fatal: the app starts empty rather than not at all, and the old
      // folder is still there to try again or copy by hand.
      log.warn('could not carry over the previous data', errorMessage(error))
    }
    return
  }
}

/**
 * Copies the database and its sidecars, and the top-level files beside them.
 *
 * SQLite in WAL mode keeps `-wal` and `-shm` companions holding writes that are
 * not yet in the main file; copying the database without them can lose the most
 * recent changes, which here would be whatever the user did last.
 */
function copyUserData(from: string, to: string, databaseName: string): void {
  mkdirSync(to, { recursive: true })

  const wanted = new Set([
    databaseName,
    `${databaseName}-wal`,
    `${databaseName}-shm`,
    // Written by the app itself rather than by Electron.
    'settings.json'
  ])

  for (const entry of readdirSync(from)) {
    if (!wanted.has(entry)) continue

    const source = join(from, entry)
    if (!statSync(source).isFile()) continue

    copyFileSync(source, join(to, entry))
  }

  // Renamed along the way: the database keeps the app's name, so a file from
  // the old name is copied to the new one.
  const oldPath = join(to, databaseName)
  const newPath = join(to, DATABASE_NAMES[0]!)
  if (databaseName !== DATABASE_NAMES[0] && existsSync(oldPath)) {
    copyFileSync(oldPath, newPath)
    for (const suffix of ['-wal', '-shm']) {
      const sidecar = `${oldPath}${suffix}`
      if (existsSync(sidecar)) copyFileSync(sidecar, `${newPath}${suffix}`)
    }
  }
}

/** Where the database lives now. Exported so the relocation and the opener agree. */
export function databaseFileName(): string {
  return DATABASE_NAMES[0]!
}
