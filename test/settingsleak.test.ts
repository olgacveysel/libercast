import { getDb } from '@main/db'
import { getSettings, setSettings } from '@main/db/repo/settings'
import { setPassword } from '@main/secure/credentials'
import { createPlaylist } from '@main/db/repo/playlists'
import { setPin } from '@main/secure/parental'
import { buildPayload } from '@main/secure/backup'

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

getDb()

console.log('\nSecrets stay out of the settings object')

const playlist = createPlaylist({ name: 'Provider', kind: 'xtream', url: 'http://ex.com', username: 'u' })
setPassword(playlist.id, 'the-password')
setPin(null, '1234')

const keys = Object.keys(getSettings())
check('no provider password leaks out as a setting',
  keys.every((key) => !key.startsWith('credential:')), keys.filter((k) => k.startsWith('credential:')))
check('no parental hash or salt leaks out',
  keys.every((key) => !key.startsWith('parental:')), keys.filter((k) => k.startsWith('parental:')))
check('and real settings still come back', typeof getSettings().hardwareAcceleration === 'boolean')

// The renderer is the one place passwords are deliberately never sent, and
// `settings:get` is a channel it may call freely.
const serialised = JSON.stringify(getSettings())
// Both forms. Where the machine has a keyring the blob is ciphertext, but
// where it has none the stored value is the password in base64 — which is
// not encryption, and is exactly the case worth asserting about.
const asBase64 = Buffer.from('the-password', 'utf8').toString('base64')
check('the serialised settings contain no password in any form',
  !serialised.includes('the-password') && !serialised.includes(asBase64),
  serialised.slice(0, 160))

console.log('\nA backup carries no secrets either')

const payload = buildPayload(false)
const backupKeys = Object.keys(payload.settings)
check('the backup settings are settings only',
  backupKeys.every((key) => !key.includes(':')), backupKeys.filter((k) => k.includes(':')))

console.log('\nAnd nothing can write one back in')

// Typed as Partial<AppSettings>, but it arrives over IPC where that is a
// compile-time promise rather than a runtime one.
setSettings({ 'credential:1': 'overwritten' } as never)
const row = getDb().prepare("SELECT value FROM settings WHERE key = 'credential:1'").get() as
  | { value: string }
  | undefined
check('a write to a credential key through setSettings is ignored',
  row === undefined || !row.value.includes('overwritten'), row)

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`)
process.exit(failures === 0 ? 0 : 1)
