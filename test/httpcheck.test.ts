import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  buildProbeArgs,
  buildStreamArgs,
  isAdtsContainer,
  looksLikeBadOption,
  planRemux,
  rejectOption,
  setConservativeHttp,
  DEFAULT_USER_AGENT
} from '@main/media/args'
import { describeBody, inspectStream, sniffContainer, extensionFor } from '@main/media/httpCheck'

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

console.log('\ncontainer sniffing')

const matroska = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00, 0x00])
check('matroska is recognised by its EBML header', sniffContainer(matroska) === 'matroska')

const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom')])
check('mp4 is recognised by its ftyp box', sniffContainer(mp4) === 'mp4')

const ts = Buffer.alloc(400, 0)
ts[0] = 0x47
ts[188] = 0x47
ts[376] = 0x47
check('mpeg-ts is recognised by its sync bytes', sniffContainer(ts) === 'mpegts')

// A single 0x47 is an ordinary byte; only the 188-byte cadence means TS.
const notTs = Buffer.alloc(400, 0)
notTs[0] = 0x47
check('a lone 0x47 is not treated as mpeg-ts', sniffContainer(notTs) === null)

check('an html page is not a container', sniffContainer(Buffer.from('<!DOCTYPE html><html>')) === null)
check('a short buffer is not guessed at', sniffContainer(Buffer.from([0x1a, 0x45])) === null)
check('hls playlists are recognised', sniffContainer(Buffer.from('#EXTM3U\n#EXT-X')) === 'hls')

check('matroska maps back to .mkv', extensionFor('matroska') === 'mkv')
check('an unknown container has no extension', extensionFor('hls') === null)

console.log('\nerror page summarising')

const page = Buffer.from(
  '<html><head><style>body{color:red}</style></head><body><h1>Access denied</h1>' +
    '<p>Your subscription does not include this content.</p></body></html>'
)
const summary = describeBody(page) ?? ''
check('markup is stripped from the summary', !summary.includes('<'), summary)
check('style blocks are dropped', !summary.includes('color:red'), summary)
check('the provider wording survives', summary.includes('Access denied'), summary)

const long = Buffer.from('x'.repeat(5000))
check('a long body is truncated', (describeBody(long) ?? '').length <= 160)
check('an empty body summarises to nothing', describeBody(Buffer.alloc(0)) === null)

console.log('\nprobe and playback use the same http options')

const probeArgs = buildProbeArgs('http://example.test/series/u/p/1.mkv', { userAgent: null, referrer: null })
const streamArgs = buildStreamArgs(
  'http://example.test/series/u/p/1.mkv',
  planRemux({ video: 'h264', audio: 'aac', durationSecs: 100 })
)

for (const flag of ['-user_agent', '-reconnect', '-rw_timeout']) {
  check(`probe passes ${flag}`, probeArgs.includes(flag), probeArgs.join(' '))
  check(`playback passes ${flag}`, streamArgs.includes(flag), streamArgs.join(' '))
}

check(
  'a default user agent is sent when the source has none',
  probeArgs[probeArgs.indexOf('-user_agent') + 1] === DEFAULT_USER_AGENT
)

const custom = buildProbeArgs('http://example.test/a.mkv', { userAgent: 'MyPlayer/1.0' })
check(
  "the source's own user agent wins",
  custom[custom.indexOf('-user_agent') + 1] === 'MyPlayer/1.0'
)

// ffmpeg aborts the entire command on an option the http protocol does not
// define, so the flag list is pinned. `-follow_redirects` is not one of them:
// passing it took live TV down completely, and redirects are followed anyway.
for (const invented of ['-follow_redirects', '-http_follow', '-max_redirects']) {
  check(`probe does not pass ${invented}`, !probeArgs.includes(invented), probeArgs.join(' '))
  check(`playback does not pass ${invented}`, !streamArgs.includes(invented), streamArgs.join(' '))
}

const localArgs = buildProbeArgs('C:/videos/recording.mp4', {})
check('a local file gets no reconnect flags', !localArgs.includes('-reconnect'), localArgs.join(' '))
// -user_agent belongs to the HTTP handler; ffmpeg refuses to start when it is
// passed for a file input, which is how recordings stopped playing.
check('a local file gets no http options at all', !localArgs.includes('-user_agent'), localArgs.join(' '))

console.log('\nfalling back when a build rejects an option')

check(
  "ffmpeg's own complaint is recognised",
  looksLikeBadOption("Error splitting the argument list: Option not found") &&
    looksLikeBadOption("Unrecognized option 'follow_redirects'.") &&
    looksLikeBadOption("Failed to set value '1' for option 'x': Option not found")
)
check('an ordinary stream failure is not mistaken for one', !looksLikeBadOption('Invalid data found when processing input'))

// The build in the field rejected exactly one option. Dropping all of them
// would also give up the reconnect behaviour it does support.
check(
  'the rejected option is identified by name',
  rejectOption("Failed to set value '1' for option 'reconnect_on_network_error': Option not found") ===
    'reconnect_on_network_error'
)
const narrowed = buildProbeArgs('http://example.test/a.ts', {})
check('the rejected option is gone', !narrowed.includes('-reconnect_on_network_error'), narrowed.join(' '))
check('the others are kept', narrowed.includes('-reconnect'), narrowed.join(' '))
check('the timeout is kept', narrowed.includes('-rw_timeout'), narrowed.join(' '))
check(
  'a second name is also learned',
  rejectOption("Unrecognized option 'rw_timeout'.") === 'rw_timeout'
)
check('and dropped', !buildProbeArgs('http://example.test/a.ts', {}).includes('-rw_timeout'))
check('a message naming no option is not guessed at', rejectOption('Invalid data found') === null)
setConservativeHttp(false)

