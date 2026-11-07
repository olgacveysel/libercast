import type { ParsedCatalog, ParsedCategory, ParsedChannel, ParsedProgramme } from './types'
import { request, type FetchOptions } from '@main/util/http'
import { createLogger } from '@main/util/logger'
import { vodAddedAtText, vodRating, vodYear } from './vodMeta'

const log = createLogger('stalker')

/**
 * A Stalker / Ministra portal, the middleware MAG set-top boxes talk to.
 *
 * Two things make this unlike the other sources.
 *
 * The first is that the MAC address is the credential. There is no password:
 * the provider issues a MAC, registers it against a subscription, and the box
 * presents it in a cookie. So the MAC is treated as a secret everywhere — it is
 * redacted from logs alongside the Xtream passwords, for the same reason.
 *
 * The second is that channels have no stable URL. Each carries a `cmd` string,
 * and a `create_link` call exchanges it for a URL that is short-lived and
 * sometimes single-use. Nothing playable can be stored at sync time, so the
 * catalogue stores the `cmd` and the link is fetched when the user presses
 * play. That is why `resolveProviderStream` is asynchronous.
 *
 * Portals disagree about almost everything else — which path answers, whether
 * a list is paginated, whether a number arrives as a number — so every read of
 * a response goes through the coercions at the bottom of this file rather than
 * trusting a shape.
 */

export interface StalkerCredentials {
  /** Whatever the provider wrote down, in whatever form they wrote it. */
  portalUrl: string
  /** The MAC the provider issued. Never one this application invented. */
  macAddress: string
  /** The portal's own timezone, when the user knows it. */
  timezone?: string | null
}

export interface StalkerAccount {
  /** What the portal calls this subscription, when it says. */
  login: string | null
  /** Unix ms, or null when the portal does not say. */
  expiresAt: number | null
  /** The portal's wording for the account state, shown as-is. */
  status: string | null
  timezone: string | null
}

/**
 * The prefix the portal puts in front of the URL it hands back.
 *
 * `create_link` answers things like "ffmpeg http://host/play/live.php?…".
 * The word is an instruction to the set-top box about which player to use, and
 * it is not part of the address. Leaving it on produces a URL that fails with
 * a message about the protocol, which points nowhere near the cause.
 */
const LINK_PREFIX = /^\s*(ffmpeg|ffrt\d*|auto|extension|matrix|pvr|mpegts|rtmp_auto)\s+/i

/**
 * The paths a portal might answer on.
 *
 * Providers hand out the URL in whichever form their panel happened to show
 * them: sometimes the portal root, sometimes the page a browser would open,
 * sometimes the endpoint itself. None of them is more correct than the others,
 * and the difference is invisible to the person pasting it — so rather than
 * demanding one spelling, the first one that answers a handshake is used.
 */
const CANDIDATE_PATHS = [
  '/portal.php',
  '/server/load.php',
  '/stalker_portal/server/load.php',
  '/c/portal.php',
  '/stalker_portal/c/portal.php',
  '/magLoad.php'
]

/**
 * What a MAG box says about itself.
 *
 * Portals do check some of this — a few refuse a handshake from something that
 * does not look like a set-top box — so these are the values a MAG250 reports,
 * and they are constants rather than settings because they describe the device
 * being emulated, not a preference.
 */
const STB = {
  userAgent:
    'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) ' +
    'MAG200 stbapp ver: 2 rev: 250 Safari/533.3',
  xUserAgent: 'Model: MAG250; Link: WiFi',
  type: 'MAG250',
  hwVersion: '1.7-BD-00',
  imageVersion: '218',
  apiSignature: '263'
} as const

/** How many pages of a channel list are worth walking before giving up. */
const MAX_PAGES = 200

export class StalkerClient {
  private token: string | null = null
  private profiled = false
  /** Settled on the first successful handshake and reused after that. */
  private endpoint: string | null = null

  constructor(
    private readonly credentials: StalkerCredentials,
    private readonly options: FetchOptions = {}
  ) {}

  /** The MAC, normalised to the upper-case colon form portals expect. */
  get mac(): string {
    return normalizeMac(this.credentials.macAddress)
  }

