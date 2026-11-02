import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The notice people agree to when installing.
 *
 * It had a hand-typed version in it, which went stale immediately, and two em
 * dashes saved as UTF-8 with no byte-order mark, which NSIS read as ANSI and
 * put on screen as mojibake. Neither failed a build or a test; both were only
 * visible to someone reading the installer, which is nobody until it is a
 * tester deciding whether to trust the thing.
 */

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

const root = process.cwd()
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }

console.log('\nThe installer notice')

// Generated rather than checked in stale: the test regenerates it the way the
// packaging script does, then reads what landed.
execFileSync(process.execPath, [join(root, 'tools', 'make-eula.mjs')], {
  cwd: root,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  stdio: 'pipe'
})

const bytes = readFileSync(join(root, 'resources', 'eula.txt'))
const text = bytes.toString('latin1')

check('it was written', bytes.length > 500, bytes.length)
check('it names the version being built', text.includes(`Version ${version}`), text.slice(0, 80))
// A stale second mention would be just as misleading as the one that was
// there before, so the check is that the right version is the only one.
const otherVersions = text
  .replace(`Version ${version}`, '')
  .match(/\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?/g)
check('and mentions no other version number', otherVersions === null, otherVersions)

// The bug, pinned: NSIS reads this as ANSI, so a byte above 127 is mojibake
// on screen no matter how correct the file is as UTF-8.
const high = [...bytes].findIndex((byte) => byte > 127)
check('every byte is ASCII', high === -1,
  high === -1 ? '' : `byte ${bytes[high]} at offset ${high}: ${text.slice(Math.max(0, high - 30), high + 10)}`)

check('there is no byte-order mark', !(bytes[0] === 0xef && bytes[1] === 0xbb), [...bytes.slice(0, 3)])
check('lines end the way Windows expects', text.includes('\r\n') && !/[^\r]\n/.test(text))

// The substance has to survive the template, not just the encoding.
check('it still says this is a beta', /THIS IS A BETA/i.test(text))
check('it still warns the build is unsigned', /NOT CODE-SIGNED/i.test(text))
// Matched against the text with its line breaks collapsed: the wrapping is a
// formatting decision and must not be what this check is really testing.
const flowed = text.replace(/\s+/g, ' ')
check('it still names the ffmpeg licence', /GNU General Public License/i.test(flowed), flowed.slice(0, 0))

console.log('\nThe template it came from')

const template = readFileSync(join(root, 'resources', 'eula.template.txt'))
check('the template carries a placeholder, not a version',
  template.toString('latin1').includes('{{version}}'))
check('and is itself ASCII', [...template].every((byte) => byte <= 127))

console.log('\nEach platform gets its own')

// The notice is the one document someone reads before deciding to trust an
// unsigned binary, so a paragraph that is true on Windows and false on Linux
// is worse than one that is missing.
for (const [platform, expected, forbidden] of [
  ['win32', 'Windows DPAPI|%APPDATA%|Windows will warn you', '~/.config|AppImage|Keychain'],
  ['linux', '~/.config|keyring|AppImage', '%APPDATA%|Windows will warn you|Keychain'],
  ['darwin', 'Keychain|Library/Application Support|notarised', '%APPDATA%|AppImage']
] as const) {
  execFileSync(process.execPath, [join(root, 'tools', 'make-eula.mjs'), platform], {
    cwd: root,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'pipe'
  })
  const written = readFileSync(join(root, 'resources', 'eula.txt'), 'latin1')

  for (const phrase of expected.split('|')) {
    check(`${platform} says "${phrase}"`, written.includes(phrase), written.slice(0, 60))
  }
  for (const phrase of forbidden.split('|')) {
    check(`${platform} does not mention "${phrase}"`, !written.includes(phrase))
  }
  check(`${platform} is still ASCII`, [...Buffer.from(written, 'latin1')].every((b) => b <= 127))
  check(`${platform} has nothing left unfilled`, !/\{\{/.test(written), written.match(/\{\{[a-z]*\}\}/i))
}

// An unknown platform must fail loudly rather than writing a notice with holes
// in it where the paragraphs should be.
check('an unknown platform is refused', (() => {
  try {
    execFileSync(process.execPath, [join(root, 'tools', 'make-eula.mjs'), 'plan9'], {
      cwd: root,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'pipe'
    })
    return false
  } catch {
    return true
  }
})())

// Left as the Windows one, which is what `npm run pack:win` expects to find.
execFileSync(process.execPath, [join(root, 'tools', 'make-eula.mjs'), 'win32'], {
  cwd: root,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  stdio: 'pipe'
})

console.log(failures === 0 ? '\neula: all passed' : `\neula: ${failures} failed`)
process.exit(failures === 0 ? 0 : 1)
