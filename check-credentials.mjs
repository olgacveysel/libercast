/**
 * Does Electron 44 still read what Electron 31 wrote?
 *
 * Run this BEFORE opening the new build, and again AFTER. It reads LiberCast's
 * database directly, read-only, and never changes anything.
 *
 * What it is actually for: `getPassword` swallows a decryption failure and
 * returns null, so a password Electron 44 cannot read looks exactly like a
 * password that was never saved. The row stays in the database either way.
 * That is the difference this prints.
 *
 *   node check-credentials.mjs
 *
 * Run it from the libercast repo folder, so it can find better-sqlite3.
 */
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const appData = process.env.APPDATA ?? ''
if (!appData) {
  console.error('No APPDATA in the environment. Is this Windows?')
  process.exit(1)
}

const dbPath = join(appData, 'LiberCast', 'libercast.db')
if (!existsSync(dbPath)) {
  console.error(`No database at ${dbPath}`)
  console.error('If LiberCast has never run on this account, there is nothing to check.')
  process.exit(1)
}

let Database
try {
  Database = require('better-sqlite3')
} catch {
  console.error('Could not load better-sqlite3.')
  console.error('Run this from the libercast repo folder, where node_modules lives.')
  process.exit(1)
}

// Read-only, and the app should be closed: the database is in WAL mode and a
// running LiberCast will be holding it.
const db = new Database(dbPath, { readonly: true, fileMustExist: true })

const sources = db.prepare('SELECT id, name, kind FROM playlists ORDER BY id').all()
const rows = db
  .prepare("SELECT key, value FROM settings WHERE key LIKE 'credential:%'")
  .all()

console.log(`\nDatabase: ${dbPath}`)
console.log(`Sources configured: ${sources.length}`)
for (const source of sources) console.log(`  ${source.id}  ${source.kind.padEnd(8)}  ${source.name}`)

console.log(`\nStored credentials: ${rows.length}`)
if (rows.length === 0) {
  console.log('  (none — this check needs a source whose password you saved before the upgrade)')
}

for (const row of rows) {
  const id = row.key.slice('credential:'.length)
  const source = sources.find((s) => String(s.id) === id)
  let shape
  try {
    const payload = JSON.parse(row.value)
    shape = payload.enc
      ? `encrypted, ${Buffer.from(payload.value, 'base64').length} bytes of ciphertext`
      : 'NOT ENCRYPTED (stored as plain text)'
  } catch {
    shape = 'the stored value is not the expected JSON'
  }
  console.log(`  ${row.key}  ->  ${source ? source.name : 'no such source'}  [${shape}]`)
}

console.log(
  '\nWhat this tells you: the row exists and holds ciphertext. It does NOT tell you\n' +
    'whether Electron 44 can decrypt it — only the app can answer that. If a source\n' +
    'below is listed here WITH ciphertext, and the app then behaves as though no\n' +
    'password is saved, that is the DPAPI read failing silently.\n'
)
db.close()
