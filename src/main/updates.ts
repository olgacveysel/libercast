import { app } from 'electron'
import { REPOSITORY } from '@shared/app'
import { pickUpdate, onPrereleaseLine, type AvailableUpdate, type ReleaseSummary } from '@shared/releases'
import { requestJson } from '@main/util/http'
import { createLogger, errorMessage } from '@main/util/logger'

const log = createLogger('updates')

/**
 * Asks GitHub whether there is a newer release.
 *
 * Only ever called from a button. The installer's notice promises that nothing
 * leaves the machine except the requests the user makes, and a check that ran
 * on its own at startup would quietly make that false.
 *
 * Returns null both for "nothing newer" and for "could not tell" — the caller
 * gets the reason separately, because a failed check is worth showing but is
 * not an update.
 */
export async function checkForUpdate(): Promise<{
  update: AvailableUpdate | null
  current: string
  error: string | null
}> {
  const current = app.getVersion()

  try {
    const releases = await requestJson<ReleaseSummary[]>(
      `https://api.github.com/repos/${REPOSITORY}/releases?per_page=20`,
      {
        timeoutMs: 8000,
        // GitHub rejects requests with no User-Agent outright, and the shared
        // browser string this application sends everywhere else is not a
        // courteous thing to point at someone's API.
        userAgent: `LiberCast/${current} (+https://github.com/${REPOSITORY})`
      }
    )

    const update = pickUpdate(
      Array.isArray(releases) ? releases : [],
      current,
      onPrereleaseLine(current)
    )
    log.info(update ? `update available: ${update.version}` : 'no newer release')
    return { update, current, error: null }
  } catch (error) {
    // Offline, rate-limited, or the repository moved. None of these are worth
    // a dialog, but the Settings screen should say what happened.
    log.warn('update check failed', errorMessage(error))
    return { update: null, current, error: errorMessage(error) }
  }
}