  /**
   * Handshake, then profile.
   *
   * Both are needed before anything else will answer: the handshake issues the
   * token and `get_profile` is what associates it with this MAC. A portal that
   * is reached but refuses the MAC fails here, which is the error worth
   * showing — it means the subscription, not the address.
   */
  async authenticate(): Promise<StalkerAccount> {
    if (this.token && this.profiled) return this.accountFromCache()

    // Finding the endpoint *is* the handshake: it settles on the first address
    // that answers with a token, and keeps it. Shaking hands again here would
    // be a second round trip to learn something already known.
    const endpoint = await this.resolveEndpoint()
    if (!this.token) {
      throw new Error(
        'The portal answered the handshake without a token. ' +
          'This usually means the address reaches a web server but not a portal.'
      )
    }

    await this.call(endpoint, {
      type: 'stb',
      action: 'get_profile',
      hd: '1',
      ver: STB.imageVersion,
      num_banks: '2',
      sn: serialFor(this.mac),
      stb_type: STB.type,
      client_type: 'STB',
      image_version: STB.imageVersion,
      video_out: 'hdmi',
      device_id: '',
      device_id2: '',
      signature: '',
      auth_second_step: '0',
      hw_version: STB.hwVersion,
      not_valid_token: '0',
      api_signature: STB.apiSignature,
      prehash: ''
    })
    this.profiled = true

    const info = await this.accountInfo()
    log.info(`portal ${endpoint} authenticated`)
    return info
  }

  /** What the portal says about the subscription. Never fatal. */
  private async accountInfo(): Promise<StalkerAccount> {
    const endpoint = await this.resolveEndpoint()
    try {
      const raw = await this.call<Record<string, unknown>>(endpoint, {
        type: 'account_info',
        action: 'get_main_info'
      })

      return {
        login: text(raw?.['login'] ?? raw?.['name']),
        expiresAt: expiryMs(raw?.['end_date'] ?? raw?.['phone'] ?? raw?.['expire_billing_date']),
        status: text(raw?.['status']),
        timezone: this.credentials.timezone ?? null
      }
    } catch (error) {
      // Plenty of portals simply do not answer this one. It is a nicety, and
      // failing a whole sync over a nicety would be absurd.
      log.warn('portal did not report account info', error)
      return this.accountFromCache()
    }
  }

  private accountFromCache(): StalkerAccount {
    return {
      login: null,
      expiresAt: null,
      status: null,
      timezone: this.credentials.timezone ?? null
    }
  }

  /**
   * The live catalogue: genres as categories, channels as channels.
   *
   * The channel's `cmd` is stored where other sources store a URL. It is not
   * one, and `resolveProviderStream` knows that — see the note at the top.
   */
  async liveCatalog(onProgress?: (loaded: number, total: number | null) => void): Promise<ParsedCatalog> {
    await this.authenticate()
    const endpoint = await this.resolveEndpoint()

    const categories = await this.genres(endpoint)
    const channels = await this.channels(endpoint, onProgress)

    log.info(
      `portal catalogue: ${channels.length} channels in ${categories.length} genres ` +
        `from ${endpoint}`
    )

    return { kind: 'live', categories, channels }
  }

  private async genres(endpoint: string): Promise<ParsedCategory[]> {
    const raw = await this.call<unknown>(endpoint, { type: 'itv', action: 'get_genres' })
    const rows = Array.isArray(raw) ? raw : []

    return rows
      .map((row) => asRecord(row))
      .filter((row): row is Record<string, unknown> => row !== null)
      .map((row) => ({ externalId: text(row['id']) ?? '', name: text(row['title']) ?? '' }))
      // "All" is a pseudo-genre the portal uses for its own menu; it is not a
      // category and listing it would duplicate the entire catalogue.
      .filter((category) => category.externalId !== '' && category.externalId !== '*')
      .filter((category) => category.name !== '')
  }

