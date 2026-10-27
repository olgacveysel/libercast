import { app } from 'electron'
import { REPOSITORY } from '@shared/app'
import {
  onPrereleaseLine,
  pickUpdate,
  shouldCheckNow,
  type AvailableUpdate,
  type ReleaseSummary
} from '@shared/releases'
import { getSettings, setSettings } from '@main/db/repo/settings'
import { requestJson } from '@main/util/http'
import { createLogger, errorMessage } from '@main/util/logger'

const log = createLogger('updates')

/**
 * Asks GitHub whether there is a newer release.
 *
 * Called from the button in Settings, and — only once someone has explicitly
 * turned it on — once a day at launch. The installer's notice promises that
 * nothing leaves the machine except the requests the user makes, which is why
 * the automatic check is off until it is answered for rather than on until it
 * is switched off.
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

/**
 * The launch check, when the user has asked for one.
 *
 * Deliberately quiet about everything except success: a laptop that opened the
 * application on a train has no network, and that is not news. What it finds
 * is written to the settings rather than only pushed to the renderer, so the
 * answer survives a restart without asking GitHub again.
 */
export async function checkOnLaunch(): Promise<AvailableUpdate | null> {
  if (!shouldCheckNow(getSettings())) return null

  const { update, error } = await checkForUpdate()

  // The timestamp moves even when the check failed. Retrying every launch
  // against a host that is refusing us is how an opt-in courtesy turns into a
  // flood someone has to go and switch off.
  setSettings({
    lastUpdateCheck: Date.now(),
    ...(error === null
      ? { knownUpdateVersion: update?.version ?? null, knownUpdateUrl: update?.url ?? null }
      : {})
  })

  return update
}
