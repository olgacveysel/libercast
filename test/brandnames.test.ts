import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Real broadcaster names, which this project does not use.
 *
 * Every channel name in the fixtures, the comments and the documentation is
 * invented. Naming a real broadcaster to illustrate a matching rule is easy to
 * do without thinking — the names are simply what comes to mind when you need
 * an example of a sports channel — and it puts a trademark into an
 * open-source repository and, in one case, into a string shipped on screen.
 *
 * So the names are listed here and the build fails if one comes back. The list
 * is not exhaustive and cannot be: it is the ones this repository actually
 * used, which is what makes it worth checking rather than hoping.
 */

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

/**
 * Matched case-insensitively against source, comments and docs.
 *
 * `bein` is the one that needs care: it is a substring of "being", so it is
 * matched only where a letter does not follow.
 */
const FORBIDDEN: { name: string; pattern: RegExp }[] = [
  { name: 'beIN', pattern: /\bbein(?![a-z])/i },
  { name: 'BBC', pattern: /\bbbc/i },
  { name: 'Sky Sports', pattern: /\bsky[ -]?sports?\b/i },
  { name: 'ITV', pattern: /\bitv\b/i },
  { name: 'Meridian (ITV region)', pattern: /\bmeridian\b/i },
  { name: 'Discovery Channel', pattern: /\bdiscovery channel\b/i },
  { name: 'CNN', pattern: /\bcnn\b/i },
  { name: 'TRT', pattern: /\btrt\b/i },
  { name: 'Kanal Türk', pattern: /\bkanal t[üu]rk\b/i },
  { name: 'ESPN', pattern: /\bespn\b/i },
  { name: 'HBO', pattern: /\bhbo\b/i },
  { name: 'Netflix', pattern: /\bnetflix\b/i },
  { name: 'Al Jazeera', pattern: /\bal[ -]?jazeera\b/i },
  { name: 'Eurosport', pattern: /\beurosport\b/i },
  { name: 'DAZN', pattern: /\bdazn\b/i },
  { name: 'Canal+', pattern: /\bcanal\+/i },
  { name: 'Fox Sports', pattern: /\bfox[ -]?sports?\b/i }
]

const SKIP = new Set(['node_modules', 'out', 'release', 'dist', '.git'])
const EXTENSIONS = ['.ts', '.tsx', '.md', '.txt', '.yml', '.json', '.html', '.css']

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) sourceFiles(path, found)
    else if (EXTENSIONS.some((extension) => entry.endsWith(extension))) found.push(path)
  }
  return found
}

console.log('\nNo real broadcaster is named anywhere')

// This file lists them, so it is the one place they are allowed to appear.
const files = sourceFiles('src')
  .concat(sourceFiles('test').filter((f) => !f.endsWith('brandnames.test.ts')))
  .concat(['README.md', 'FEATURES.md', 'package.json'])

check('there are files to check', files.length > 40, files.length)

const found: string[] = []
for (const file of files) {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    continue
  }

  text.split('\n').forEach((line, index) => {
    for (const { name, pattern } of FORBIDDEN) {
      if (pattern.test(line)) found.push(`${file}:${index + 1}  ${name}  ${line.trim().slice(0, 90)}`)
    }
  })
}

if (found.length > 0) {
  console.log('')
  for (const hit of found.slice(0, 40)) console.log(`      ${hit}`)
  if (found.length > 40) console.log(`      … ${found.length - 40} more`)
  console.log('')
}

check(
  `no real broadcaster name appears in the source (${found.length} found)`,
  found.length === 0,
  found.length === 0 ? '' : 'listed above — use an invented name instead'
)

console.log(failures === 0 ? '\nbrandnames: all passed' : `\nbrandnames: ${failures} failed`)
process.exit(failures === 0 ? 0 : 1)
