/**
 * Writes the installer notice the NSIS page shows, from the template.
 *
 * Two things went wrong with keeping it as a plain file, and both are the kind
 * nobody notices until a tester reads the screen they are agreeing to:
 *
 *   - The version was typed in. It said 0.9.0-beta.1 for as long as it took
 *     anyone to look, which is worse than saying nothing: a notice that is
 *     visibly wrong about the build is not worth reading at all.
 *
 *   - It contained em dashes, saved as UTF-8 with no byte-order mark. NSIS
 *     reads a licence file as ANSI unless it detects a BOM, so "LiberCast --"
 *     reached the screen as "LiberCast a-tilde...". The template is ASCII
 *     instead of BOM-marked on purpose: a BOM is only correct if everything
 *     downstream agrees to look for one, while ASCII reads the same either way.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const templatePath = join(root, 'resources', 'eula.template.txt')
const outputPath = join(root, 'resources', 'eula.txt')

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const template = readFileSync(templatePath, 'utf8')

/**
 * The paragraphs that are not true on every platform.
 *
 * Where passwords go, where the data folder is, and what the operating system
 * says about an unsigned build all differ — and the notice is the one document
 * someone reads before deciding to trust the thing, so getting it wrong there
 * is worse than not saying it.
 *
 * The Linux wording is deliberately conditional: `safeStorage` falls back to a
 * key compiled into Chromium when no keyring is present, which is not
 * encryption, and the application now says so in its own interface too.
 */
const PLATFORMS = {
  win32: {
    passwords:
      'Your provider passwords are encrypted with Windows DPAPI, tied to the Windows\n' +
      'account you are signed in as, and kept in your own user profile:',
    datafolder: '%APPDATA%\\LiberCast',
    signing:
      'Windows will warn you that the publisher is unknown, because this beta carries\n' +
      'no code-signing certificate. Only install it if you obtained it directly from\n' +
      'the author.'
  },
  linux: {
    passwords:
      'Your provider passwords are handed to your desktop keyring where there is one\n' +
      '(GNOME Keyring or KWallet). Where there is not, they are stored unencrypted,\n' +
      'readable by anything running as you, and the application says so when you add\n' +
      'a source. Either way they stay in your own home directory:',
    datafolder: '~/.config/LiberCast',
    signing:
      'This build is not signed. Nothing verifies that it came from the author, so\n' +
      'only run it if you obtained it directly from them. The AppImage must also be\n' +
      'made executable before it will run: chmod +x LiberCast-*.AppImage'
  },
  darwin: {
    passwords:
      'Your provider passwords are stored in the macOS Keychain, under the account\n' +
      'you are signed in as. Everything else lives in your own library folder:',
    datafolder: '~/Library/Application Support/LiberCast',
    signing:
      'This build is neither signed nor notarised, so macOS will refuse to open it\n' +
      'normally. Only run it if you obtained it directly from the author.'
  }
}

const target = process.argv[2] ?? 'win32'
const platform = PLATFORMS[target]
if (!platform) {
  throw new Error(`No installer notice written for ${target}; known: ${Object.keys(PLATFORMS).join(', ')}`)
}

const notice = Object.entries({ version, ...platform }).reduce(
  (text, [key, value]) => text.replaceAll(`{{${key}}}`, value),
  template
)

const unfilled = notice.match(/\{\{[a-z]+\}\}/i)
if (unfilled) {
  throw new Error(`The installer notice still contains ${unfilled[0]} after filling it in.`)
}

const offending = [...notice].find((character) => character.charCodeAt(0) > 127)
if (offending !== undefined) {
  throw new Error(
    `The installer notice must be ASCII, but it contains ${JSON.stringify(offending)}. ` +
      'NSIS reads it as ANSI and anything above 127 reaches the screen as mojibake.'
  )
}

// CRLF, because this is read by a Windows installer and shown in a Windows
// text control.
writeFileSync(outputPath, notice.replace(/\r?\n/g, '\r\n'), 'ascii')

console.log(`installer notice written for ${version} on ${target}`)
