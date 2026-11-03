/**
 * Runs every browser harness, in one command, without needing to be told how.
 *
 * The `verify:*` scripts each end in a bare `electron test/browser/…`, which
 * worked while a person was supplying the rest from memory: a virtual display
 * on a headless machine, `--no-sandbox` when running as root, and the esbuild
 * step each harness needs before it. None of that was written down anywhere,
 * so the harnesses could only be run by someone who already knew — which is
 * exactly the knowledge that does not survive being handed to CI, or to the
 * next person.
 *
 * It also builds once rather than ten times. The individual scripts each run
 * `npm run build` so that any one of them works alone; running all ten that
 * way rebuilt the application nine times for nothing.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const cache = join(root, 'node_modules', '.cache')

/** esbuild bundles some harnesses need before they can run. */
const BUNDLES = [
  {
    entry: 'src/renderer/src/features/multiview/layout.ts',
    out: `${cache}/verify-multiview/layout.cjs`,
    args: []
  },
  {
    entry: 'src/renderer/src/features/player/stall.ts',
    out: `${cache}/verify-stall/stall.cjs`,
    args: []
  },
  {
    entry: 'src/main/media/streamServer.ts',
    out: `${cache}/verify-player/streamServer.cjs`,
    args: [
      '--alias:@main=./src/main',
      '--alias:@shared=./src/shared',
      '--alias:electron=./test/electron-stub.cjs',
      '--external:better-sqlite3',
      '--external:ffmpeg-static',
      '--external:ffprobe-static'
    ]
  },
  {
    entry: 'src/renderer/src/features/player/subtitleStyle.ts',
    out: `${cache}/verify-player/subtitleStyle.cjs`,
    args: ['--alias:@shared=./src/shared']
  },
  {
    entry: 'src/main/windows/detached.ts',
    out: `${cache}/verify-detached/main/detached.cjs`,
    args: [
      '--alias:@main/window=./test/browser/window-stub.cjs',
      '--alias:@main=./src/main',
      '--alias:@shared=./src/shared',
      '--external:electron'
    ]
  }
]

/** Harnesses, in the order they run. */
const HARNESSES = [
  'verify-multiview',
  'verify-detached',
  'verify-stall',
  'verify-player',
  'verify-i18n',
  'verify-merged',
  'verify-updates',
  'verify-nextup',
  'verify-credentials',
  'verify-failover',
  'verify-vodfilters'
]

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false, ...options })
  if (result.error) throw result.error
  return result.status ?? 1
}

/** `npx esbuild`, which is how the package scripts reach it. */
function bundle({ entry, out, args }) {
  const status = run('npx', [
    'esbuild', entry,
    '--bundle', '--platform=node', '--format=cjs',
    `--outfile=${out}`, '--log-level=error',
    ...args
  ])
  if (status !== 0) throw new Error(`esbuild failed for ${entry}`)
}

/**
 * The detached harness reads the built output from its own copy, because it
 * loads a second window from a different path.
 */
function stageDetached() {
  const dir = `${cache}/verify-detached`
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(`${dir}/main`, { recursive: true })
  cpSync('out/preload', `${dir}/preload`, { recursive: true })
  cpSync('out/renderer', `${dir}/renderer`, { recursive: true })
}

/**
 * Whether a virtual display has to be supplied.
 *
 * A developer running this on their own desktop already has one. CI and a
 * container do not, and the failure without it is Electron refusing to start
 * with a message about the display that reads like a broken test.
 */
function displayWrapper() {
  if (process.env.DISPLAY) return null
  const probe = spawnSync('xvfb-run', ['--help'], { stdio: 'ignore' })
  if (probe.error) return null
  return 'xvfb-run'
}

/**
 * Chromium refuses its sandbox as root, which is how CI and most containers
 * run. Passed only where it is needed, so a normal desktop run keeps it.
 */
function electronFlags() {
  const asRoot = typeof process.getuid === 'function' && process.getuid() === 0
  const flags = ['--disable-gpu']
  if (asRoot || process.env.CI) flags.unshift('--no-sandbox')
  return flags
}

function main() {
  console.log('Building once for all harnesses…')
  if (run('npm', ['run', 'build'], { stdio: 'inherit' }) !== 0) {
    console.error('\nBuild failed; harnesses not run.')
    process.exit(1)
  }

  for (const spec of BUNDLES) {
    if (spec.entry.endsWith('detached.ts')) stageDetached()
    bundle(spec)
  }

  const wrapper = displayWrapper()
  const flags = electronFlags()
  if (wrapper) console.log(`No DISPLAY set — running under ${wrapper}.`)

  const failed = []
  for (const name of HARNESSES) {
    const script = join('test', 'browser', `${name}.cjs`)
    if (!existsSync(script)) {
      console.error(`\n  MISSING  ${name} — no such harness`)
      failed.push(name)
      continue
    }

    console.log(`\n──────── ${name} ────────`)
    const electron = ['npx', 'electron', ...flags, script]
    const argv = wrapper ? [wrapper, '-a', ...electron] : electron
    const status = run(argv[0], argv.slice(1))
    if (status !== 0) failed.push(name)
  }

  console.log('\n════════════════════════════════')
  if (failed.length === 0) {
    console.log(`All ${HARNESSES.length} harnesses passed.`)
    process.exit(0)
  }
  console.log(`${failed.length} of ${HARNESSES.length} failed: ${failed.join(', ')}`)
  process.exit(1)
}

try {
  execFileSync('npx', ['--version'], { stdio: 'ignore' })
} catch {
  console.error('npx is not available; cannot run the harnesses.')
  process.exit(1)
}

main()
