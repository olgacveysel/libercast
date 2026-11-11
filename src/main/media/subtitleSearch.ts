import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  ExternalSubtitle,
  SubtitleHit,
  SubtitleSearch,
  SubtitleSearchStatus
} from '@shared/types'
import { OpenSubtitlesClient } from '@main/sources/opensubtitles'
import { getSecret, hasSecret, setSecret } from '@main/secure/credentials'
import { downloadTo } from '@main/util/http'
import { loadSubtitleFile } from './externalSubtitles'
import { createLogger, errorMessage } from '@main/util/logger'

const log = createLogger('subtitle-search')

const KEY = 'opensubtitles.apiKey'
const USER = 'opensubtitles.username'
const PASSWORD = 'opensubtitles.password'

/**
 * Subtitle search, as far as the rest of the application is concerned.
 *
 * The signed-in session is not kept between calls. A JWT from this service
 * expires, and a token cached in a long-running desktop process is a thing
 * that works all day and then quietly does not. Signing in again costs one
 * request against a feature that is about to make another one anyway.
 */

function client(): OpenSubtitlesClient {
  const key = getSecret(KEY)
  if (!key) {
    throw new Error(
      'No OpenSubtitles API key is set. Add one in Settings to search for subtitles.'
    )
  }
  return new OpenSubtitlesClient(key)
}

/** Signs in when an account is stored, and says nothing when it is not. */
async function signedInClient(): Promise<{ client: OpenSubtitlesClient; signedIn: boolean }> {
  const instance = client()
  const username = getSecret(USER)
  const password = getSecret(PASSWORD)
  if (!username || !password) return { client: instance, signedIn: false }

  try {
    await instance.login(username, password)
    return { client: instance, signedIn: true }
  } catch (error) {
    // A stored sign-in that has stopped working must not take searching with
    // it: without an account the allowance is smaller, not absent.
    log.warn('stored OpenSubtitles sign-in failed; continuing anonymously', errorMessage(error))
    return { client: instance, signedIn: false }
  }
}

export function searchStatus(): SubtitleSearchStatus {
  return {
    configured: hasSecret(KEY),
    signedIn: hasSecret(USER) && hasSecret(PASSWORD),
    quota: null
  }
}

export function setApiKey(key: string | null): void {
  setSecret(KEY, key && key.trim() !== '' ? key.trim() : null)
}

export function setAccount(username: string | null, password: string | null): void {
  setSecret(USER, username && username.trim() !== '' ? username.trim() : null)
  setSecret(PASSWORD, password && password !== '' ? password : null)
}

/** Confirms the key works, with the error the service actually gave. */
export async function testApiKey(key?: string): Promise<void> {
  const candidate = key?.trim() ? key.trim() : getSecret(KEY)
  if (!candidate) throw new Error('No OpenSubtitles API key is set.')
  await new OpenSubtitlesClient(candidate).testKey()
}

/** Confirms a sign-in without storing it, so Settings can check before saving. */
export async function testAccount(username: string, password: string): Promise<void> {
  await client().login(username, password)
}

export async function searchSubtitles(search: SubtitleSearch): Promise<SubtitleHit[]> {
  const { client: instance } = await signedInClient()
  const hits = await instance.search(search)
  log.info(`subtitle search for "${search.query}" returned ${hits.length}`)
  return hits
}

/**
 * Fetches one result and turns it into something the player can show.
 *
 * The downloaded file goes through `loadSubtitleFile`, the same path a file
 * picked by hand takes — so the encoding guessing, the SRT and ASS handling
 * and the "this parsed to nothing" check are the ones already proven, rather
 * than a second implementation that would drift from the first.
 *
 * The temporary file is removed afterwards. What the player needs is the
 * WebVTT text, which is already in memory by then.
 */
export async function fetchSubtitle(fileId: number): Promise<ExternalSubtitle> {
  const { client: instance } = await signedInClient()
  const { url, fileName, quota } = await instance.downloadLink(fileId)

  if (quota.remaining !== null) {
    log.info(`subtitle downloaded; ${quota.remaining} left today`)
  }

  const folder = mkdtempSync(join(tmpdir(), 'libercast-subtitle-'))
  const path = join(folder, safeName(fileName))

  try {
    // Deliberately no Api-Key header: the link carries its own token, and the
    // service serves it from somewhere else entirely.
    await downloadTo(url, path, { timeoutMs: 60_000 })
    return await loadSubtitleFile(path)
  } finally {
    await rm(folder, { recursive: true, force: true }).catch(() => undefined)
  }
}

/**
 * A file name from the service, made safe to put on this machine.
 *
 * The name is chosen by whoever uploaded the subtitle, so it is somebody
 * else's string landing on a path — the extension is kept because the loader
 * reads it to decide how to parse, and everything else is reduced to
 * characters that cannot climb out of the folder.
 */
export function safeName(fileName: string): string {
  const cleaned = fileName
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    // Runs of dots go too. With separators already gone a `..` cannot climb
    // anywhere, so this is belt and braces — but the cost is nothing, and it
    // means the guarantee does not quietly depend on the character set above
    // staying exactly as it is.
    .replace(/\.{2,}/g, '_')
    .replace(/^[._-]+/, '')
  const trimmed = cleaned.slice(-80)
  return trimmed === '' || trimmed === '_' ? 'subtitle.srt' : trimmed
}
