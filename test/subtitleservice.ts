/**
 * A stand-in for OpenSubtitles.
 *
 * The same honest limit as the portal simulator: it answers the API as
 * documented, so it proves the client and the documentation agree. It cannot
 * prove the client and the real service agree.
 *
 * So what it models is the parts that decide whether a user is told something
 * useful — a key the service does not know, a sign-in it rejects, an
 * allowance that has run out, a request to slow down — rather than a happy
 * path that would pass whatever the client did.
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

export const GOOD_KEY = 'test-key-0000'
export const GOOD_USER = 'someone'
export const GOOD_PASSWORD = 'correct-horse'

export interface ServiceOptions {
  /** How many results a search returns. */
  results?: number
  /** Refuse every download: the allowance is spent. */
  quotaSpent?: boolean
  /** Answer 429 with this many seconds in Retry-After. */
  rateLimited?: number
  /** Include a row with no file, which cannot be acted on. */
  includeUnusable?: boolean
  /** What remains of the download allowance. */
  remaining?: number
}

export interface Service {
  server: Server
  url: string
  seen: {
    paths: string[]
    keys: (string | null)[]
    userAgents: (string | null)[]
    authorizations: (string | null)[]
  }
  close: () => void
}

export function startService(options: ServiceOptions = {}): Promise<Service> {
  const config = {
    results: 3,
    quotaSpent: false,
    rateLimited: 0,
    includeUnusable: false,
    remaining: 17,
    ...options
  }

  const seen: Service['seen'] = { paths: [], keys: [], userAgents: [], authorizations: [] }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    seen.paths.push(`${req.method} ${url.pathname}`)
    seen.keys.push(req.headers['api-key'] as string | undefined ?? null)
    seen.userAgents.push(req.headers['user-agent'] ?? null)
    seen.authorizations.push(req.headers['authorization'] ?? null)

    const send = (status: number, body: unknown, headers: Record<string, string> = {}): void => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers })
      res.end(JSON.stringify(body))
    }

    // The key is checked before anything else, exactly as the service does:
    // it is required on every call, searches included.
    if (req.headers['api-key'] !== GOOD_KEY) {
      send(401, { message: 'Invalid API key' })
      return
    }

    if (config.rateLimited > 0) {
      send(429, { message: 'Too many requests' }, { 'retry-after': String(config.rateLimited) })
      return
    }

    if (url.pathname === '/api/v1/login') {
      let body = ''
      req.on('data', (chunk) => (body += chunk))
      req.on('end', () => {
        const parsed = JSON.parse(body || '{}') as { username?: string; password?: string }
        if (parsed.username !== GOOD_USER || parsed.password !== GOOD_PASSWORD) {
          send(401, { message: 'Invalid username or password' })
          return
        }
        send(200, { token: 'jwt-token-here', status: 200, user: { allowed_downloads: 100 } })
      })
      return
    }

    if (url.pathname === '/api/v1/subtitles') {
      const data = Array.from({ length: config.results }, (_, i) => ({
        id: String(i + 1),
        attributes: {
          language: i % 2 === 0 ? 'en' : 'tr',
          download_count: 1000 - i,
          hearing_impaired: i === 2,
          feature_details: { title: `The Quiet Harbour`, year: 2019 },
          files: [{ file_id: 500 + i, file_name: `quiet-harbour.${i + 1}.srt` }]
        }
      }))

      if (config.includeUnusable) {
        // A row the service returned but nothing can be done with. Showing it
        // would be offering a choice that fails when taken.
        data.push({
          id: 'broken',
          attributes: {
            language: 'en',
            download_count: 5,
            hearing_impaired: false,
            feature_details: { title: 'No File Here', year: 2020 },
            files: []
          }
        })
      }

      send(200, { data, total_count: data.length })
      return
    }

    if (url.pathname === '/api/v1/download') {
      if (config.quotaSpent) {
        send(406, { message: 'Download limit reached' })
        return
      }
      send(200, {
        link: `http://127.0.0.1:${(server.address() as AddressInfo).port}/files/subtitle.srt`,
        file_name: 'quiet-harbour.srt',
        remaining: config.remaining,
        reset_time: '08 hours 12 minutes'
      })
      return
    }

    // The link the download call hands out. Deliberately served without
    // requiring the key, because the real one is a plain tokenised URL.
    if (url.pathname.startsWith('/files/')) {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('1\r\n00:00:01,000 --> 00:00:03,000\r\nA line of dialogue.\r\n\r\n')
      return
    }

    send(404, { message: 'not found' })
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({
        server,
        url: `http://127.0.0.1:${port}`,
        seen,
        close: () => server.close()
      })
    })
  })
}
