import { credentialHintKey, describeCredentialStorage } from '@shared/credentialStorage'

/**
 * Which claim the interface is allowed to make about a stored password.
 *
 * The application used to tell everyone it was "encrypted with Windows DPAPI".
 * On Windows that is true. On Linux it was false, and false in the worst
 * direction: `safeStorage` reports encryption as available there even when the
 * backend is `basic_text`, which uses a key compiled into Chromium.
 */

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

const describe = (platform: string, available: boolean, backend?: string | null) =>
  describeCredentialStorage({ platform, available, backend })

console.log('\nWhere the password really lives')

check('Windows is DPAPI', describe('win32', true).backend === 'dpapi')
check('and that is real protection', describe('win32', true).protectedByOs)
check('macOS is the Keychain', describe('darwin', true).backend === 'keychain')
check('and that is real too', describe('darwin', true).protectedByOs)

check('GNOME is libsecret', describe('linux', true, 'gnome_libsecret').backend === 'libsecret')
check('and counts as protected', describe('linux', true, 'gnome_libsecret').protectedByOs)
for (const backend of ['kwallet', 'kwallet5', 'kwallet6']) {
  check(`${backend} is the KDE wallet`, describe('linux', true, backend).backend === 'kwallet')
  check(`${backend} counts as protected`, describe('linux', true, backend).protectedByOs)
}

console.log('\nThe case that was being misreported')

// Encryption is "available" and the result is a key that ships inside the
// binary. Calling this protected is the original untruth in a new place.
check('basic_text is named as plain', describe('linux', true, 'basic_text').backend === 'plain')
check('and is NOT counted as protected', !describe('linux', true, 'basic_text').protectedByOs)

// An unknown backend is not evidence of protection; erring the other way would
// reinstate the claim this exists to stop making.
check('an unrecognised backend is treated as plain',
  describe('linux', true, 'unknown').backend === 'plain')
check('and is not counted as protected', !describe('linux', true, 'unknown').protectedByOs)
check('a missing backend reading is treated the same',
  !describe('linux', true, null).protectedByOs)
check('so is one that was never reported', !describe('linux', true, undefined).protectedByOs)

console.log('\nWhen there is nothing at all')

check('no encryption available is none', describe('linux', false, 'basic_text').backend === 'none')
check('and certainly not protected', !describe('linux', false).protectedByOs)
// Unavailable wins over the platform, because the platform is not the question.
check('even on Windows, if it ever happened', describe('win32', false).backend === 'none')
check('and on macOS', describe('darwin', false).backend === 'none')

console.log('\nEach case has something to say')

const keys = new Set(
  [
    describe('win32', true),
    describe('darwin', true),
    describe('linux', true, 'gnome_libsecret'),
    describe('linux', true, 'kwallet5'),
    describe('linux', true, 'basic_text'),
    describe('linux', false)
  ].map(credentialHintKey)
)
check('every backend maps to its own string', keys.size === 6, [...keys])
check('and they are all namespaced together',
  [...keys].every((k) => k.startsWith('source.password.')), [...keys])

console.log(failures === 0 ? '\ncredentialstorage: all passed' : `\ncredentialstorage: ${failures} failed`)
process.exit(failures === 0 ? 0 : 1)
