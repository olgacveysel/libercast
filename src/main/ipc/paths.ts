import { isAbsolute } from 'node:path'

/**
 * Checking the arguments that become files and processes.
 *
 * Every IPC payload arrives as whatever the renderer sent and is trusted by
 * its declared type, which exists only at compile time. For almost every
 * channel that is fine: the renderer is ours, it runs with no Node access and
 * behind context isolation, and a wrong number reaches a bound SQL parameter
 * and fails harmlessly.
 *
 * Three arguments are not like the others. `ffmpegPath` is a path this
 * application then *executes*; `recordingsPath` and `downloadsPath` are
 * directories it writes into. Those are the ones worth checking, because they
 * are the ones where a bad string stops being a bad string.
 *
 * This is deliberately not a schema layer over all hundred-odd channels. That
 * would be a large piece of work justified by a threat this design already
 * answers — and a hundred validators nobody reads is its own kind of risk.
 */

/** Long enough for any real path, short enough to be no use as a payload. */
const MAX_PATH = 4096

export function checkPathSetting(label: string, value: unknown): string | null {
  if (value === null || value === undefined) return null

  if (typeof value !== 'string') {
    throw new Error(`${label} must be a path, not a ${typeof value}.`)
  }

  const path = value.trim()
  if (path === '') return null

  if (path.length > MAX_PATH) throw new Error(`${label} is too long to be a path.`)

  // A NUL ends the string for the operating system but not for JavaScript, so
  // "/tmp/ok\0/../../etc" is two different paths depending on who is reading.
  // Node rejects these itself; saying so here gives a better message than the
  // ERR_INVALID_ARG_VALUE that would otherwise surface hours later.
  if (path.includes('\0')) throw new Error(`${label} contains an invalid character.`)

  /*
   * Relative paths resolve against the working directory, which for a
   * packaged application is wherever it happened to be launched from —
   * somewhere the user did not choose and cannot predict.
   *
   * Both platforms' spellings are accepted rather than only the host's.
   * `path.isAbsolute` answers for the platform it is running on, so a Windows
   * path is "relative" on Linux and the rule would mean different things in
   * the test suite and in the shipped application. A drive letter or a UNC
   * share on a Linux machine is merely a path that will not open, which is a
   * clear failure at the moment of use; the rule here is about not silently
   * resolving somewhere unexpected.
   */
  const windowsAbsolute = /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('\\\\')
  if (!isAbsolute(path) && !windowsAbsolute) throw new Error(`${label} must be a full path.`)

  return path
}

/** The settings whose values are handed to the filesystem or to `spawn`. */
export const PATH_SETTINGS = ['ffmpegPath', 'recordingsPath', 'downloadsPath'] as const

export function checkPathSettings(patch: Record<string, unknown>): void {
  for (const key of PATH_SETTINGS) {
    if (key in patch) checkPathSetting(key, patch[key])
  }
}