setConservativeHttp(true)
const safeArgs = buildProbeArgs('http://example.test/a.ts', {})
// The User-Agent stays: it is the option panels actually require, and every
// build has had it for years.
check('the user agent survives the fallback', safeArgs.includes('-user_agent'), safeArgs.join(' '))
check('the tuning options are dropped', !safeArgs.includes('-reconnect'), safeArgs.join(' '))
check('the timeout is dropped too', !safeArgs.includes('-rw_timeout'), safeArgs.join(' '))
setConservativeHttp(false)
check('the fallback can be lifted again', buildProbeArgs('http://example.test/a.ts', {}).includes('-reconnect'))

console.log('\nADTS framing belongs to MPEG-TS alone')

check('mpegts is ADTS-framed', isAdtsContainer('mpegts'))
check('matroska is not', !isAdtsContainer('matroska,webm'))
check('mp4 is not', !isAdtsContainer('mov,mp4,m4a,3gp,3g2,mj2'))
check('an unknown container is not assumed to be', !isAdtsContainer(null))
// The format name is a comma-separated list; a substring test would match
// "mpegtsraw" and similar.
check('a partial name does not match', !isAdtsContainer('mpegtsraw'))

console.log('\ninspecting a live http endpoint')

/** Every request header the fake provider saw, so the client can be asserted. */
const sentHeaders: Record<string, unknown>[] = []

/** Serves a scripted response so the classifier can be exercised end to end. */
function serveOnce(handler: (path: string) => { status: number; type?: string; body: Buffer | string; location?: string }): Promise<{ server: Server; base: string }> {
  const server = createServer((request, response) => {
    sentHeaders.push(
      Object.fromEntries(Object.entries(request.headers).map(([name, value]) => [name.toLowerCase(), value]))
    )
    const result = handler(request.url ?? '/')
    const headers: Record<string, string> = {}
    if (result.type) headers['Content-Type'] = result.type
    if (result.location) headers.Location = result.location
    response.writeHead(result.status, headers)
    response.end(result.body)
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({ server, base: `http://127.0.0.1:${port}` })
    })
  })
}

async function main(): Promise<void> {
  const { server, base } = await serveOnce((path) => {
    if (path === '/good.mkv') return { status: 200, type: 'video/x-matroska', body: matroska }
    if (path === '/html.mkv') {
      return { status: 200, type: 'text/html', body: '<html><body>Not allowed for this user</body></html>' }
    }
    if (path === '/gone.mkv') return { status: 404, type: 'text/html', body: '<html>No such file</html>' }
    if (path === '/limit.mkv') return { status: 200, type: 'video/mp4', body: Buffer.alloc(0) }
    if (path === '/moved.mkv') return { status: 302, body: '', location: '/good.mkv' }
    if (path === '/denied.mkv') return { status: 403, type: 'text/html', body: '<html>Expired account</html>' }
    return { status: 200, type: 'application/octet-stream', body: mp4 }
  })

  const good = await inspectStream(`${base}/good.mkv`)
  check('a real matroska stream passes', good.ok && good.container === 'matroska', good)

  const html = await inspectStream(`${base}/html.mkv`)
  check('an html body is rejected', !html.ok, html)
  check(
    "the provider's own words reach the message",
    (html.reason ?? '').includes('Not allowed for this user'),
    html.reason
  )

  const missing = await inspectStream(`${base}/gone.mkv`)
  check('a 404 is rejected', !missing.ok && missing.status === 404)
  check('a 404 says re-syncing helps', (missing.reason ?? '').includes('Re-syncing'), missing.reason)

  const denied = await inspectStream(`${base}/denied.mkv`)
  check('a 403 blames credentials, not the file', (denied.reason ?? '').includes('credentials'), denied.reason)

  const empty = await inspectStream(`${base}/limit.mkv`)
  check('an empty 200 is rejected', !empty.ok, empty)
  check(
    'an empty 200 is explained as a connection limit',
    (empty.reason ?? '').includes('connection limit'),
    empty.reason
  )
  // The difference that matters: a busy provider must not stop the app from
  // trying, and must not send it hunting through other extensions.
  check('an empty 200 is not treated as definitive', empty.definitive === false, empty)
  check('an error status is definitive', missing.definitive === true, missing)
  check('an html body is definitive', html.definitive === true, html)

  const redirected = await inspectStream(`${base}/moved.mkv`)
  check('a redirect is followed', redirected.ok && redirected.container === 'matroska', redirected)
  check('the redirect target is reported', (redirected.finalUrl ?? '').endsWith('/good.mkv'), redirected.finalUrl)

  const octet = await inspectStream(`${base}/other.mp4`)
  check('octet-stream carrying mp4 passes', octet.ok && octet.container === 'mp4', octet)

  const unreachable = await inspectStream('http://127.0.0.1:1/nothing.mkv')
  check('an unreachable host is reported, not thrown', !unreachable.ok && unreachable.reason !== null)
  check('an unreachable host is not definitive', unreachable.definitive === false)

  // A panel that ignores Range used to answer 200 with nothing, which read as a
  // connection limit. No Range header is sent any more.
  check('no Range header is sent', !sentHeaders.some((h) => 'range' in h), sentHeaders)

  server.close()

  console.log(failures === 0 ? '\nhttpcheck: all passed' : `\nhttpcheck: ${failures} failed`)
  if (failures > 0) process.exitCode = 1
}

void main()
