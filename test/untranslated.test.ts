import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * English text that never reaches the dictionary.
 *
 * The typed dictionary already guarantees that every key English has, Turkish
 * and German have too — which is worth very little on its own, because a
 * sentence written straight into the JSX has no key to be missing. That is how
 * the Settings screen ended up fully translated in the dictionary and fully
 * English on screen.
 *
 * So this reads the source instead and fails on user-facing text that is not
 * going through `t(...)`. It is a lint rather than a proof: it cannot know
 * what a string is for. The allowlist below is the escape hatch, and every
 * entry in it should say why.
 */

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

/** Attributes whose value is read aloud or shown on hover. */
const TEXT_ATTRIBUTES = ['title', 'placeholder', 'aria-label', 'label', 'description', 'alt']

/**
 * Strings that are deliberately not translated, with the reason.
 *
 * Kept exact rather than as patterns: an allowlist that matches loosely stops
 * being an allowlist.
 */
const ALLOWED = new Set<string>([
  // A product name is the same in every language.
  'LiberCast',
  // Codec and container names are not words.
  'MPEG-TS',
  'WebVTT'
])

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) sourceFiles(path, found)
    else if (entry.endsWith('.tsx')) found.push(path)
  }
  return found
}

interface Finding {
  file: string
  line: number
  text: string
}

/** Two or more words of prose, starting like a sentence or a label. */
function looksLikeEnglish(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed.length < 4) return false
  if (ALLOWED.has(trimmed)) return false
  // Needs a space between two letters: "Open file" yes, "px" or "16/9" no.
  if (!/[A-Za-z]\s+[A-Za-z]/.test(trimmed)) return false
  // Template holes and expressions are not literals we can key.
  if (trimmed.includes('${') || trimmed.includes('{')) return false
  return true
}

function scan(file: string): Finding[] {
  const found: Finding[] = []
  const lines = readFileSync(file, 'utf8').split('\n')
  let inBlockComment = false

  lines.forEach((raw, index) => {
    const line = raw.trim()

    // Comments in this codebase carry a lot of prose, and none of it ships.
    if (inBlockComment) {
      if (line.includes('*/')) inBlockComment = false
      return
    }
    if (line.startsWith('/*') || line.startsWith('{/*')) {
      if (!line.includes('*/')) inBlockComment = true
      return
    }
    if (line.startsWith('//') || line.startsWith('*')) return

    for (const attribute of TEXT_ATTRIBUTES) {
      const match = raw.match(new RegExp(`(?:^|\\s)${attribute}="([^"]+)"`))
      if (match?.[1] && looksLikeEnglish(match[1])) {
        found.push({ file, line: index + 1, text: `${attribute}="${match[1]}"` })
      }
    }

    // A bare JSX text node: >Some words<
    const node = raw.match(/>\s*([A-Za-z][^<>{}\n]*)\s*</)
    if (node?.[1] && looksLikeEnglish(node[1])) {
      found.push({ file, line: index + 1, text: node[1].trim() })
    }

    // A whole sentence in a string literal: the status messages a screen sets
    // after an action ("That reminder could not be set.") are as visible as
    // anything in the markup, and are the easiest kind to miss because they
    // live in the handler rather than the layout.
    for (const quoted of raw.matchAll(/'([^'\\]{12,})'/g)) {
      const value = quoted[1]!
      if (!/[.?!]$/.test(value.trim())) continue
      if (!/\s\S+\s\S+/.test(value)) continue
      if (!looksLikeEnglish(value)) continue
      found.push({ file, line: index + 1, text: `'${value}'` })
    }
  })

  return found
}

console.log('\nEvery screen speaks the chosen language')

const files = sourceFiles('src/renderer/src')
check('there are components to check', files.length > 10, files.length)

const findings = files.flatMap(scan)

if (findings.length > 0) {
  const byFile = new Map<string, Finding[]>()
  for (const finding of findings) {
    const list = byFile.get(finding.file) ?? []
    list.push(finding)
    byFile.set(finding.file, list)
  }

  console.log('')
  for (const [file, items] of [...byFile].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${file}  (${items.length})`)
    for (const item of items) console.log(`      ${item.line}: ${item.text}`)
  }
  console.log('')
}

check(
  `no user-facing English is hard-coded (${findings.length} found)`,
  findings.length === 0,
  findings.length === 0 ? '' : 'listed above — route them through t(...) or allowlist with a reason'
)

console.log(failures === 0 ? '\nuntranslated: all passed' : `\nuntranslated: ${failures} failed`)
process.exit(failures === 0 ? 0 : 1)