  /**
   * Every channel, however the portal wants to give them up.
   *
   * `get_all_channels` returns the lot in one response and is far cheaper, so
   * it is tried first; portals that do not implement it fall back to walking
   * `get_ordered_list` a page at a time.
   */
  private async channels(
    endpoint: string,
    onProgress?: (loaded: number, total: number | null) => void
  ): Promise<ParsedChannel[]> {
    try {
      const raw = await this.call<Record<string, unknown>>(endpoint, {
        type: 'itv',
        action: 'get_all_channels'
      })
      const rows = listOf(raw)
      if (rows.length > 0) {
        const channels = rows.map((row) => toChannel(row)).filter(isChannel)
        reportUnreadable('get_all_channels', rows, channels.length)
        if (channels.length > 0) {
          onProgress?.(channels.length, channels.length)
          return channels
        }
      } else {
        log.info('get_all_channels answered with nothing; falling back to paging')
      }
    } catch (error) {
      log.info('portal does not support get_all_channels; falling back to paging', error)
    }

    const channels: ParsedChannel[] = []
    const seen = new Set<string>()
    let total: number | null = null

    for (let page = 1; page <= MAX_PAGES; page++) {
      const raw = await this.call<Record<string, unknown>>(endpoint, {
        type: 'itv',
        action: 'get_ordered_list',
        genre: '*',
        force_ch_link_check: '',
        fav: '0',
        sortby: 'number',
        hd: '0',
        p: String(page)
      })

      const rows = listOf(raw)
      if (rows.length === 0) break

      if (total === null) total = number(raw['total_items'])
      if (page === 1) reportUnreadable('get_ordered_list', rows, countChannels(rows))

      let added = 0
      for (const row of rows) {
        const channel = toChannel(row)
        // A portal that ignores `p` answers page two with page one, forever.
        // Counting what is actually new is what stops that being an infinite
        // loop rather than trusting it to paginate.
        if (!isChannel(channel) || seen.has(channel.externalId)) continue
        seen.add(channel.externalId)
        channels.push(channel)
        added++
      }

      onProgress?.(channels.length, total)
      if (added === 0) break
      if (total !== null && channels.length >= total) break
    }

    return channels
  }

  /**
   * Films, and the portal's own categories for them.
   *
   * Separate from live TV in more than name: a portal keeps VOD under
   * `type=vod`, pages it rather than offering anything like
   * `get_all_channels`, and insists on a `category` — `*` for everything.
   *
   * A portal that sells only live TV answers this with nothing, or 404s the
   * action outright. That is a normal portal, not a broken one, so an empty
   * result is returned rather than thrown; the caller decides what no films
   * means.
   */
  async movieCatalog(
    onProgress?: (loaded: number, total: number | null) => void
  ): Promise<ParsedCatalog> {
    return this.vodCatalog('vod', 'movie', onProgress)
  }

  /**
   * Series, as the portal lists them.
   *
   * What comes back is the shows, not their episodes. A portal addresses an
   * episode by the show's `cmd` plus a series number, which is a different
   * shape from the season-and-episode tree the rest of this application is
   * built around — so the episodes are left for their own pass rather than
   * guessed at here. Browsing the shows is what this gives.
   */
  async seriesCatalog(
    onProgress?: (loaded: number, total: number | null) => void
  ): Promise<ParsedCatalog> {
    return this.vodCatalog('series', 'series', onProgress)
  }

  private async vodCatalog(
    type: 'vod' | 'series',
    kind: 'movie' | 'series',
    onProgress?: (loaded: number, total: number | null) => void
  ): Promise<ParsedCatalog> {
    await this.authenticate()
    const endpoint = await this.resolveEndpoint()

    const categories = await this.vodCategories(endpoint, type)
    const channels = await this.vodItems(endpoint, type, kind, onProgress)

    log.info(`portal ${type} catalogue: ${channels.length} items in ${categories.length} categories`)

    return { kind, categories, channels }
  }

  private async vodCategories(endpoint: string, type: 'vod' | 'series'): Promise<ParsedCategory[]> {
    let raw: unknown
    try {
      raw = await this.call<unknown>(endpoint, { type, action: 'get_categories' })
    } catch (error) {
      log.info(`portal has no ${type} categories`, error)
      return []
    }

    const rows = Array.isArray(raw) ? raw : []
    return rows
      .map((row) => asRecord(row))
      .filter((row): row is Record<string, unknown> => row !== null)
      .map((row) => ({ externalId: text(row['id']) ?? '', name: text(row['title']) ?? '' }))
      // As with genres, `*` is the portal's own "everything" menu entry.
      .filter((category) => category.externalId !== '' && category.externalId !== '*')
      .filter((category) => category.name !== '')
  }

