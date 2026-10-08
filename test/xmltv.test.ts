import { decodeEntities, parseProgrammeBlock, parseXmltvTime, scanXmltv } from '@main/sources/xmltv'
import type { ParsedProgramme } from '@main/sources/types'

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
  ' start="20260906123000 +0000" stop="20260906133000 +0000" channel="bbc.one">' +
  '<title lang="en">The News &amp; Weather</title>' +
  '<desc lang="en">Headlines.</desc>' +
  '<category lang="en">News</category>'

const programme = parseProgrammeBlock(block)
check('extracts the channel id', programme?.channelId === 'bbc.one')
check('extracts and decodes the title', programme?.title === 'The News & Weather', programme?.title)
check('extracts the description', programme?.description === 'Headlines.')
check('extracts the category', programme?.category === 'News')
check('computes a one-hour span', programme!.endsAt - programme!.startsAt === 3_600_000)

const noStop = parseProgrammeBlock(' start="20260906123000" channel="x"><title>T</title>')
check('assumes an hour when stop is missing', noStop!.endsAt - noStop!.startsAt === 3_600_000)
check('drops a programme with no title', parseProgrammeBlock(' start="20260906123000" channel="x">') === null)
check('drops a programme with no channel', parseProgrammeBlock(' start="20260906123000"><title>T</title>') === null)

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
}

void main().then(() => {
  console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`)
  process.exit(failures === 0 ? 0 : 1)
})
