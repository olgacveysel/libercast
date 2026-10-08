import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { adoptPreviousUserData, databaseFileName } from '@main/db/relocate'

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

/** Stands in for Electron's userData, which is what the rename actually moves. */
function scenario(build: (parent: string, current: string) => void): string {
  const parent = mkdtempSync(join(tmpdir(), 'relocate-'))
  const current = join(parent, 'LiberCast')
  mkdirSync(current, { recursive: true })
  build(parent, current)
  ;(app as unknown as { getPath: (name: string) => string }).getPath = () => current
  adoptPreviousUserData()
  return current
}

console.log('\nCarrying data across a rename')

// The whole point: the app was renamed, so Electron now points at a new empty
// folder while everything the user has is in the old one.
const carried = scenario((parent) => {
  const old = join(parent, 'ZeroIPTV')
  mkdirSync(old, { recursive: true })
  writeFileSync(join(old, 'zeroiptv.db'), 'THE DATABASE')
  writeFileSync(join(old, 'zeroiptv.db-wal'), 'PENDING WRITES')
})

check('the database is carried over', existsSync(join(carried, databaseFileName())))
check(
  'and it is the same database',
  readFileSync(join(carried, databaseFileName()), 'utf8') === 'THE DATABASE'
)
// SQLite in WAL mode keeps recent changes in a sidecar. Copying the database
// without it silently loses whatever the user did last.
check('the write-ahead log comes too', existsSync(join(carried, `${databaseFileName()}-wal`)))

console.log('\nWhen it must do nothing')

// A folder that already has data must never be overwritten by an older one.
const existing = scenario((parent, current) => {
  writeFileSync(join(current, 'libercast.db'), 'CURRENT DATA')
  const old = join(parent, 'ZeroIPTV')
  mkdirSync(old, { recursive: true })
  writeFileSync(join(old, 'zeroiptv.db'), 'STALE DATA')
})
check(
  'existing data is never overwritten',
  readFileSync(join(existing, 'libercast.db'), 'utf8') === 'CURRENT DATA'
)

// A fresh install has nothing to adopt and must start cleanly rather than throw.
const fresh = scenario(() => undefined)
check('a fresh install is left empty', !existsSync(join(fresh, databaseFileName())))

// An old folder with no database is a launch that crashed before writing one;
// adopting it would create an empty database that then blocks the real one.
const emptyOld = scenario((parent) => {
  mkdirSync(join(parent, 'ZeroIPTV'), { recursive: true })
})
check('an old folder with no database is ignored', !existsSync(join(emptyOld, databaseFileName())))

console.log(failures === 0 ? '\nrelocate: all passed' : `\nrelocate: ${failures} failed`)
if (failures > 0) process.exitCode = 1
