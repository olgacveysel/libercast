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

const notice = template.replaceAll('{{version}}', version)

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

console.log(`installer notice written for ${version}`)
