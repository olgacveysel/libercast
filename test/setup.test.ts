import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/*
 * What `npm ci --ignore-scripts` leaves undone.
 *
 * The flag is there for one reason: npm runs `node-gyp rebuild` for any
 * package carrying a `binding.gyp` and no install script, and for
 * better-sqlite3 that build is thrown away — the shipped binary is a
 * Node-API prebuild, valid across Node and Electron versions alike. The
 * rebuild costs minutes, needs a toolchain, and fetches Electron's headers
 * over the network, which fails wherever that host is unreachable.
 *
 * The cost of the flag is that every legitimate install step is skipped too,
 * and those have to be run by hand in `npm run setup`. Twice now that list
 * has been wrong. The first time `ffmpeg-static` was missing and playback
 * reported no ffmpeg. The second time `electron` was missing and the
 * application would not start at all — and it was missed precisely because
 * the list was drawn up by reading `scripts` blocks: Electron 44 has no
 * `scripts` block. It ships an `install.js` and an `install-electron` binary
 * instead, which npm never runs on its own.
 *
 * So the list is no longer drawn up by hand. This reads what is actually in
 * `node_modules` and fails if anything needing an install step is neither run
 * by `setup` nor written down here with a reason.
 */

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

/** Packages whose install step is skipped on purpose, and why. */
const EXEMPT: Record<string, string> = {
  esbuild:
    'the binary comes from the @esbuild/<platform> package, which is a plain dependency; install.js only verifies it',
  'electron-winstaller':
    'Squirrel, which this project does not build — the Windows target is NSIS',
  'electron-builder':
    'install-app-deps is a command a person runs, not an install step'
}

const root = process.cwd()
const setup = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>
}).scripts.setup

// Everything below reads it, so there is no sense continuing without it.
if (typeof setup !== 'string' || setup.length === 0) {
  console.log('  FAIL  there is a setup script', setup)
  console.log('\n1 check(s) failed.\n')
  process.exit(1)
}

check('there is a setup script', true)
check('and it is the one that skips scripts', setup.includes('--ignore-scripts'), setup)

interface Manifest {
  scripts?: Record<string, string>
  bin?: string | Record<string, string>
}

/** Every package that npm would have run something for, or that ships its own installer. */
function needsInstalling(): string[] {
  const found: string[] = []

  const walk = (dir: string, prefix = ''): void => {
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith('.')) continue
      const path = join(dir, entry)

      if (entry.startsWith('@')) {
        walk(path, `${entry}/`)
        continue
      }

      const manifest = join(path, 'package.json')
      if (!existsSync(manifest)) continue

      let parsed: Manifest
      try {
        parsed = JSON.parse(readFileSync(manifest, 'utf8')) as Manifest
      } catch {
        continue
      }

      const scripts = parsed.scripts ?? {}
      const hook = scripts.install ?? scripts.postinstall ?? scripts.preinstall
      const bin = typeof parsed.bin === 'object' && parsed.bin !== null ? Object.keys(parsed.bin) : []
      // The shape Electron uses: no hook at all, an installer in `bin`.
      const shipsInstaller = bin.some((name) => /^install[-_]/.test(name))

      if (hook || shipsInstaller) found.push(prefix + entry)
    }
  }

  walk(join(root, 'node_modules'))
  return found.sort()
}

console.log('\nPackages with an install step')
const packages = needsInstalling()
check('node_modules was readable', packages.length > 0, packages.length)

const unaccounted = packages.filter(
  (name) => !(name in EXEMPT) && !setup.includes(`node_modules/${name}/install.js`)
)

check(
  'every one is run by setup or exempt with a reason',
  unaccounted.length === 0,
  unaccounted
)

// The two that must be there, named outright: these are the two that have
// actually broken, and a passing test above would not notice them being
// quietly moved into EXEMPT.
console.log('\nThe two that have broken before')
check('setup installs Electron', setup.includes('node_modules/electron/install.js'), setup)
check('setup installs ffmpeg', setup.includes('node_modules/ffmpeg-static/install.js'), setup)

// An exemption for something no longer installed is a stale note, and stale
// notes are how the list drifted in the first place.
console.log('\nThe written-down exemptions')
const stale = Object.keys(EXEMPT).filter((name) => !packages.includes(name))
check('none of them is for a package that is gone', stale.length === 0, stale)

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`)
process.exit(failures === 0 ? 0 : 1)
