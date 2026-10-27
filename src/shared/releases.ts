import { compareVersions, isNewer } from './version'

/** The fields this application reads from a GitHub release. */
export interface ReleaseSummary {
  tag_name?: string | null
  html_url?: string | null
  draft?: boolean
  prerelease?: boolean
  published_at?: string | null
}

export interface AvailableUpdate {
  version: string
  url: string
  prerelease: boolean
  publishedAt: string | null
}

/**
 * The newest release worth offering, or null.
 *
 * Separated from the fetching so it can be checked against the shapes GitHub
 * actually returns — including the ones that would otherwise nag every user:
 * drafts, and prereleases older than what they are running.
 *
 * `allowPrerelease` follows what the user is running. Someone on 0.9.0-beta.1
 * is already testing betas and wants the next one; someone on a stable release
 * should not be pulled back onto a beta line.
 */
export function pickUpdate(
  releases: ReleaseSummary[],
  current: string,
  allowPrerelease: boolean
): AvailableUpdate | null {
  let best: AvailableUpdate | null = null

  for (const release of releases) {
    // A draft is visible only to the people who can publish it, and is not
    // something to point a user at.
    if (release.draft) continue
    if (release.prerelease && !allowPrerelease) continue

    const tag = (release.tag_name ?? '').trim()
    if (!tag || !isNewer(tag, current)) continue

    const url = (release.html_url ?? '').trim()
    if (!url.startsWith('https://github.com/')) continue

    if (best === null || compareVersions(tag, best.version) > 0) {
      best = {
        version: tag.replace(/^v/i, ''),
        url,
        prerelease: release.prerelease === true,
        publishedAt: release.published_at ?? null
      }
    }
  }

  return best
}

/** Whether the version being run is itself a prerelease. */
export function onPrereleaseLine(current: string): boolean {
  return /-/.test(current.trim())
}

/**
 * How long a check is good for.
 *
 * Once a day is often enough to hear about a build within a day of it
 * existing, and rare enough that someone who leaves the application open for a
 * week makes seven requests rather than one per launch of their machine.
 */
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

export interface CheckSchedule {
  autoCheckUpdates: boolean | null
  lastUpdateCheck: number | null
}

/**
 * Whether to ask GitHub on this launch.
 *
 * `null` — nobody has been asked yet — behaves exactly like `false`. That is
 * the whole point: until the user answers the prompt, the application makes no
 * request it was not told to make, and the installer's notice stays true.
 */
export function shouldCheckNow(settings: CheckSchedule, now = Date.now()): boolean {
  if (settings.autoCheckUpdates !== true) return false

  const last = settings.lastUpdateCheck
  if (last === null || !Number.isFinite(last)) return true

  // A clock that has gone backwards — a timezone change, a correction, a
  // restored backup — must not lock checking out until it catches up.
  if (last > now) return true

  return now - last >= CHECK_INTERVAL_MS
}

export interface RememberedUpdate {
  knownUpdateVersion: string | null
  knownUpdateUrl: string | null
  dismissedUpdate: string | null
}

/**
 * The update worth putting on screen right now, from what was remembered.
 *
 * Re-checks that the remembered version is still newer than what is running:
 * after updating, the note has to disappear on its own rather than waiting for
 * the next check to clear it.
 */
export function bannerUpdate(
  remembered: RememberedUpdate,
  current: string
): { version: string; url: string } | null {
  const version = remembered.knownUpdateVersion?.trim()
  const url = remembered.knownUpdateUrl?.trim()

  if (!version || !url) return null
  if (!url.startsWith('https://github.com/')) return null
  if (!isNewer(version, current)) return null
  if (remembered.dismissedUpdate === version) return null

  return { version, url }
}
