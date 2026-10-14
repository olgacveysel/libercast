/**
 * Comparing release versions.
 *
 * Only as much semver as this application ships: major.minor.patch with an
 * optional prerelease tag, which is what `0.9.0-beta.1` is. Build metadata is
 * ignored, as the spec says it should be.
 */

interface Parsed {
  numbers: number[]
  prerelease: string[]
}

export function parseVersion(raw: string): Parsed | null {
  const text = raw.trim().replace(/^v/i, '').split('+')[0] ?? ''
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(text)
  if (!match) return null
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split('.') : []
  }
}

/** -1, 0 or 1. An unparseable version sorts below anything that parses. */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (!left && !right) return 0
  if (!left) return -1
  if (!right) return 1

  for (let i = 0; i < 3; i++) {
    const difference = left.numbers[i]! - right.numbers[i]!
    if (difference !== 0) return difference < 0 ? -1 : 1
  }

  // A version with a prerelease tag is *older* than the same version without
  // one: 0.9.0-beta.1 comes before 0.9.0. Getting this backwards would offer
  // everyone on 0.9.0 an "update" to the beta they already moved past.
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0
  if (left.prerelease.length === 0) return 1
  if (right.prerelease.length === 0) return -1

  for (let i = 0; i < Math.max(left.prerelease.length, right.prerelease.length); i++) {
    const x = left.prerelease[i]
    const y = right.prerelease[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (x === y) continue

    const xNum = /^\d+$/.test(x)
    const yNum = /^\d+$/.test(y)
    // Numeric identifiers compare numerically and rank below alphanumeric
    // ones, so beta.9 precedes beta.10 rather than following it.
    if (xNum && yNum) return Number(x) < Number(y) ? -1 : 1
    if (xNum) return -1
    if (yNum) return 1
    return x < y ? -1 : 1
  }
  return 0
}

/** True when `candidate` is a release worth telling the user about. */
export function isNewer(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0
}
