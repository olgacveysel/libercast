/**
 * Stops a build that packed more than it should.
 *
 * electron-builder excludes its own output directory with a pattern whose empty
 * brace alternative does not match on every platform. When that silently fails,
 * each build packs the previous build's output: the installer grows every time,
 * nothing reports an error, and the first sign of trouble is a download that is
 * five times the size it should be.
 *
 * The application's own code and its production dependencies come to about
 * 13 MB. The limit here is generous enough that adding a real dependency will
 * not trip it, and tight enough that a directory landing in the package by
 * accident will.
 */
const { statSync } = require('node:fs')
const { join } = require('node:path')

/** Anything beyond this is not a dependency, it is a mistake. */
const LIMIT_MB = 60

exports.default = async function afterPack(context) {
  const asar = join(context.appOutDir, 'resources', 'app.asar')

  let size
  try {
    size = statSync(asar).size
  } catch {
    // asar disabled, or a target that does not produce one. Not this hook's
    // business to complain about.
    return
  }

  const mb = size / 1048576
  if (mb <= LIMIT_MB) {
    console.log(`  • app.asar is ${mb.toFixed(1)} MB`)
    return
  }

  throw new Error(
    `app.asar is ${mb.toFixed(1)} MB, over the ${LIMIT_MB} MB limit.\n\n` +
      'Something is being packaged that should not be. Run\n' +
      '  node tools/asar-report.mjs\n' +
      'to see what is inside it, then exclude that path in the "files" list in\n' +
      'electron-builder.yml. A "release" entry in that report means the build\n' +
      "packed the previous build's output."
  )
}