  private async vodItems(
    endpoint: string,
    type: 'vod' | 'series',
    kind: 'movie' | 'series',
    onProgress?: (loaded: number, total: number | null) => void
  ): Promise<ParsedChannel[]> {
    const items: ParsedChannel[] = []
    const seen = new Set<string>()
    let total: number | null = null

    for (let page = 1; page <= MAX_PAGES; page++) {
      let raw: Record<string, unknown>
      try {
        raw = await this.call<Record<string, unknown>>(endpoint, {
          type,
          action: 'get_ordered_list',
          category: '*',
          // Newest first, so a portal with more pages than MAX_PAGES gives up
          // the half worth having rather than an arbitrary half.
          sortby: 'added',
          fav: '0',
          hd: '0',
          p: String(page)
        })
      } catch (error) {
        // A portal that sells no VOD refuses the action rather than answering
        // an empty list. On the first page that means "none"; later it means
        // the walk ended early, and what was collected still stands.
        log.info(`portal stopped answering ${type} at page ${page}`, error)
        break
      }

      const rows = listOf(raw)
      if (rows.length === 0) break

      if (total === null) total = number(raw['total_items'])
      if (page === 1) {
        reportUnreadable(
          `${type}/get_ordered_list`,
          rows,
          rows.filter((row) => toVodItem(row, kind) !== null).length
        )
      }

      let added = 0
      for (const row of rows) {
        const item = toVodItem(row, kind)
        // Same guard as the channel walk: a portal that ignores `p` answers
        // every page with page one, and counting what is new is what stops
        // that being an endless loop.
        if (!item || seen.has(item.externalId)) continue
        seen.add(item.externalId)
        items.push(item)
        added++
      }

      onProgress?.(items.length, total)
      if (added === 0) break
      if (total !== null && items.length >= total) break
    }

    return items
  }

  /**
   * Turns a stored `cmd` into something playable, now.
   *
   * The result is short-lived and on some portals single-use, so it is never
   * cached: every play asks again. That is one small request against a
   * subscription that is about to open a stream anyway.
   */
  async streamUrl(cmd: string, channelId?: string): Promise<string> {
    await this.authenticate()
    const endpoint = await this.resolveEndpoint()

    const attempts = linkAttempts(cmd, channelId)
    const refusals: string[] = []

    for (const attempt of attempts) {
      const raw = await this.call<Record<string, unknown>>(endpoint, {
        type: 'itv',
        action: 'create_link',
        cmd: attempt.cmd,
        series: '',
        forced_storage: 'undefined',
        disable_ad: '0',
        download: '0',
        force_ch_link_check: '0'
      })

      const answer = text(raw?.['cmd']) ?? text(raw?.['id'])
      if (!answer) {
        refusals.push(`${attempt.name}: no link in the answer`)
        continue
      }

      const url = stripLinkPrefix(answer)
      if (!/^https?:\/\//i.test(url)) {
        refusals.push(`${attempt.name}: not a URL (${url.slice(0, 60)})`)
        continue
      }

      // The failure this exists for. A portal that does not recognise the cmd
      // does not say so: it builds its play URL anyway, with the channel id
      // left blank, and answers 200. Handed on, that URL reaches ffmpeg, comes
      // back 4xx, and reads as a dead channel — so the portal looks broken and
      // the real cause, that we asked in a form it does not use, is invisible.
      if (hasBlankStreamId(url)) {
        refusals.push(`${attempt.name}: answered with an empty stream id`)
        continue
      }

      if (attempt.name !== 'stored') {
        log.info(`portal accepted the "${attempt.name}" cmd form for channel ${channelId ?? '?'}`)
      }
      return url
    }

    // Everything here is what the next person needs and cannot get any other
    // way: the forms tried, what the portal said to each, and the cmd as the
    // catalogue stored it.
    throw new Error(
      `The portal would not turn this channel into a link. Tried ${attempts.length} ` +
        `form(s): ${refusals.join('; ')}. The stored command was "${cmd.slice(0, 80)}".`
    )
  }

