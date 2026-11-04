/**
 * The ffmpeg the harnesses use to make their fixtures.
 *
 * They used to call a bare `ffmpeg`, which works on any machine that happens
 * to have one on PATH — this container does, so the harnesses passed here and
 * told us nothing about anywhere else. A continuous-integration runner is
 * exactly the machine that might not, and the failure there is an opaque
 * ENOENT from deep inside a test.
 *
 * The application already ships ffmpeg as a dependency, so it is present
 * after `npm ci` on every platform. That is the one to use: no extra install
 * step, no PATH assumption, and the same binary the application itself plays
 * through.
 */
const { existsSync } = require('node:fs')

function ffmpegPath() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const bundled = require('ffmpeg-static')
    if (typeof bundled === 'string' && bundled !== '' && existsSync(bundled)) return bundled
  } catch {
    // Not installed — fall through to whatever the machine has.
  }
  return 'ffmpeg'
}

module.exports = { ffmpegPath }
