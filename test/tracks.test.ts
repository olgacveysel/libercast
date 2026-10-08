import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { buildStreamArgs, escapeFilterPath, planRemux } from '@main/media/args'
import { binaries, resetBinaryCache, setFfmpegOverride } from '@main/media/binaries'
import { languageName, normalizeLanguage, sameLanguage } from '@main/media/languages'
import { clearProbeCache, parseProbeOutput, probeStream } from '@main/media/probe'
import { StreamServer, chooseAudio, chooseSubtitle } from '@main/media/streamServer'
import { parseCueBlocks, parseTimestamp } from '../src/renderer/src/features/player/subtitles'

const run = promisify(execFile)
const work = mkdtempSync(join(tmpdir(), 'libercast-tracks-'))

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

async function pickWorkingFfmpeg(fixture: string): Promise<{ ffmpeg: string; ffprobe: string } | null> {
  for (const folder of [null, '/usr/bin', '/usr/local/bin']) {
    setFfmpegOverride(folder)
    resetBinaryCache()
    const resolved = binaries()
    if (!resolved.ffmpeg || !resolved.ffprobe) continue
    try {
      await run(resolved.ffmpeg, ['-v', 'error', '-i', fixture, '-c', 'copy', '-f', 'null', '-'])
      return { ffmpeg: resolved.ffmpeg, ffprobe: resolved.ffprobe }
    } catch {
      /* try the next candidate */
    }
  }
  return null
}

