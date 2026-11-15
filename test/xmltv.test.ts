import { decodeEntities, parseProgrammeBlock, parseXmltvTime, scanXmltv } from '@main/sources/xmltv'
import { withIdleDeadline } from '@main/util/http'
import type { ParsedProgramme } from '@main/sources/types'

/*
 * Failure is the default until `main` says otherwise.
 *
 * Without this, a test that hangs and then exits because the event loop went
 * empty reports success: node leaves the code at 0, the runner sees 0, and a
 * check that never ran looks exactly like a check that passed. That happened
 * here, on the first run of the stall test below.
 */
process.exitCode = 1

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

console.log('\nXMLTV timestamps')
check(
  'parses a stamp with a positive offset',
  parseXmltvTime('20260906123000 +0200') === Date.UTC(2026, 8, 6, 10, 30, 0),
  parseXmltvTime('20260906123000 +0200')
)
check(
  'parses a stamp with a negative offset',
  parseXmltvTime('20260906123000 -0500') === Date.UTC(2026, 8, 6, 17, 30, 0)
)
check('treats a missing offset as UTC', parseXmltvTime('20260906123000') === Date.UTC(2026, 8, 6, 12, 30, 0))
check('accepts a stamp without seconds', parseXmltvTime('202609061230') === Date.UTC(2026, 8, 6, 12, 30, 0))
check('handles a half-hour zone', parseXmltvTime('20260906123000 +0530') === Date.UTC(2026, 8, 6, 7, 0, 0))
check('rejects nonsense', parseXmltvTime('not-a-date') === null)

console.log('\nEntities')
check('decodes named entities', decodeEntities('Tom &amp; Jerry') === 'Tom & Jerry')
check('decodes numeric entities', decodeEntities('caf&#233;') === 'café')
check('decodes hex entities', decodeEntities('caf&#xe9;') === 'café')
check('unwraps CDATA', decodeEntities('<![CDATA[Hello]]>') === 'Hello')

console.log('\nProgramme blocks')
const block =
  ' start="20260906123000 +0000" stop="20260906133000 +0000" channel="civic.one">' +
  '<title lang="en">The News &amp; Weather</title>' +
  '<desc lang="en">Headlines.</desc>' +
  '<category lang="en">News</category>'

const programme = parseProgrammeBlock(block)
check('extracts the channel id', programme?.channelId === 'civic.one')
check('extracts and decodes the title', programme?.title === 'The News & Weather', programme?.title)
check('extracts the description', programme?.description === 'Headlines.')
check('extracts the category', programme?.category === 'News')
check('computes a one-hour span', programme!.endsAt - programme!.startsAt === 3_600_000)

const noStop = parseProgrammeBlock(' start="20260906123000" channel="x"><title>T</title>')
check('assumes an hour when stop is missing', noStop!.endsAt - noStop!.startsAt === 3_600_000)
check('drops a programme with no title', parseProgrammeBlock(' start="20260906123000" channel="x">') === null)
check('drops a programme with no channel', parseProgrammeBlock(' start="20260906123000"><title>T</title>') === null)

/*
 * A feed that goes quiet.
 *
 * `loadXmltv` reads `response.body` itself, which meant it had no deadline of
 * any kind: the request timeout is cleared the moment the headers arrive. A
 * provider that answered 200 and then stopped sending left the read awaiting
 * a chunk that never came — and because nothing settled, the flag saying a
 * refresh was in progress was never cleared either, so every later refresh was
 * refused until the application was restarted. One stalled feed disabled the
 * feature.
 *
 * The deadline is on the gaps, not on the total: a real guide is slow and
 * large, and must not be punished for either.
 */
async function* dribble(): AsyncGenerator<Buffer> {
  yield Buffer.from('<tv>')
  // ...and then nothing, ever.
  await new Promise(() => undefined)
}

async function* steady(): AsyncGenerator<Buffer> {
  for (let i = 0; i < 4; i++) {
    yield Buffer.from(`<programme channel="c${i}"></programme>`)
    await new Promise((resolve) => setTimeout(resolve, 40))
  }
}

async function collect(source: AsyncIterable<Buffer>, ms: number): Promise<string> {
  let out = ''
  for await (const chunk of withIdleDeadline(source, ms, 'http://example.test/guide.xml')) {
    out += chunk.toString()
  }
  return out
}

async function main(): Promise<void> {
  console.log('\nStreaming scanner')
  const DOC = `<?xml version="1.0"?>
  <tv>
    <channel id="a"><display-name>A</display-name></channel>
    <programme start="20260906120000 +0000" stop="20260906130000 +0000" channel="a"><title>One</title></programme>
    <programme start="20260906130000 +0000" stop="20260906140000 +0000" channel="a"><title>Two</title></programme>
    <programme start="20260906140000 +0000" stop="20260906150000 +0000" channel="b"><title>Three</title></programme>
  </tv>`

  async function scan(chunks: string[], options: Parameters<typeof scanXmltv>[1] = { onBatch: () => {} }) {
    const collected: ParsedProgramme[] = []
    async function* source(): AsyncGenerator<string> {
      for (const chunk of chunks) yield chunk
    }
    const total = await scanXmltv(source(), {
      ...options,
      onBatch: (batch) => collected.push(...batch)
    })
    return { total, collected }
  }

  const whole = await scan([DOC])
  check('finds every programme', whole.total === 3, whole.total)
  check('preserves order', whole.collected.map((p) => p.title).join(',') === 'One,Two,Three')

  // The real reason this parser is chunked: a 200MB guide arrives in fragments,
  // and tags land across the boundaries.
  const fragments: string[] = []
  for (let i = 0; i < DOC.length; i += 7) fragments.push(DOC.slice(i, i + 7))
  const split = await scan(fragments)
  check(
    `survives being split across ${fragments.length} chunks`,
    split.total === 3 && split.collected.map((p) => p.title).join(',') === 'One,Two,Three',
    split.collected.map((p) => p.title)
  )

  const offset = await scan([DOC], { offsetMinutes: 60, onBatch: () => {} })
  check(
    'applies the timezone offset correction',
    offset.collected[0]!.startsAt === Date.UTC(2026, 8, 6, 13, 0, 0),
    new Date(offset.collected[0]!.startsAt).toISOString()
  )

  const windowed = await scan([DOC], {
    keepAfter: Date.UTC(2026, 8, 6, 13, 30, 0),
    onBatch: () => {}
  })
  check('drops programmes that ended before the window', windowed.total === 2, windowed.total)

  const bounded = await scan([DOC], {
    keepBefore: Date.UTC(2026, 8, 6, 13, 30, 0),
    onBatch: () => {}
  })
  check('drops programmes starting after the window', bounded.total === 2, bounded.total)

  console.log('\nA source that stops sending')

  let message: string | null = null
  const started = Date.now()
  try {
    await collect(dribble(), 150)
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }
  const elapsed = Date.now() - started

  check('a silent source is given up on', message !== null, message)
  check('and says so plainly', message?.includes('Nothing received') === true, message)
  check('rather than waiting for a body that never comes', elapsed < 1500, elapsed)

  // The clock restarts on every chunk, so a slow feed that keeps arriving is
  // fine — the case a total deadline would have broken.
  const body = await collect(steady(), 150)
  check('a slow but steady source is not cut off', body.includes('c3'), body.length)
}

void main().then(() => {
  console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`)
  process.exit(failures === 0 ? 0 : 1)
})

