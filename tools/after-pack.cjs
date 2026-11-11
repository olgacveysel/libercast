/**
 * Stops a build that packed more than it should.
 *
 * Two checks, because the first one was not enough.
 *
 * The size limit was written for one failure: electron-builder excluding its
 * own output directory with a pattern whose empty brace alternative does not
 * match on every platform, so each build packs the previous build's output and
 * the installer grows every time. That one does trip a size limit.
 *
 * The failure that actually happened did not. A platform block's `files` list
 * replaces the top-level one rather than extending it, so for several releases
 * the only exclusions in force on Windows and Linux were four lines about
 * ffprobe binaries — and the package quietly carried the source tree, the test
 * suite, the `.git` directory, and on a working machine whatever else was
 * lying in the folder, a log file among it. That is three megabytes. A size
 * limit will never see it.
 *
 * So the archive's top-level entries are read as well. It is a short list and
 * it is known in advance: `out`, `node_modules`, `package.json`. Anything else
 * arrived by accident.
 */
const { openSync, readSync, closeSync, statSync } = require('node:fs')
const { join } = require('node:path')

/** Anything beyond this is not a dependency, it is a mistake. */
const LIMIT_MB = 60

/**
 * What legitimately sits at the root of the archive.
 *
 * `electron-builder.yml` is in here because electron-builder packs its own
 * configuration and there is no excluding it; it is a few kilobytes and
 * harmless. `resources` is listed in the index but stored outside the archive
 * — `asarUnpack` names it, because the icon and the licence texts have to be
 * real files. Everything else on this list is the application.
 */
const EXPECTED_ENTRIES = new Set([
  'out',
  'node_modules',
  'package.json',
  'electron-builder.yml',
  'resources'
])

/**
 * The top-level names inside an asar.
 *
 * The archive begins with four bytes of pickle framing, a UInt32 at offset 12
 * giving the length of the JSON index, and the index itself at offset 16. Read
 * the same way as tools/asar-report.mjs, and for the same reason: no
 * dependency, because this has to run wherever a package is built.
 */
function topLevelEntries(path) {
  const fd = openSync(path, 'r')
  try {
    const prefix = Buffer.alloc(16)
    readSync(fd, prefix, 0, 16, 0)
    const headerSize = prefix.readUInt32LE(12)
    const header = Buffer.alloc(headerSize)
    readSync(fd, header, 0, headerSize, 16)
    const index = JSON.parse(header.toString('utf8').replace(/\0+$/, ''))
    return Object.keys(index.files ?? {})
  } finally {
    closeSync(fd)
  }
}

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

  let unexpected = []
  try {
    unexpected = topLevelEntries(asar).filter((name) => !EXPECTED_ENTRIES.has(name))
  } catch (error) {
    // A header this cannot read is not a reason to fail a build; the size
    // check below still applies.
    console.log(`  • could not read the asar index (${error.message})`)
  }

  if (unexpected.length > 0) {
    throw new Error(
      `app.asar contains ${unexpected.length} thing(s) that do not belong in it:\n` +
        unexpected.map((name) => `    ${name}`).join('\n') +
        '\n\nThe "files" list did not exclude them. Check that the entry is in\n' +
        'ALL THREE lists in electron-builder.yml — the top-level one and the\n' +
        'copies under "win:" and "linux:" — because a platform block replaces\n' +
        'the top-level list rather than adding to it.\n\n' +
        'node tools/asar-report.mjs  shows what is inside and how big it is.'
    )
  }

  const mb = size / 1048576
  if (mb <= LIMIT_MB) {
    console.log(`  • app.asar is ${mb.toFixed(1)} MB, and holds only what it should`)
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
