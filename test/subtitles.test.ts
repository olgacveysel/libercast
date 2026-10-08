import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decodeSubtitleBytes, isWebVtt, srtToVtt, loadSubtitleFile } from '@main/media/externalSubtitles'
import { parseFrameRate, parseProbeOutput } from '@main/media/probe'
import { parseCueBlocks } from '../src/renderer/src/features/player/subtitles'

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

const work = mkdtempSync(join(tmpdir(), 'libercast-subs-'))

async function main(): Promise<void> {
  console.log('\nEncoding detection')
  check('utf-8 with BOM is stripped and decoded', decodeSubtitleBytes(Buffer.from([0xef, 0xbb, 0xbf, 0x41])).text === 'A')
  check('plain ascii reads as utf-8', decodeSubtitleBytes(Buffer.from('Hello', 'utf8')).encoding === 'utf-8')
  check('valid utf-8 turkish is kept', decodeSubtitleBytes(Buffer.from('İyi akşamlar', 'utf8')).text === 'İyi akşamlar')

  // The case that matters most here: a Turkish subtitle saved as Windows-1254.
  // 0xFE is 'ş' in 1254 and invalid as UTF-8, so the fallback must engage.
  const turkish1254 = Buffer.from([0x61, 0x6b, 0xfe, 0x61, 0x6d]) // "akşam"
  const decoded = decodeSubtitleBytes(turkish1254)
  check('invalid utf-8 falls back to windows-1254', decoded.encoding === 'windows-1254', decoded.encoding)
  check('turkish characters survive the fallback', decoded.text === 'akşam', decoded.text)

  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Hi', 'utf16le')])
  check('utf-16le is detected by its BOM', decodeSubtitleBytes(utf16).text === 'Hi')

  console.log('\nSubRip conversion')
  const srt = [
    '1',
    '00:00:01,000 --> 00:00:03,500',
    'İyi akşamlar.',
    '',
    '2',
    '00:00:04,000 --> 00:00:06,000',
    'Two',
    'lines.',
    ''
  ].join('\n')

  const converted = srtToVtt(srt)
  check('emits a WEBVTT header', isWebVtt(converted.vtt))
  check('converts both cues', converted.cues === 2, converted.cues)
  check('commas become dots', converted.vtt.includes('00:00:01.000 --> 00:00:03.500'))
  check('drops the numeric index line', !/^\s*1\s*$/m.test(converted.vtt.split('\n').slice(2).join('\n')))
  check('keeps multi-line cue text', converted.vtt.includes('Two\nlines.'))

  // The converted output has to survive the renderer's own parser.
  const reparsed = parseCueBlocks(`${converted.vtt}\n\n`)
  check('the renderer parses what the converter emits', reparsed.cues.length === 2, reparsed.cues.length)
  check('timings round-trip', reparsed.cues[0]?.startSecs === 1 && reparsed.cues[0]?.endSecs === 3.5)
  check('turkish text round-trips', reparsed.cues[0]?.text === 'İyi akşamlar.', reparsed.cues[0]?.text)

  check('CRLF files convert', srtToVtt(srt.replace(/\n/g, '\r\n')).cues === 2)
  check('an empty file yields no cues', srtToVtt('').cues === 0)
  check('junk yields no cues', srtToVtt('not a subtitle at all').cues === 0)

  console.log('\nLoading real files')
  const srtPath = join(work, 'movie.tr.srt')
  writeFileSync(srtPath, srt, 'utf8')
  const loaded = await loadSubtitleFile(srtPath)
  check('label comes from the file name', loaded.label === 'movie.tr', loaded.label)
  check('cue count is reported', loaded.cues === 2)
  check('output is WebVTT', isWebVtt(loaded.vtt))

  // A Windows-1254 file on disk, the way a Turkish subtitle usually arrives.
  const legacyPath = join(work, 'legacy.srt')
  const legacyBody = Buffer.concat([
    Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nak', 'latin1'),
    Buffer.from([0xfe]),
    Buffer.from('am\n', 'latin1')
  ])
  writeFileSync(legacyPath, legacyBody)
  const legacy = await loadSubtitleFile(legacyPath)
  check('a windows-1254 file loads', legacy.cues === 1)
  check('and its characters are correct', legacy.vtt.includes('akşam'), legacy.vtt)

  const emptyPath = join(work, 'empty.srt')
  writeFileSync(emptyPath, 'nothing here', 'utf8')
  let rejected = false
  try {
    await loadSubtitleFile(emptyPath)
  } catch {
    rejected = true
  }
  check('a file with no cues is rejected rather than shown blank', rejected)

  const vttPath = join(work, 'already.vtt')
  writeFileSync(vttPath, 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n', 'utf8')
  const passthrough = await loadSubtitleFile(vttPath)
  check('an existing WebVTT file passes through', passthrough.cues === 1)

  console.log('\nVideo info from the probe')
  check('parses a simple rate', parseFrameRate('25/1') === 25)
  check('parses NTSC', parseFrameRate('30000/1001') === 29.97)
  check('rejects a zero denominator', parseFrameRate('25/0') === null)
  check('rejects nonsense', parseFrameRate('abc') === null)
  check('rejects an absurd rate', parseFrameRate('90000/1') === null)

  const probeJson = JSON.stringify({
    streams: [
      {
        codec_type: 'video',
        codec_name: 'h264',
        width: 1920,
        height: 1080,
        avg_frame_rate: '50/1',
        r_frame_rate: '90000/1',
        bit_rate: '4500000'
      },
      { codec_type: 'audio', codec_name: 'aac', channels: 6, tags: { language: 'ger' } }
    ],
    format: { duration: '5400.5', bit_rate: '5000000' }
  })

  const probe = parseProbeOutput(probeJson)
  check('reads the resolution', probe.videoInfo?.width === 1920 && probe.videoInfo?.height === 1080)
  check(
    'prefers the average rate over a bogus declared one',
    probe.videoInfo?.fps === 50,
    probe.videoInfo?.fps
  )
  check('reads the bitrate', probe.videoInfo?.bitrate === 4_500_000)
  check('reads the codec', probe.videoInfo?.codec === 'h264')
  check('still reads tracks alongside', probe.tracks.audio[0]?.label === 'German (5.1)', probe.tracks.audio[0]?.label)

  const noVideo = parseProbeOutput(JSON.stringify({ streams: [{ codec_type: 'audio', codec_name: 'aac' }] }))
  check('a radio stream has no video info', noVideo.videoInfo === null)
}

void main().then(
  () => {
    console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`)
    process.exit(failures === 0 ? 0 : 1)
  },
  (error) => {
    console.error('\nTest run threw:', error)
    process.exit(1)
  }
)
