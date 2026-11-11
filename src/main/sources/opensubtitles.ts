import { app } from 'electron'
import { APP_NAME } from '@shared/app'
import type { SubtitleHit, SubtitleQuota, SubtitleSearch } from '@shared/types'
import { requestRaw } from '@main/util/http'
import { createLogger } from '@main/util/logger'

const log = createLogger('opensubtitles')

export const OPENSUBTITLES_BASE = 'https://api.opensubtitles.com/api/v1'

/**
 * Searching and fetching subtitles from OpenSubtitles.
 *
 * Two identities are in play and they are not the same thing, which is the
 * one piece of this API worth understanding before reading the code.
 *
 * The **API key** identifies the application. It is required on every call,
 * including searches, and LiberCast does not ship one: the source is public,
 * so a shipped key would be extractable, and the account that gets revoked
 * over somebody else's abuse would be the maintainer's. So the user supplies
 * their own, and until they do this feature is off.
 *
 * The **login** is optional and identifies the person. It does not unlock the
 * feature; it raises the download allowance — five a day anonymously, ten to
 * a thousand signed in. Searching is unlimited either way.
 *
 * Neither the key nor the password is ever logged. The key travels in a
 * header rather than the URL, so it cannot leak through a logged address
 * either, and download links are not logged at all because they carry their
 * own temporary token.
 */
export class OpenSubtitlesClient {
  private token: string | null = null

  /**
   * `base` exists so the test can stand a server in front of this.
   *
   * Everything below is about how the service answers — a key it does not
   * know, a sign-in it rejects, an allowance that has run out — and none of
   * that can be exercised against the real one from a test. Defaulted, so no
   * caller in the application passes it.
   */
  constructor(
    private readonly apiKey: string,
    private readonly timeoutMs = 20_000,
    private readonly base: string = OPENSUBTITLES_BASE
  ) {
    if (!apiKey.trim()) throw new Error('No OpenSubtitles API key is set.')
  }

  /**
   * A User-Agent naming the application and version, as the API asks for.
   *
   * Deliberately not the browser string the rest of the application sends to
   * providers: that one exists because some providers refuse anything else,
   * and here the opposite is true — the service wants to know who is calling.
   */
  private get userAgent(): string {
    return `${APP_NAME} v${app.getVersion()}`
  }

