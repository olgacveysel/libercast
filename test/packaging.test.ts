import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { load } from 'js-yaml'

/*
 * What ends up inside the package.
 *
 * electron-builder's `files` is a filter, and a platform block's copy of it
 * does not extend the top-level one — it replaces that list, and
 * electron-builder's own defaults with it. The `win:` and `linux:` blocks here
 * existed only to drop the ffprobe and better-sqlite3 binaries belonging to
 * platforms not being built, four lines each, and those four lines quietly
 * became the whole filter.
 *
 * The result shipped for several releases: every Windows and Linux package
 * carried the full source tree, the test suite and the `.git` directory, and
 * one built on a working machine carried whatever else was lying in the folder
 * beside them. Nothing caught it. The size guard in `tools/after-pack.cjs`
 * only fails above 60 MB and the archive was still under five, the installer
 * grew by an amount the engine upgrade could explain, and nobody opens an
 * asar to see what is in it.
 *
 * So the three lists are compared here instead. The duplication in the
 * configuration is deliberate — there is no way to splice one YAML sequence
 * into another — and this is what keeps it from drifting.
 */

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

interface BuilderConfig {
  files?: string[]
  win?: { files?: string[] }
  linux?: { files?: string[] }
  asarUnpack?: string[]
}

// The runner bundles each test elsewhere and runs it with the project root as
// the working directory, so `__dirname` points at the bundle rather than here.
const root = process.cwd()
const config = load(readFileSync(join(root, 'electron-builder.yml'), 'utf8')) as BuilderConfig

const common = config.files ?? []
const win = config.win?.files ?? []
const linux = config.linux?.files ?? []

console.log('\nThe three lists')
check('the top-level list is not empty', common.length > 0, common.length)
check('the Windows build has its own list', win.length > 0, win.length)
check('the Linux build has its own list', linux.length > 0, linux.length)

// A platform list may add to the common one; it may never drop from it.
const missingFromWin = common.filter((pattern) => !win.includes(pattern))
const missingFromLinux = common.filter((pattern) => !linux.includes(pattern))

check('Windows repeats every common exclusion', missingFromWin.length === 0, missingFromWin)
check('Linux repeats every common exclusion', missingFromLinux.length === 0, missingFromLinux)

/*
 * The things that must not ship, named rather than inferred.
 *
 * Checking only that the lists match each other would pass happily if all
 * three were emptied, so the ones that actually caused this are stated. `.git`
 * is here because it is excluded by electron-builder's defaults and therefore
 * was never in the configuration at all — which is exactly why a platform
 * block replacing those defaults put the whole repository history into the
 * package.
 */
console.log('\nThings that must never be packaged')
const MUST_EXCLUDE = ['.git', 'src', 'test', 'release', 'Claude outputs']

for (const name of MUST_EXCLUDE) {
  // Both spellings: the directory, and everything under it.
  const wanted = [`!${name}`, `!${name}/**/*`]
  for (const [label, list] of [
    ['top level', common],
    ['Windows', win],
    ['Linux', linux]
  ] as const) {
    const has = wanted.every((pattern) => list.includes(pattern))
    check(`${label}: "${name}" is excluded`, has, list.filter((p) => p.includes(name)))
  }
}

console.log('\nStray files from a working folder')
// A log beside the source is what a local build swept up, and the log is the
// one file in that folder with a user's own provider hostnames in it.
for (const [label, list] of [
  ['top level', common],
  ['Windows', win],
  ['Linux', linux]
] as const) {
  check(`${label}: log files are excluded`, list.includes('!*.log'), list.filter((p) => p.includes('log')))
}

console.log('\nWhat still has to be packaged')
// The exclusions must not have taken the application with them.
const unpack = config.asarUnpack ?? []
check(
  'the database addon is still unpacked',
  unpack.some((pattern) => pattern.includes('better-sqlite3')),
  unpack
)
check(
  'ffmpeg is still unpacked',
  unpack.some((pattern) => pattern.includes('ffmpeg-static')),
  unpack
)
check('nothing excludes out/', !common.some((pattern) => /^!out\b/.test(pattern)))

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`)
process.exit(failures === 0 ? 0 : 1)
