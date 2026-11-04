/**
 * The application's real default settings, for the preload stubs.
 *
 * Hand-written copies of `DEFAULT_SETTINGS` lived in every stub and drifted
 * from it every time a setting was added — silently, because a missing
 * setting is `undefined` rather than an error, and the interface simply
 * renders in a state no user has. That is how a harness came to be asserting
 * against a channel list collapsed to zero width.
 *
 * Bundled by `tools/verify-all.mjs` before the harnesses run.
 */
const { join } = require('node:path')

function defaults() {
  const bundled = join(
    __dirname, '..', '..', 'node_modules', '.cache', 'verify', 'settings.cjs'
  )
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { DEFAULT_SETTINGS } = require(bundled)
  if (!DEFAULT_SETTINGS) throw new Error('DEFAULT_SETTINGS missing from the bundle')
  return { ...DEFAULT_SETTINGS }
}

module.exports = { defaults }