  private headers(json = false): Record<string, string> {
    const headers: Record<string, string> = { 'Api-Key': this.apiKey, Accept: 'application/json' }
    if (json) headers['Content-Type'] = 'application/json'
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`
    return headers
  }

  private async call(
    path: string,
    options: { method?: 'GET' | 'POST'; body?: unknown } = {}
  ): Promise<unknown> {
    const method = options.method ?? 'GET'
    const response = await requestRaw(`${this.base}${path}`, {
      method,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      userAgent: this.userAgent,
      headers: this.headers(options.body !== undefined),
      timeoutMs: this.timeoutMs
    })

    if (!response.ok) throw await describeFailure(response, path)

    const text = await response.text()
    try {
      return JSON.parse(text) as unknown
    } catch {
      throw new Error('OpenSubtitles answered with something that is not JSON.')
    }
  }

  /**
   * Checks the key by making the cheapest real call there is.
   *
   * A search rather than anything else: it is the call the feature actually
   * depends on, it has no quota, and a key that cannot search is of no use
   * however well it authenticates.
   */
  async testKey(): Promise<void> {
    await this.call('/subtitles?query=test&languages=en')
  }

  /** Optional. Raises the download allowance; does not unlock searching. */
  async login(username: string, password: string): Promise<void> {
    const body = await this.call('/login', { method: 'POST', body: { username, password } })
    const token = asRecord(body)?.['token']
    if (typeof token !== 'string' || token === '') {
      throw new Error('OpenSubtitles accepted the sign-in but returned no token.')
    }
    this.token = token
    log.info('signed in to OpenSubtitles')
  }

  async search(search: SubtitleSearch): Promise<SubtitleHit[]> {
    const params = new URLSearchParams()
    params.set('query', search.query)
    if (search.languages.length > 0) params.set('languages', search.languages.join(','))
    if (search.year) params.set('year', String(search.year))
    if (search.season !== undefined) params.set('season_number', String(search.season))
    if (search.episode !== undefined) params.set('episode_number', String(search.episode))
    if (search.season !== undefined || search.episode !== undefined) params.set('type', 'episode')
    // Most-downloaded first: with no way to preview a subtitle before playing
    // it, what other people kept is the only signal available.
    params.set('order_by', 'download_count')

    const body = await this.call(`/subtitles?${params.toString()}`)
    const rows = Array.isArray(asRecord(body)?.['data']) ? (asRecord(body)!['data'] as unknown[]) : []

    return rows.map((row) => toHit(row)).filter((hit): hit is SubtitleHit => hit !== null)
  }

  /**
   * Exchanges a file id for a temporary link, and reports what is left.
   *
   * The link is single-use and short-lived, so it is fetched at the moment of
   * download and never stored. The quota in the reply is the user's, not the
   * key's, and is passed back so the interface can say how many remain rather
   * than letting them find out by running out.
   */
  async downloadLink(fileId: number): Promise<{ url: string; fileName: string; quota: SubtitleQuota }> {
    const body = asRecord(await this.call('/download', { method: 'POST', body: { file_id: fileId } }))
    const url = body?.['link']
    if (typeof url !== 'string' || url === '') {
      throw new Error('OpenSubtitles returned no download link.')
    }

    return {
      url,
      fileName: typeof body?.['file_name'] === 'string' ? (body['file_name'] as string) : `subtitle-${fileId}.srt`,
      quota: {
        remaining: numberOf(body?.['remaining']),
        resetsAt: typeof body?.['reset_time'] === 'string' ? (body['reset_time'] as string) : null
      }
    }
  }
}

/**
 * What went wrong, in words a user can act on.
 *
 * The status alone is not enough: a 401 is either a key the service does not
 * recognise or a sign-in it rejected, and those need different fixes from
 * different people. The distinguishing detail is in the body, so it is read
 * rather than discarded.
 */
async function describeFailure(response: Response, path: string): Promise<Error> {
  const detail = await response.text().catch(() => '')
  const message = asRecord(safeParse(detail))?.['message']
  const said = typeof message === 'string' && message !== '' ? ` The service said: ${message}` : ''

  if (response.status === 401 || response.status === 403) {
    return new Error(
      path.startsWith('/login')
        ? `OpenSubtitles rejected that username or password.${said}`
        : `OpenSubtitles did not accept the API key. Check it in Settings.${said}`
    )
  }

  if (response.status === 406) {
    return new Error(
      `Your OpenSubtitles download allowance is used up for now. ` +
        `Signing in with an account raises it.${said}`
    )
  }

  if (response.status === 429) {
    const after = response.headers.get('Retry-After')
    return new Error(
      `OpenSubtitles is asking for fewer requests` +
        (after ? `; try again in ${after} seconds.` : ' for the moment.') +
        said
    )
  }

  return new Error(`OpenSubtitles answered ${response.status} ${response.statusText}.${said}`)
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function numberOf(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * One search result, reduced to what a person choosing between them needs.
 *
 * A row with no downloadable file is dropped rather than shown: a result that
 * cannot be acted on is worse than one fewer result.
 */
export function toHit(row: unknown): SubtitleHit | null {
  const record = asRecord(row)
  const attributes = asRecord(record?.['attributes'])
  if (!attributes) return null

  const files = Array.isArray(attributes['files']) ? (attributes['files'] as unknown[]) : []
  const first = asRecord(files[0])
  const fileId = numberOf(first?.['file_id'])
  if (fileId === null) return null

  const feature = asRecord(attributes['feature_details'])
  const title = [feature?.['title'], feature?.['year']].filter(Boolean).join(' ')

  return {
    fileId,
    fileName:
      typeof first?.['file_name'] === 'string' && first['file_name'] !== ''
        ? (first['file_name'] as string)
        : `subtitle-${fileId}`,
    language: typeof attributes['language'] === 'string' ? (attributes['language'] as string) : null,
    title: title === '' ? null : title,
    downloads: numberOf(attributes['download_count']) ?? 0,
    hearingImpaired: attributes['hearing_impaired'] === true
  }
}
