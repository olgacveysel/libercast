import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { isWebLink } from '@main/window'

/*
 * Every window gets the same shell rules, and only one file decides them.
 *
 * The main window was hardened and the pop-out player was not: it kept its
 * own copy of the original handler, which passed any URL at all to
 * `shell.openExternal` and had no navigation block. The window with the least
 * chrome had the weakest guards, and nothing said so.
 *
 * Two checks. The first is on the rule itself; the second is structural,
 * because the defect was not a wrong rule but a second copy of an old one.
 */

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

console.log('\nWhat counts as a web link')
check('http', isWebLink('http://example.test/page'))
check('https', isWebLink('https://example.test/page'))
check('a file URL does not', !isWebLink('file:///etc/passwd'))
check('nor javascript:', !isWebLink('javascript:alert(1)'))
check('nor a Windows shell scheme', !isWebLink('ms-settings:privacy'))
check('nor a UNC path', !isWebLink('\\\\server\\share\\file'))
check('nor nonsense', !isWebLink('not a url at all'))
check('nor an empty string', !isWebLink(''))

console.log('\nWho is allowed to open things')

const root = process.cwd()

/*
 * Comments are not code.
 *
 * The first version of this matched the raw file, so commenting the call out
 * — which is how it would actually be lost — still read as present and the
 * check passed while the guard was gone. A structural test that cannot fail
 * is worse than none, because it is believed.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

function code(path: string): string {
  return stripComments(readFileSync(path, 'utf8'))
}

function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) sources(path, found)
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) found.push(path)
  }
  return found
}

const mainFiles = sources(join(root, 'src', 'main'))
const windowFile = join(root, 'src', 'main', 'window.ts')

// `shell.openExternal` hands a string to the operating system, which acts on
// a great deal more than http. Exactly one file may call it, and that file is
// the one that checks the scheme first.
const openers = mainFiles.filter(
  (path) => path !== windowFile && /shell\.openExternal\s*\(/.test(code(path))
)
check(
  'only window.ts opens external links',
  openers.length === 0,
  openers.map((p) => p.slice(root.length + 1))
)

// Any file that makes a BrowserWindow has to hand it to the shared guard.
const makers = mainFiles.filter((path) => /new BrowserWindow\s*\(/.test(code(path)))
check('windows are created in at least two places', makers.length >= 2, makers.length)

const unguarded = makers.filter((path) => !/guardWindow\s*\(/.test(code(path)))
check(
  'every one of them calls guardWindow',
  unguarded.length === 0,
  unguarded.map((p) => p.slice(root.length + 1))
)

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`)
process.exit(failures === 0 ? 0 : 1)
