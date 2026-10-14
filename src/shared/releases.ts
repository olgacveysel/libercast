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