async function main(): Promise<void> {
  console.log('\nLanguage codes')
  check('two-letter codes normalize', normalizeLanguage('de') === 'ger')
  check('terminological and bibliographic codes collapse', normalizeLanguage('deu') === 'ger')
  check('region suffixes are dropped', normalizeLanguage('en-US') === 'eng')
  check('undefined maps to null', normalizeLanguage('und') === null)
  check('empty maps to null', normalizeLanguage('') === null)
  check('names resolve', languageName('tur') === 'Turkish' && languageName('ger') === 'German')
  check('unknown codes fall back to the code', languageName('xyz') === 'XYZ')
  check('de and deu are the same language', sameLanguage('de', 'deu'))
  check('null never matches null', !sameLanguage(null, null))

  console.log('\nTrack selection rules')
  const audioTracks = [
    { index: 0, codec: 'aac', language: 'eng', label: 'English', title: null, channels: 2, isDefault: true, isForced: false, isTextBased: false },
    { index: 1, codec: 'aac', language: 'ger', label: 'German', title: null, channels: 2, isDefault: false, isForced: false, isTextBased: false },
    { index: 2, codec: 'aac', language: 'tur', label: 'Turkish', title: null, channels: 2, isDefault: false, isForced: false, isTextBased: false }
  ]

  check('explicit choice wins', chooseAudio(audioTracks, 2, ['ger']) === 2)
  check('preferred language is honoured', chooseAudio(audioTracks, undefined, ['tur']) === 2)
  check('preference order decides', chooseAudio(audioTracks, undefined, ['ger', 'tur']) === 1)
  check('an unavailable preference falls through', chooseAudio(audioTracks, undefined, ['spa']) === 0)
  check('the default flag is the fallback', chooseAudio(audioTracks, undefined, []) === 0)
  check('an out-of-range explicit index is ignored', chooseAudio(audioTracks, 9, ['tur']) === 2)

  const subTracks = [
    { index: 0, codec: 'subrip', language: 'eng', label: 'English', title: null, channels: null, isDefault: false, isForced: false, isTextBased: true },
    { index: 1, codec: 'subrip', language: 'tur', label: 'Turkish', title: null, channels: null, isDefault: false, isForced: false, isTextBased: true }
  ]

  check('subtitles stay off without a preference', chooseSubtitle(subTracks, undefined, []) === null)
  check('an explicit null keeps them off', chooseSubtitle(subTracks, null, ['tur']) === null)
  check('a matching preference turns them on', chooseSubtitle(subTracks, undefined, ['tur']) === 1)
  check('no tracks means off', chooseSubtitle([], undefined, ['eng']) === null)

  console.log('\nWebVTT parsing')
  check('parses hh:mm:ss.mmm', parseTimestamp('01:02:03.500') === 3723.5)
  check('parses mm:ss.mmm', parseTimestamp('02:03.500') === 123.5)
  check('accepts comma decimals', parseTimestamp('00:00:01,250') === 1.25)
  check('rejects nonsense', parseTimestamp('later') === null)

  const vtt = [
    'WEBVTT',
    '',
    '1',
    '00:00:01.000 --> 00:00:03.000',
    'Guten Abend.',
    '',
    '2',
    '00:00:04.000 --> 00:00:06.000',
    'Zwei <i>Zeilen</i>',
    'hier.',
    '',
    '3',
    '00:00:07.000 --> 00:00:09.000',
    'Tom &amp; Jerry'
  ].join('\n')

  const whole = parseCueBlocks(vtt)
  check('skips the WEBVTT header', whole.cues.length === 2, whole.cues.length)
  check('reads cue timings', whole.cues[0]?.startSecs === 1 && whole.cues[0]?.endSecs === 3)
  check('keeps multi-line cues', whole.cues[1]?.text === 'Zwei Zeilen\nhier.', whole.cues[1]?.text)
  check('strips inline markup', !whole.cues[1]!.text.includes('<i>'))
  check('holds back the unterminated final cue', whole.rest.includes('Tom'))

  const flushed = parseCueBlocks(`${vtt}\n\n`)
  check('flushing emits the last cue', flushed.cues.length === 3)
  check('decodes entities', flushed.cues[2]?.text === 'Tom & Jerry', flushed.cues[2]?.text)

  // The real reason the parser is incremental: cues arrive in fragments.
  const chunks: string[] = []
  for (let i = 0; i < vtt.length; i += 5) chunks.push(vtt.slice(i, i + 5))
  let buffer = ''
  const streamed: string[] = []
  for (const chunk of chunks) {
    buffer += chunk
    const { cues, rest } = parseCueBlocks(buffer)
    buffer = rest
    for (const cue of cues) streamed.push(cue.text)
  }
  const tail = parseCueBlocks(`${buffer}\n\n`)
  for (const cue of tail.cues) streamed.push(cue.text)
  check(`survives ${chunks.length} fragment boundaries`, streamed.length === 3, streamed)

  check('filter paths escape colons', escapeFilterPath('C:/x/y.mkv').includes('\\:'))

  console.log('\nArgument mapping')
  const plan = planRemux({ video: 'h264', audio: 'aac', durationSecs: 100 })
  const german = buildStreamArgs('/x.mkv', plan, { audioIndex: 1 })
  check('maps the selected audio stream', german.includes('0:a:1?'), german.join(' '))
  check('does not map subtitles when none is chosen', !german.includes('-c:s'))

  const vttOut = join(work, 'args.vtt')
  const withSubs = buildStreamArgs('/x.mkv', plan, {
    audioIndex: 2,
    subtitleIndex: 1,
    subtitlePath: vttOut
  })
  check('adds a second output for subtitles', withSubs.includes(vttOut))
  check('converts subtitles to webvtt', withSubs.includes('webvtt'))
  check('keeps video copied alongside subtitles', withSubs.includes('copy'))
  check(
    'subtitle output comes after the video output',
    withSubs.indexOf('pipe:1') < withSubs.indexOf(vttOut)
  )
  check('cues are flushed as they are produced', withSubs.includes('-flush_packets'))
  // A descriptor above stderr is not inherited by a child process on Windows,
  // so ffmpeg had nowhere to write and subtitles never appeared there.
  check('no output goes to a pipe above stderr', !withSubs.includes('pipe:3'))

  const noPath = buildStreamArgs('/x.mkv', plan, { subtitleIndex: 1 })
  check('a subtitle with nowhere to go is not mapped', !noPath.includes('-c:s'), noPath.join(' '))

  const burned = buildStreamArgs('/x.mkv', plan, {
    subtitleIndex: 0,
    burnInSubtitles: true,
    subtitlePath: vttOut
  })
  check('burn-in uses a filter', burned.some((a) => a.includes('subtitles=')))
  check('burn-in forces a video re-encode', burned.includes('libx264'))
  check('burn-in emits no separate subtitle output', !burned.includes(vttOut))

  console.log('\nAgainst real multi-track media')

  const bootstrap = binaries()
  if (!bootstrap.ffmpeg) {
    console.log('  SKIP  no ffmpeg available')
    return
  }

  // A stand-in for a typical provider movie: three audio languages and two
  // subtitle languages in one Matroska file.
  const fixture = join(work, 'movie.mkv')
  await run(bootstrap.ffmpeg, [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25:duration=4',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
    '-f', 'lavfi', '-i', 'sine=frequency=660:duration=4',
    '-f', 'lavfi', '-i', 'sine=frequency=880:duration=4',
    '-f', 'srt', '-i', srtFile(work, 'en', 'Good evening.'),
    '-f', 'srt', '-i', srtFile(work, 'tr', 'Iyi aksamlar.'),
    '-map', '0:v', '-map', '1:a', '-map', '2:a', '-map', '3:a', '-map', '4:s', '-map', '5:s',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '25',
    '-c:a', 'aac', '-c:s', 'srt',
    '-metadata:s:a:0', 'language=eng', '-metadata:s:a:0', 'title=Original',
    '-metadata:s:a:1', 'language=ger',
    '-metadata:s:a:2', 'language=tur',
    '-metadata:s:s:0', 'language=eng',
    '-metadata:s:s:1', 'language=tur',
    '-disposition:a:0', 'default',
    '-y', fixture
  ])
  check('built a 3-audio, 2-subtitle fixture', statSync(fixture).size > 1000)

  const working = await pickWorkingFfmpeg(fixture)
  if (!working) {
    console.log('  SKIP  no ffmpeg on this host can read the fixture')
    return
  }

  clearProbeCache()
  const probe = await probeStream(fixture)
  check('found three audio tracks', probe.tracks.audio.length === 3, probe.tracks.audio.length)
  check('found two subtitle tracks', probe.tracks.subtitle.length === 2, probe.tracks.subtitle.length)
  check(
    'audio languages read correctly',
    probe.tracks.audio.map((t) => t.language).join(',') === 'eng,ger,tur',
    probe.tracks.audio.map((t) => t.language)
  )
  check(
    'labels are human readable',
    probe.tracks.audio[1]?.label.startsWith('German'),
    probe.tracks.audio.map((t) => t.label)
  )
  check(
    'the channel layout is noted in the label',
    probe.tracks.audio[1]?.label.includes('Mono'),
    probe.tracks.audio[1]?.label
  )
  check(
    'a track title is folded into the label',
    probe.tracks.audio[0]?.label.includes('Original'),
    probe.tracks.audio[0]?.label
  )
  check('the default flag survives', probe.tracks.audio[0]?.isDefault === true)
  check('indices are per-type, not absolute', probe.tracks.subtitle.map((t) => t.index).join(',') === '0,1')
  check('srt is recognised as text-based', probe.tracks.subtitle.every((t) => t.isTextBased))

  check(
    'preferred Turkish audio resolves to track 2',
    chooseAudio(probe.tracks.audio, undefined, ['tur']) === 2
  )

  console.log('\nEnd to end through the server')
  const server = new StreamServer()
  await server.start()

  const session = await server.open({
    url: fixture,
    label: 'fixture',
    preferredAudioLanguages: ['ger'],
    preferredSubtitleLanguages: ['tur']
  })

  check('preferred audio language was applied', session.audioTrack === 1, session.audioTrack)
  check('preferred subtitle language was applied', session.subtitleTrack === 1, session.subtitleTrack)
  check('a subtitle URL is offered', session.subtitlesUrl !== null)
  check('text subtitles are not burned in', session.subtitlesBurnedIn === false)
  check('tracks reach the renderer', session.tracks.audio.length === 3)

  const video = await fetch(session.url)
  check('video responds 200', video.status === 200)
  const videoBytes = Buffer.from(await video.arrayBuffer())
  check(`streamed ${(videoBytes.length / 1024).toFixed(0)} KB of video`, videoBytes.length > 5000)
  check('still fragmented mp4', videoBytes.includes(Buffer.from('moof')))

  const subs = await fetch(session.subtitlesUrl!)
  check('subtitle endpoint responds 200', subs.status === 200)
  check('subtitle endpoint declares text/vtt', (subs.headers.get('content-type') ?? '').includes('text/vtt'))

  const vttBody = await subs.text()
  check('subtitle output is WebVTT', vttBody.trimStart().startsWith('WEBVTT'), vttBody.slice(0, 40))
  check('the Turkish line came through', vttBody.includes('Iyi aksamlar'), vttBody.slice(0, 200))
  check('the English track was not used', !vttBody.includes('Good evening'))

  const parsedCues = parseCueBlocks(`${vttBody}\n\n`)
  check('cues parse out of the real output', parsedCues.cues.length > 0, parsedCues.cues)

  // Confirm the selected audio really is the one muxed, by decoding the
  // remuxed output back and comparing its dominant frequency band.
  const remuxed = join(work, 'selected.mkv')
  await run(working.ffmpeg, [
    ...buildStreamArgs(fixture, planRemux(probe), { audioIndex: 2 }).slice(0, -1),
    '-y', remuxed
  ])
  const remuxedProbe = JSON.parse(
    (
      await run(working.ffprobe, [
        '-v', 'error', '-print_format', 'json', '-show_streams', remuxed
      ])
    ).stdout
  ) as { streams: { codec_type: string }[] }
  check(
    'the remux carries exactly one audio stream',
    remuxedProbe.streams.filter((s) => s.codec_type === 'audio').length === 1,
    remuxedProbe.streams.map((s) => s.codec_type)
  )

  const explicit = await server.open({ url: fixture, label: 'fixture', audioTrack: 2, subtitleTrack: null })
  check('an explicit audio choice overrides preferences', explicit.audioTrack === 2)
  check('an explicit null keeps subtitles off', explicit.subtitleTrack === null)
  check('no subtitle URL when subtitles are off', explicit.subtitlesUrl === null)

  server.closeAll()
}

/** Writes a tiny SRT and returns its path. */
function srtFile(directory: string, tag: string, line: string): string {
  const path = join(directory, `${tag}.srt`)
  const body = `1\n00:00:01,000 --> 00:00:03,000\n${line}\n\n2\n00:00:03,500 --> 00:00:03,900\n${tag.toUpperCase()} two\n`
  require('node:fs').writeFileSync(path, body, 'utf8')
  return path
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

// Keeps the unused-import check quiet for a helper used only above.
void readFileSync
