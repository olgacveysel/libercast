/**
 * What is actually protecting a stored provider password.
 *
 * The application told every user their password was "encrypted with Windows
 * DPAPI", which is true on Windows and false everywhere else — and on Linux it
 * is misleading in a way that matters. Electron's `safeStorage` reports
 * encryption as *available* there even when the only backend it can find is
 * `basic_text`, which encrypts with a key compiled into Chromium. Anyone who
 * can read the file can read the password; the ciphertext is decoration.
 *
 * So the interface says which of these it is, and the honest cases say so
 * plainly rather than borrowing the word "encrypted".
 */

export type CredentialBackend =
  /** Windows DPAPI: tied to the OS account. */
  | 'dpapi'
  /** macOS Keychain. */
  | 'keychain'
  /** GNOME's secret service. */
  | 'libsecret'
  /** KDE's wallet, any version. */
  | 'kwallet'
  /**
   * Chromium's fallback: a key that ships inside the binary, so it protects
   * the password from nobody who has the file.
   */
  | 'plain'
  /** No encryption offered at all. */
  | 'none'

export interface StorageFacts {
  platform: NodeJS.Platform | string
  /** What `safeStorage.isEncryptionAvailable()` said. */
  available: boolean
  /** What `safeStorage.getSelectedStorageBackend()` said; Linux only. */
  backend?: string | null
}

export interface CredentialStorage {
  backend: CredentialBackend
  /**
   * Whether anything real stands between the file and the password.
   *
   * `basic_text` is deliberately false. Calling it protected would be the same
   * untruth in a new place.
   */
  protectedByOs: boolean
}

export function describeCredentialStorage(facts: StorageFacts): CredentialStorage {
  if (!facts.available) return { backend: 'none', protectedByOs: false }

  if (facts.platform === 'win32') return { backend: 'dpapi', protectedByOs: true }
  if (facts.platform === 'darwin') return { backend: 'keychain', protectedByOs: true }

  switch (facts.backend) {
    case 'gnome_libsecret':
      return { backend: 'libsecret', protectedByOs: true }
    case 'kwallet':
    case 'kwallet5':
    case 'kwallet6':
      return { backend: 'kwallet', protectedByOs: true }
    case 'basic_text':
      return { backend: 'plain', protectedByOs: false }
    default:
      // An unknown backend is not evidence of protection. Erring the other way
      // would reinstate exactly the claim this exists to stop making.
      return { backend: 'plain', protectedByOs: false }
  }
}

/** The dictionary key describing this backend to the user. */
export function credentialHintKey(storage: CredentialStorage): string {
  return `source.password.${storage.backend}`
}
