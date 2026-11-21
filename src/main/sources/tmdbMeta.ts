import type { TmdbMeta, TmdbStatus, VodInfo } from '@shared/types'
import { getChannel } from '@main/db/repo/catalog'
import * as cache from '@main/db/repo/tmdb'
import { getSecret, hasSecret, setSecret } from '@main/secure/credentials'
import { createLogger, errorMessage } from '@main/util/logger'
import { TmdbClient } from './tmdb'

const log = createLogger('tmdb')

const KEY = 'tmdb.apiKey'

/**
 * Metadata enrichment, as far as the rest of the application is concerned.
 *
 * Off entirely until the user supplies a key, and that is the whole design
 * rather than a limitation: LiberCast's source is public, so a key shipped
 * inside it is a key anybody can extract, and the account suspended over
 * somebody else's use of it would be the maintainer's. The same reasoning
 * settled subtitle search, and the two features are deliberately the same
 * shape so that a user who has set one up recognises the other.
 */

export function status(): TmdbStatus {
  const present = hasSecret(KEY)
  return { hasKey: present, enabled: present }
}

export function setApiKey(key: string | null): void {
  setSecret(KEY, key)

  // Clearing the key clears what it fetched. Metadata obtained with somebody's
  // key is theirs, and leaving it behind after they have withdrawn the key is
  // keeping something they asked to stop providing.
  if (key === null) {
    const dropped = cache.forgetAll()
    if (dropped > 0) log.info(`cleared ${dropped} cached lookup(s) with the key`)
  }
}

export async function testApiKey(key?: string): Promise<void> {
  const candidate = key ?? getSecret(KEY)
  if (!candidate) throw new Error('Enter an API key first.')
  await new TmdbClient(candidate).testKey()
}

function client(): TmdbClient {
  const key = getSecret(KEY)
  if (!key) throw new Error('No TMDB API key is set. Add one in Settings to look up metadata.')
  return new TmdbClient(key)
}

/**
 * What TMDB knows about a title, from the cache when possible.
 *
 * A miss is recorded as deliberately as a match. A provider's film category
 * carries rows that are not films — a 24/7 channel, a category header that
 * became an entry — and without remembering that nothing matched, every one
 * of them is searched for again on every visit, spending the user's rate
 * limit on a question already answered.
 */
export async function lookup(channelId: number): Promise<TmdbMeta | null> {
  const cached = cache.getCached(channelId)
  if (cached && !cache.isStale(cached)) return cached.meta

  const channel = getChannel(channelId)
  if (!channel) throw new Error('That title is no longer in the catalogue')
  if (channel.kind !== 'movie' && channel.kind !== 'series') return null

  const title = searchTitle(channel.name)
  if (!title) return null

  try {
    const found = await client().find(channel.kind, title, channel.year ?? null)
    cache.remember(channelId, found)
    if (!found) log.debug(`nothing on TMDB for "${title}"`)
    return found
  } catch (error) {
    // A failed lookup is not recorded: a rate limit or a dropped connection
    // says nothing about whether the title exists, and recording it as a miss
    // would hide the title for a month over a momentary problem.
    log.warn(`TMDB lookup failed for "${title}"`, errorMessage(error))
    throw error
  }
}

/**
 * Fills the gaps in what the provider sent, and only the gaps.
 *
 * The provider's own values win, every time. That is not politeness — it is
 * the only safe rule when the match is made by title: a search can return a
 * remake, a documentary about the film, or an entirely different work with
 * the same name, and overwriting a correct local plot with a confident wrong
 * one is worse than the empty space it replaced. A field the provider filled
 * is a field somebody can be sure about.
 *
 * Never throws. Enrichment is a decoration on a screen whose job is to play
 * something; a rate limit or a dropped connection must not stop the film
 * opening.
 */
export async function enrich(channelId: number, info: VodInfo | null): Promise<VodInfo | null> {
  if (!status().enabled) return info

  let meta: TmdbMeta | null
  try {
    meta = await lookup(channelId)
  } catch {
    return info
  }
  if (!meta) return info

  const base: VodInfo = info ?? {
    channelId,
    plot: null,
    cast: null,
    director: null,
    genre: null,
    releaseDate: null,
    rating: null,
    durationSecs: null,
    backdropUrl: null,
    trailerId: null
  }

  return {
    ...base,
    plot: base.plot ?? meta.plot,
    cast: base.cast ?? (meta.cast.length > 0 ? meta.cast.join(', ') : null),
    director: base.director ?? meta.director,
    genre: base.genre ?? (meta.genres.length > 0 ? meta.genres.join(', ') : null),
    // A year rather than a full date: it is what TMDB's search answers with
    // and what the interface displays, and inventing a day and month from a
    // year would be stating more than is known.
    releaseDate: base.releaseDate ?? (meta.year === null ? null : String(meta.year)),
    rating: base.rating ?? meta.rating,
    durationSecs: base.durationSecs ?? meta.runtimeSecs,
    backdropUrl: base.backdropUrl ?? meta.backdropUrl
  }
}

/**
 * The part of a provider's name worth searching for.
 *
 * Provider catalogues decorate titles heavily — a language tag at the front,
 * a quality marker at the end, a year in brackets, the extension left on.
 * Searching for the decorated string finds nothing, and "nothing" then gets
 * cached as the answer.
 */
export function searchTitle(name: string): string {
  let title = name.trim()

  // A leading tag in brackets or pipes: "|TR| Title", "[4K] Title".
  title = title.replace(/^\s*[[|(][^)\]|]{1,12}[\])|]\s*/, '')

  // A trailing file extension a provider forgot to strip.
  title = title.replace(/\.(mkv|mp4|avi|ts|m4v)$/i, '')

  /*
   * A year, in brackets or bare, and everything after it — which is where
   * the quality markers live.
   *
   * Unless that removes the whole title: "1917" is a film, and a trim that
   * leaves nothing to search for does not fail loudly. It searches for
   * something arbitrary, or for nothing, and the nothing is then cached as
   * the answer for a month.
   */
  const withoutYear = title.replace(/[([]?\b(19|20)\d{2}\b[)\]]?.*$/, '')
  if (withoutYear.trim()) title = withoutYear

  // Quality and source markers wherever they sit.
  title = title.replace(
    /\b(4k|uhd|fhd|hd|sd|1080p?|720p?|2160p?|web-?dl|webrip|bluray|bdrip|hdrip|x264|x265|hevc|dub|dublaj|altyazili|turkce)\b/gi,
    ' '
  )

  // Separators providers use instead of spaces.
  title = title.replace(/[._]+/g, ' ')

  return title.replace(/\s{2,}/g, ' ').trim()
}
