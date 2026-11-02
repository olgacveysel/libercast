/**
 * A Stalker / Ministra portal, as documented.
 *
 * This is the honest limit of what can be tested here: it answers the protocol
 * the client was written against, so it proves the client and the written
 * protocol agree. It cannot prove the client and a real portal agree, because
 * portals differ from the documentation in ways nobody has written down.
 *
 * So what it models is specifically the parts that are known to vary and known
 * to break clients — the path the portal answers on, token expiry partway
 * through a session, pagination, the player hint in front of the returned URL,
 * a portal that ignores the page parameter — rather than a happy path that
 * would pass whatever the client did.
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

export const MAC = '00:1A:79:AA:BB:CC'

export interface PortalOptions {
  /** Which path answers; everything else 404s, like a web server would. */
  path?: string
  channels?: number
  /** Refuse `get_all_channels`, forcing the client to walk pages. */
  paginate?: boolean
  pageSize?: number
  /** Answer every page with page one — the shape that hangs a naive client. */
  ignorePages?: boolean
  /** How many authenticated calls before the token stops working. */
  expireTokenAfter?: number
  /** The player hint put in front of the returned link. */
  linkPrefix?: string
  /** 404 the account call, as plenty of portals do. */
  noAccountInfo?: boolean
  /** The MAC this portal has a subscription for. */
  mac?: string
  /**
   * Name the channel fields differently, as a portal with its own ideas does.
   *
   * This is the failure mode that looks like success: the portal answers, the
   * rows arrive, and none of them is a channel this client recognises.
   */
  oddFieldNames?: boolean
}

export interface Portal {
  server: Server
  seen: {
    requests: string[]
    tokens: string[]
    macs: string[]
    referers: (string | null)[]
    userAgents: (string | null)[]
  }
  port: number
  url: string
  handshakes: () => number
  close: () => void
}

export function startPortal(options: PortalOptions = {}): Promise<Portal> {
  const config = {
    path: '/portal.php',
    channels: 5,
    paginate: false,
    pageSize: 2,
    ignorePages: false,
    expireTokenAfter: Infinity,
    linkPrefix: 'ffmpeg ',
    noAccountInfo: false,
    oddFieldNames: false,
    mac: MAC,
    ...options
  }

  const seen: Portal['seen'] = {
    requests: [],
    tokens: [],
    macs: [],
    referers: [],
    userAgents: []
  }
  let issued = 0
  let callsWithToken = 0

  const channel = (n: number) => ({
    id: String(n),
    name: `Alto Sports ${n}`,
    number: n,
    cmd: `ffrt http://localhost/ch/${n}`,
    logo: `http://localhost/logo/${n}.png`,
    xmltv_id: `alto.${n}`,
    tv_genre_id: String((n % 2) + 1),
    censored: n === 3 ? 1 : 0,
    tv_archive_duration: n === 1 ? '3' : 0
  })

  const rename = (row: ReturnType<typeof channel>): Record<string, unknown> => ({
    channel_id: row.id,
    title: row.name,
    stream_cmd: row.cmd,
    number: row.number
  })

  const all = Array.from({ length: config.channels }, (_, i) => {
    const row = channel(i + 1)
    return config.oddFieldNames ? rename(row) : row
  })

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const params = url.searchParams
    const action = params.get('action')
    const type = params.get('type')

    seen.requests.push(`${type}/${action}`)
    seen.referers.push(req.headers['referer'] ?? null)
    seen.userAgents.push(req.headers['user-agent'] ?? null)

    const cookie = req.headers['cookie'] ?? ''
    const mac = decodeURIComponent((cookie.match(/mac=([^;]+)/) ?? [])[1] ?? '')
    seen.macs.push(mac)

    const auth = (req.headers['authorization'] ?? '').replace(/^Bearer\s+/i, '')
    if (auth) seen.tokens.push(auth)

    const send = (js: unknown, status = 200): void => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ js }))
    }

    if (url.pathname !== config.path) {
      res.writeHead(404, { 'Content-Type': 'text/html' })
      res.end('<html><body>Not Found</body></html>')
      return
    }

    if (action === 'handshake') {
      issued += 1
      callsWithToken = 0
      send({ token: `token-${issued}`, random: 'abc' })
      return
    }

    // Everything past the handshake needs the token, and a portal whose token
    // has expired does not say so politely: it answers with its login page.
    if (!auth) {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<html><body>Authorization failed</body></html>')
      return
    }
    callsWithToken += 1
    if (callsWithToken > config.expireTokenAfter) {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<html><body>Session expired. Please log in.</body></html>')
      return
    }

    if (mac !== config.mac) {
      send({ error: 'Invalid MAC', block_msg: 'This device is not registered' })
      return
    }

    if (action === 'get_profile') {
      send({ id: 1, name: 'STB', status: 0, blocked: '0' })
      return
    }

    if (type === 'account_info' && action === 'get_main_info') {
      if (config.noAccountInfo) {
        res.writeHead(404, { 'Content-Type': 'text/html' })
        res.end('not found')
        return
      }
      send({ login: 'demo-account', status: 'Active', end_date: '2027-01-31' })
      return
    }

    if (action === 'get_genres') {
      send([
        { id: '*', title: 'All' },
        { id: '1', title: 'Sports' },
        { id: '2', title: 'News' }
      ])
      return
    }

    if (action === 'get_all_channels') {
      // A portal without this action answers the envelope with nothing in it,
      // which is the shape that made the fallback necessary.
      if (config.paginate) {
        send({ data: [] })
        return
      }
      send({ data: all, total_items: all.length })
      return
    }

    if (action === 'get_ordered_list') {
      const page = config.ignorePages ? 1 : Number(params.get('p') ?? '1')
      const start = (page - 1) * config.pageSize
      send({
        data: all.slice(start, start + config.pageSize),
        total_items: all.length,
        max_page_items: config.pageSize
      })
      return
    }

    if (action === 'create_link') {
      const cmd = params.get('cmd') ?? ''
      const id = (cmd.match(/\/ch\/(\d+)/) ?? [])[1] ?? '0'
      send({ id: 1, cmd: `${config.linkPrefix}http://localhost/play/${id}?token=xyz` })
      return
    }

    if (action === 'get_short_epg') {
      const now = Math.floor(Date.now() / 1000)
      send({
        data: [
          { name: 'First programme', descr: 'One', start_timestamp: now, stop_timestamp: now + 1800 },
          { name: 'Second programme', descr: 'Two', start_timestamp: now + 1800, stop_timestamp: now + 3600 },
          { name: 'Broken, no times' }
        ]
      })
      return
    }

    send({ error: `unknown action ${action}` })
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({
        server,
        seen,
        port,
        url: `http://127.0.0.1:${port}`,
        handshakes: () => issued,
        close: () => server.close()
      })
    })
  })
}