  /**
   * The portal's own guide for one channel.
   *
   * Stalker portals carry a guide of their own, which is the only one a MAG
   * subscription comes with — there is usually no XMLTV URL to point at.
   */
  async shortEpg(channelId: string, limit = 20): Promise<ParsedProgramme[]> {
    await this.authenticate()
    const endpoint = await this.resolveEndpoint()

    const raw = await this.call<Record<string, unknown>>(endpoint, {
      type: 'itv',
      action: 'get_short_epg',
      ch_id: channelId,
      size: String(limit)
    })

    return listOf(raw)
      .map((row) => toProgramme(channelId, row))
      .filter((programme): programme is ParsedProgramme => programme !== null)
  }

  /**
   * Finds the path this portal answers on, once.
   *
   * Tried in order and settled on the first handshake that comes back with a
   * token. A portal that answers none of them produces an error naming every
   * address tried, because "could not connect" is useless to someone holding a
   * URL their provider gave them.
   */
  private async resolveEndpoint(): Promise<string> {
    if (this.endpoint) return this.endpoint

    const bases = candidateEndpoints(this.credentials.portalUrl)
    const failures: string[] = []

    for (const candidate of bases) {
      try {
        const answer = await this.call<{ token?: string }>(
          candidate,
          { type: 'stb', action: 'handshake', token: '' },
          { authenticated: false, timeoutMs: 15_000 }
        )
        if (text(answer?.token)) {
          this.endpoint = candidate
          this.token = text(answer?.token)
          log.info(`portal answers on ${candidate}`)
          return candidate
        }
        failures.push(`${candidate}: answered without a token`)
      } catch (error) {
        failures.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    throw new Error(
      `No portal answered at that address. Tried:\n${failures.map((f) => `  • ${f}`).join('\n')}`
    )
  }

  /**
   * One portal call.
   *
   * Everything is a GET with the parameters in the query string, the MAC in a
   * cookie and — after the handshake — the token in an Authorization header.
   * The body is `{"js": …}`; `js` is the only part that ever matters.
   */
  private async call<T>(
    endpoint: string,
    params: Record<string, string>,
    options: { authenticated?: boolean; timeoutMs?: number } = {}
  ): Promise<T> {
    const url = `${endpoint}?${new URLSearchParams({ ...params, JsHttpRequest: '1-xml' })}`
    const headers: Record<string, string> = {
      'X-User-Agent': STB.xUserAgent,
      Cookie: this.cookie(),
      Accept: '*/*'
    }
    if (options.authenticated !== false && this.token) {
      headers['Authorization'] = `Bearer ${this.token}`
    }

    const response = await request(url, {
      ...this.options,
      timeoutMs: options.timeoutMs ?? this.options.timeoutMs ?? 30_000,
      userAgent: STB.userAgent,
      referrer: refererFor(endpoint),
      headers
    })

    const body = await response.text()
    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      // A portal that has lost the session answers with its login page, a 200
      // and a pile of HTML. Saying what arrived is the difference between a
      // reproducible report and "it does not work".
      throw new Error(
        `Expected JSON from ${describeCall(params)} but the portal sent ` +
          `${body.trim().slice(0, 120) || '(nothing)'}`
      )
    }

    const envelope = asRecord(parsed)
    if (envelope && 'js' in envelope) {
      const js = envelope['js']

      // A portal does not answer a refused MAC with an HTTP error. It answers
      // 200, with the envelope it always uses, carrying an error inside — so a
      // client that only looks at the shape reads it as an empty list and
      // reports a successful sync of nothing at all. Which is how someone ends
      // up believing their subscription works and their channels are gone.
      const refusal = refusalIn(js)
      if (refusal) throw new Error(`The portal refused ${describeCall(params)}: ${refusal}`)

      return js as T
    }

    // Some portals answer errors as a bare object with no envelope at all.
    throw new Error(
      `The portal answered ${describeCall(params)} without the expected "js" field: ` +
        `${JSON.stringify(parsed).slice(0, 160)}`
    )
  }

  private cookie(): string {
    const timezone = this.credentials.timezone || 'Europe/London'
    return [
      `mac=${encodeURIComponent(this.mac)}`,
      'stb_lang=en',
      `timezone=${encodeURIComponent(timezone)}`
    ].join('; ')
  }
}

/* ------------------------------------------------------------------ */
/* Pure helpers — exported so they can be tested without a portal.      */
/* ------------------------------------------------------------------ */

/**
 * Every address worth trying for a portal URL.
 *
 * The URL a provider gives out is rarely the endpoint: it is usually the page
 * a browser would open, sometimes with `/c/` on the end, sometimes bare. Every
 * known endpoint is tried under the given origin, and any path the user typed
 * is kept as a prefix in case the portal lives in a subdirectory.
 */
export function candidateEndpoints(portalUrl: string): string[] {
  const trimmed = portalUrl.trim()
  if (trimmed === '') return []

  let parsed: URL
  try {
    parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`)
  } catch {
    return []
  }

  // A URL that already names an endpoint is used as given, first: the provider
  // knew something we are only guessing at.
  const given = parsed.pathname.replace(/\/+$/, '')
  const explicit = /\.php$/i.test(given) ? [`${parsed.origin}${given}`] : []

  // "/c" and "/stalker_portal/c" are the browser-facing pages; the endpoint
  // sits beside them, not under them.
  const root = given.replace(/\/(c|stalker_portal\/c)$/i, '')

  const candidates = explicit.concat(
    CANDIDATE_PATHS.map((path) => `${parsed.origin}${root}${path}`),
    root === '' ? [] : CANDIDATE_PATHS.map((path) => `${parsed.origin}${path}`)
  )

  return [...new Set(candidates)]
}

/** The `Referer` a MAG box sends: the portal's own browser page. */
export function refererFor(endpoint: string): string {
  try {
    const url = new URL(endpoint)
    return `${url.origin}${url.pathname.replace(/\/[^/]*$/, '')}/c/`
  } catch {
    return endpoint
  }
}

/**
 * The colon-separated upper-case form portals expect.
 *
 * People paste the MAC in whatever their provider emailed them — dashes, no
 * separators, lower case — and a portal given the wrong form answers exactly
 * as it would for a MAC that is not subscribed, which sends the user looking
 * for a billing problem they do not have.
 */
export function normalizeMac(value: string): string {
  const hex = value.replace(/[^0-9a-f]/gi, '').toUpperCase()
  if (hex.length !== 12) return value.trim().toUpperCase()
  return (hex.match(/.{2}/g) ?? []).join(':')
}

/** Whether this looks like a MAC at all, before anything is attempted with it. */
export function isMacAddress(value: string): boolean {
  return /^[0-9a-f]{12}$/i.test(value.replace(/[^0-9a-f]/gi, ''))
}

/**
 * The serial a box derives from its MAC.
 *
 * Some portals check that the serial and the MAC agree; the relationship is
 * not a secret and not a security measure, it is a consistency check. Derived
 * rather than random so the same MAC always presents the same box, which is
 * what a portal that pins a session to a device expects.
 */
export function serialFor(mac: string): string {
  const hex = mac.replace(/[^0-9A-F]/gi, '').toUpperCase()
  return hex.slice(-13).padStart(13, '0')
}

/**
 * The ways a portal might want to be asked for a link, best guess first.
 *
 * `create_link` matches the `cmd` against what it has stored, and portals
 * disagree about what that is. Most want it exactly as the channel list gave
 * it. Some strip the player hint before storing and will not match a cmd that
 * still carries one. Some only ever match the canonical form built from the
 * channel id, whatever they put in the list.
 *
 * There is no way to tell which from the outside, and getting it wrong does
 * not look like an error — see `hasBlankStreamId`. So the forms are tried in
 * turn, at one small request each, and only on failure.
 */
export function linkAttempts(
  cmd: string,
  channelId?: string
): { name: string; cmd: string }[] {
  const attempts = [{ name: 'stored', cmd }]

  const bare = stripLinkPrefix(cmd)
  if (bare !== cmd && bare !== '') attempts.push({ name: 'without the player hint', cmd: bare })

  if (channelId) {
    const canonical = `ffrt http://localhost/ch/${channelId}`
    if (!attempts.some((attempt) => attempt.cmd === canonical)) {
      attempts.push({ name: 'rebuilt from the channel id', cmd: canonical })
    }
  }

  return attempts
}

/**
 * Whether a play URL names no channel.
 *
 * `…/play/live.php?mac=…&stream=&extension=ts` is what a portal answers when
 * it did not recognise the cmd. It is a 200, it looks like a URL, and it is
 * worthless — the only sign is the empty parameter.
 */
export function hasBlankStreamId(url: string): boolean {
  try {
    const params = new URL(url).searchParams
    for (const key of ['stream', 'ch_id', 'channel_id', 'id']) {
      if (params.has(key) && params.get(key)!.trim() === '') return true
    }
    return false
  } catch {
    return false
  }
}

/** Strips the player hint a portal puts in front of the URL it returns. */
export function stripLinkPrefix(value: string): string {
  return value.replace(LINK_PREFIX, '').trim()
}

/**
 * The rows out of a portal response, whatever it decided a list is.
 *
 * `{data: [...]}` is the documented shape. A bare array and `{data: {…}}`
 * keyed by id both turn up in the wild, and neither is worth failing over.
 */
export function listOf(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw.map(asRecord).filter(isRecord)

  const record = asRecord(raw)
  if (!record) return []

  const data = record['data']
  if (Array.isArray(data)) return data.map(asRecord).filter(isRecord)
  if (isRecord(data)) return Object.values(data).map(asRecord).filter(isRecord)

  return []
}

/** One row of a channel list, or null when it is not a channel. */
export function toChannel(row: Record<string, unknown>): ParsedChannel | null {
  const externalId = text(row['id']) ?? text(row['ch_id'])
  const name = text(row['name']) ?? text(row['title'])
  if (!externalId || !name) return null

  // The `cmd` is what `create_link` is given later. `cmds` is the same thing
  // as a list, on portals that offer several servers for a channel.
  const cmd = text(row['cmd']) ?? firstCmd(row['cmds'])
  if (!cmd) return null

  return {
    externalId,
    name,
    categoryExternalId: text(row['tv_genre_id']) ?? null,
    number: number(row['number']),
    logoUrl: text(row['logo']) ?? null,
    epgChannelId: text(row['xmltv_id']) ?? null,
    streamUrl: cmd,
    containerExtension: null,
    // Portals mark adult channels for their own parental control; the flag is
    // passed through so this application's parental lock can use it too.
    isAdult: truthy(row['censored']),
    catchupDays: number(row['tv_archive_duration']) ?? 0
  }
}

/**
 * One film or show out of a portal's VOD listing.
 *
 * The external id carries a `vod:` or `series:` prefix, matching what the
 * Xtream client writes. That is not cosmetic: the rest of the application —
 * the kind backfill included — reads the prefix to tell a film from a show
 * from a channel, so a portal row without it would be filed as live TV.
 *
 * A show has no single thing to play; a portal addresses each episode by the
 * show's own `cmd` plus a series number. So an empty stream URL is correct
 * for a series and fatal for a film, and the two are treated differently
 * rather than both being dropped for want of a `cmd`.
 */
export function toVodItem(row: Record<string, unknown>, kind: 'movie' | 'series'): ParsedChannel | null {
  const rawId = text(row['id']) ?? text(row['movie_id'])
  const name = text(row['name']) ?? text(row['o_name']) ?? text(row['title'])
  if (!rawId || !name) return null

  const cmd = text(row['cmd']) ?? firstCmd(row['cmds'])
  if (kind === 'movie' && !cmd) return null

  return {
    externalId: `${kind === 'movie' ? 'vod' : 'series'}:${rawId}`,
    name,
    categoryExternalId: text(row['category_id']) ?? null,
    number: null,
    logoUrl: text(row['screenshot_uri']) ?? text(row['pic']) ?? null,
    epgChannelId: null,
    streamUrl: kind === 'movie' ? cmd! : (cmd ?? ''),
    containerExtension: null,
    isAdult: truthy(row['censored']),
    catchupDays: 0,
    // Portals send an IMDb-style ten-point figure under its own name, and
    // some send a five-point `rating` beside it; both forms go through the
    // same reconciliation the Xtream rows do.
    rating: vodRating(row['rating_imdb'] ?? row['rating'], row['rating_5based']),
    year: vodYear(row['year'], row['release_date'], row['releasedate']),
    providerAddedAt: vodAddedAtText(row['added'])
  }
}

/** One programme out of the portal's short guide. */
export function toProgramme(channelId: string, row: Record<string, unknown>): ParsedProgramme | null {
  const title = text(row['name']) ?? text(row['t_time'])
  const startsAt = epochMs(row['start_timestamp'])
  const endsAt = epochMs(row['stop_timestamp'])
  if (!title || startsAt === null || endsAt === null || endsAt <= startsAt) return null

  return {
    channelId,
    title,
    description: text(row['descr']) ?? null,
    category: text(row['category']) ?? null,
    startsAt,
    endsAt
  }
}

function firstCmd(value: unknown): string | null {
  if (!Array.isArray(value)) return null
  for (const entry of value) {
    const cmd = text(asRecord(entry)?.['url'] ?? asRecord(entry)?.['cmd'])
    if (cmd) return cmd
  }
  return null
}

function isChannel(value: ParsedChannel | null): value is ParsedChannel {
  return value !== null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null
}

/** A string, from a portal that may have sent a number or nothing. */
function text(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() === '' ? null : value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function number(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function truthy(value: unknown): boolean {
  return value === 1 || value === true || value === '1'
}

/** Portal timestamps are seconds; a few portals send milliseconds already. */
function epochMs(value: unknown): number | null {
  const seconds = number(value)
  if (seconds === null || seconds <= 0) return null
  return seconds > 1e12 ? seconds : seconds * 1000
}

/** An expiry date, from the several ways portals write one. */
function expiryMs(value: unknown): number | null {
  const asNumber = number(value)
  if (asNumber !== null && asNumber > 1e8) return asNumber > 1e12 ? asNumber : asNumber * 1000

  const asText = text(value)
  if (!asText) return null
  const parsed = Date.parse(asText)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Says so, loudly, when a portal sent rows this client could not read.
 *
 * This is the failure that is hardest to diagnose from the outside, because it
 * does not look like a failure: the portal answered, the sync finished, and
 * the channel list is empty or short. Since this adapter cannot be tested
 * against real hardware, the log has to carry enough to fix it from a single
 * report — which means the field names the portal actually used, and one row
 * as it arrived.
 */
function reportUnreadable(call: string, rows: Record<string, unknown>[], parsed: number): void {
  if (parsed === rows.length) return

  const sample = rows.find((row) => toChannel(row) === null)
  log.warn(
    `${call}: read ${parsed} channels out of ${rows.length} rows. ` +
      'A row this client could not read has the fields: ' +
      `${sample ? Object.keys(sample).join(', ') : '(none)'}. ` +
      'A channel needs an id, a name and a cmd.',
    sample ? JSON.stringify(sample).slice(0, 400) : undefined
  )
}

function countChannels(rows: Record<string, unknown>[]): number {
  return rows.reduce((total, row) => (toChannel(row) === null ? total : total + 1), 0)
}

/**
 * The portal's own words for a refusal, when the response carries one.
 *
 * `error` is not reliably an error: some portals set it to "none" on every
 * successful call, and at least one sends `0`. Only a message that says
 * something counts, and `block_msg` — which is what a portal uses to explain a
 * MAC it will not serve — counts on its own.
 */
function refusalIn(js: unknown): string | null {
  const record = asRecord(js)
  if (!record) return null

  const blocked = text(record['block_msg'])
  if (blocked) return plainText(blocked)

  const error = text(record['error'])
  if (!error) return null
  if (/^(none|0|null|false|ok)$/i.test(error)) return null
  return plainText(error)
}

/**
 * A portal message, fit to show someone.
 *
 * These are written for the set-top box's own browser, so they arrive as
 * fragments of HTML — a real one read "Validation error occured.<br />Call
 * Provider.+972 74 703 3333", and the tag went straight into the dialog. The
 * message itself is worth showing: it is the provider telling the user what to
 * do about it.
 */
export function plainText(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/** Names a call in an error, without repeating the whole query string. */
function describeCall(params: Record<string, string>): string {
  return `${params['type'] ?? '?'}/${params['action'] ?? '?'}`
}
