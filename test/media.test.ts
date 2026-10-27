import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { buildRecordArgs, buildStreamArgs, planRemux, recordingContainer, redactArgs } from '@main/media/args'
import { looksUncopyable } from '@main/media/streamServer'
import { binaries, resetBinaryCache, setFfmpegOverride, unpacked } from '@main/media/binaries'
import { clearProbeCache, probeStream } from '@main/media/probe'
import { StreamServer } from '@main/media/streamServer'

const run = promisify(execFile)

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

const work = mkdtempSync(join(tmpdir(), 'libercast-media-'))

/**
 * Starting is not the same as working. The bundled static build segfaults while
 * demuxing MPEG-TS on some Linux hosts, so the real-media checks below run
 * against whichever binary can actually complete a remux — which doubles as a
 * test of the ffmpegPath override that exists for exactly this situation.
 */
async function pickWorkingFfmpeg(fixture: string): Promise<{ ffmpeg: string; ffprobe: string } | null> {
  const probeOut = join(work, 'smoke.mp4')

  for (const folder of [null, '/usr/bin', '/usr/local/bin']) {
    setFfmpegOverride(folder)
    resetBinaryCache()
    const resolved = binaries()
    if (!resolved.ffmpeg || !resolved.ffprobe) continue

    try {
      await run(resolved.ffmpeg, ['-v', 'error', '-i', fixture, '-c', 'copy', '-f', 'mp4', '-y', probeOut])
      console.log(`  using ffmpeg from ${resolved.source.ffmpeg}: ${resolved.ffmpeg}`)
      return { ffmpeg: resolved.ffmpeg, ffprobe: resolved.ffprobe }
    } catch {
      console.log(`  ${resolved.source.ffmpeg} ffmpeg cannot demux MPEG-TS here; falling back`)
    }
  }
  return null
}

async function main(): Promise<void> {
  const bootstrap = binaries()
  if (!bootstrap.ffmpeg) {
    console.log('\n  SKIP  no ffmpeg available in this environment')
    return
  }

  console.log('\nRemux planning')
  check('h264 + aac copies both streams', (() => {
    const plan = planRemux({ video: 'h264', audio: 'aac', durationSecs: null })
    return plan.videoCopy && plan.audioCopy && plan.reason === 'direct copy'
  })())

  check('ac3 audio is re-encoded, video still copied', (() => {
    const plan = planRemux({ video: 'h264', audio: 'ac3', durationSecs: null })
    return plan.videoCopy && !plan.audioCopy
  })())

  check('mpeg2 video is re-encoded', !planRemux({ video: 'mpeg2video', audio: 'aac', durationSecs: null }).videoCopy)

  check('an unknown codec falls back to re-encoding', (() => {
    const plan = planRemux({ video: null, audio: null, durationSecs: null })
    return !plan.videoCopy && !plan.audioCopy
  })())

  check('hevc is copyable', planRemux({ video: 'hevc', audio: 'aac', durationSecs: null }).videoCopy)

  console.log('\nContainer choice for recordings')
  check('h264 + aac records to mp4', recordingContainer({ video: 'h264', audio: 'aac', durationSecs: null }) === 'mp4')
  check('ac3 forces mpegts', recordingContainer({ video: 'h264', audio: 'ac3', durationSecs: null }) === 'ts')
  check('mpeg2 forces mpegts', recordingContainer({ video: 'mpeg2video', audio: 'aac', durationSecs: null }) === 'ts')

  console.log('\nArgument construction')
  const liveArgs = buildStreamArgs('http://p.example/live/u/p/1.ts', planRemux({ video: 'h264', audio: 'aac', durationSecs: null }))
  check(
    'emits fragmented mp4',
    liveArgs.some((a) => a.startsWith('frag_keyframe+empty_moov')),
    liveArgs.find((a) => a.includes('frag_keyframe'))
  )
  check('writes to stdout', liveArgs.at(-1) === 'pipe:1')
  check('enables http reconnection', liveArgs.includes('-reconnect_streamed'))
  check('sets a read timeout', liveArgs.includes('-rw_timeout'))
  check('tolerates a missing audio track', liveArgs.includes('0:a:0?'))

  const fileArgs = buildStreamArgs('/local/movie.mkv', planRemux({ video: 'h264', audio: 'aac', durationSecs: 60 }))
  check('omits http flags for a local file', !fileArgs.includes('-reconnect'))

  const seekArgs = buildStreamArgs('/local/movie.mkv', planRemux({ video: 'h264', audio: 'aac', durationSecs: 60 }), { seekSecs: 90 })
  check('places -ss before -i so the seek is fast', seekArgs.indexOf('-ss') < seekArgs.indexOf('-i'))

  const recArgs = buildRecordArgs(
    'http://p.example/live/u/p/1.ts',
    '/out/x.mp4',
    { video: 'h264', audio: 'aac', durationSecs: null, container: 'mpegts' },
    { durationSecs: 1800 }
  )
  check('recording never re-encodes', recArgs.includes('-c') && recArgs[recArgs.indexOf('-c') + 1] === 'copy')
  check('recording is bounded by -t', recArgs.includes('-t') && recArgs[recArgs.indexOf('-t') + 1] === '1800')
  check('a recording from MPEG-TS gets the ADTS filter', recArgs.includes('aac_adtstoasc'))

  const mkvRec = buildRecordArgs(
    'http://p.example/movie/u/p/1.mkv',
    '/out/y.mp4',
    { video: 'h264', audio: 'aac', durationSecs: 3600, container: 'matroska,webm' },
    {}
  )
  check('a recording from matroska does not', !mkvRec.includes('aac_adtstoasc'), mkvRec.join(' '))

  check(
    'credentials are stripped from logged arguments',
    !redactArgs(['-i', 'http://host:8080/live/joe/s3cret/42.ts']).join(' ').includes('s3cret'),
    redactArgs(['-i', 'http://host:8080/live/joe/s3cret/42.ts'])
  )

  console.log('\nMPEG-TS to MP4 bitstream handling')
  const tsAac = planRemux({ video: 'h264', audio: 'aac', durationSecs: null, container: 'mpegts' })
  check('copying AAC out of MPEG-TS requires the ADTS-to-ASC filter', tsAac.needsAdtsToAsc)

  // AAC in Matroska or MP4 already carries its configuration in the container.
  // Running the ADTS conversion on it stops ffmpeg from starting at all, with
  // "Error initializing bitstream filter" — which read as an unplayable file.
  for (const container of ['matroska,webm', 'mov,mp4,m4a,3gp,3g2,mj2', 'avi']) {
    check(
      `AAC in ${container.split(',')[0]} does not get the filter`,
      !planRemux({ video: 'h264', audio: 'aac', durationSecs: 3600, container }).needsAdtsToAsc
    )
  }
  check(
    'an unknown container does not get the filter either',
    !planRemux({ video: 'h264', audio: 'aac', durationSecs: null }).needsAdtsToAsc
  )
  check(
    'a matroska source still copies its audio',
    planRemux({ video: 'h264', audio: 'aac', durationSecs: 3600, container: 'matroska,webm' }).audioCopy
  )
  check(
    're-encoded audio does not',
    !planRemux({ video: 'h264', audio: 'ac3', durationSecs: null }).needsAdtsToAsc
  )
  check('latm AAC is not copied at all', !planRemux({ video: 'h264', audio: 'aac_latm', durationSecs: null }).audioCopy)

  const aacArgs = buildStreamArgs('http://p/1.ts', tsAac)
  check('the bitstream filter is passed', aacArgs.includes('aac_adtstoasc'), aacArgs.join(' '))
  check('the header is delayed until codecs are known', aacArgs.some((a) => a.includes('delay_moov')))
  check('the DASH-only flag is gone', !aacArgs.some((a) => a.includes('omit_tfhd_offset')))
  check('interleave stalls are disabled', aacArgs.includes('-max_interleave_delta'))
  check('the input is analysed before the header is written', aacArgs.includes('-analyzeduration'))

  const forced = planRemux({ video: 'h264', audio: 'aac', durationSecs: null }, true)
  check('a forced transcode copies nothing', !forced.videoCopy && !forced.audioCopy)
  check('and says why', forced.reason.includes('copy failure'), forced.reason)
  check('a forced transcode needs no bitstream filter', !forced.needsAdtsToAsc)

  check(
    'the malformed-AAC complaint is recognised',
    looksUncopyable("[mp4 @ 0x1] Malformed AAC bitstream detected: use the audio bitstream filter")
  )
  check('so is a muxing failure', looksUncopyable('[out#0/mp4 @ 0x1] Error muxing a packet'))
  check('an unrelated warning is not', !looksUncopyable('[http @ 0x1] Will reconnect at 1024'))

  console.log('\nAgainst real media')

  // A stand-in for a typical provider live stream: MPEG-TS carrying h264 video
  // and AC-3 audio, neither of which Chromium can play as-is.
  const tsFile = join(work, 'channel.ts')
  await run(bootstrap.ffmpeg, [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25:duration=4',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '25',
    '-c:a', 'ac3',
    '-f', 'mpegts', '-y', tsFile
  ])
  check('built an MPEG-TS fixture', statSync(tsFile).size > 1000)

  const working = await pickWorkingFfmpeg(tsFile)
  if (!working) {
    console.log('  SKIP  no ffmpeg on this host can demux MPEG-TS; remux checks skipped')
    return
  }
  const { ffmpeg, ffprobe } = working
  check('binary override redirects resolution', binaries().ffmpeg === ffmpeg)

  clearProbeCache()
  const codecs = await probeStream(tsFile)
  check('probe identifies h264 video', codecs.video === 'h264', codecs)
  check('probe identifies ac3 audio', codecs.audio === 'ac3', codecs)
  check('probe reports duration', codecs.durationSecs !== null && codecs.durationSecs > 3, codecs.durationSecs)

  const plan = planRemux(codecs)
  check('plan copies video and converts audio', plan.videoCopy && !plan.audioCopy, plan.reason)

  // The end that matters: does the pipeline actually produce something a
  // browser can decode?
  const outFile = join(work, 'out.mp4')
  const streamArgs = buildStreamArgs(tsFile, plan)
  await run(ffmpeg, [...streamArgs.slice(0, -1), '-y', outFile])

  const probed = JSON.parse(
    (await run(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', outFile])).stdout
  ) as { streams: { codec_type: string; codec_name: string }[]; format: { format_name: string } }

  check('remuxed output is mp4', probed.format.format_name.includes('mp4'), probed.format.format_name)
  check('video survived as h264 without re-encoding', probed.streams.some((s) => s.codec_name === 'h264'))
  check('audio was converted to aac', probed.streams.some((s) => s.codec_name === 'aac'), probed.streams.map((s) => s.codec_name))

  const bytes = statSync(outFile).size
  check(`remux produced ${(bytes / 1024).toFixed(0)} KB of output`, bytes > 5000)

  console.log('\nThe stream that used to freeze: H.264 + ADTS AAC in MPEG-TS')

  // This is the exact shape that failed in the field: copying AAC straight out
  // of MPEG-TS into MP4 without converting its framing kills the muxer on the
  // first packet, which looks like a channel that opens and then freezes.
  const aacTs = join(work, 'channel-aac.ts')
  await run(ffmpeg, [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25:duration=4',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '25',
    '-c:a', 'aac',
    '-f', 'mpegts', '-y', aacTs
  ])

  clearProbeCache()
  const aacCodecs = await probeStream(aacTs)
  check('the fixture carries AAC in MPEG-TS', aacCodecs.audio === 'aac', aacCodecs.audio)

  const aacPlan = planRemux(aacCodecs)
  check('both streams are copyable', aacPlan.videoCopy && aacPlan.audioCopy)
  check('and the plan asks for the bitstream filter', aacPlan.needsAdtsToAsc)

  const aacOut = join(work, 'aac-out.mp4')
  await run(ffmpeg, [...buildStreamArgs(aacTs, aacPlan).slice(0, -1), '-y', aacOut])

  const aacProbe = JSON.parse(
    (await run(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_streams', aacOut])).stdout
  ) as { streams: { codec_type: string; codec_name: string }[] }

  check('the remux produced video', aacProbe.streams.some((s) => s.codec_type === 'video'))
  check('and kept the audio', aacProbe.streams.some((s) => s.codec_name === 'aac'))

  const aacBytes = statSync(aacOut).size
  const sourceBytes = statSync(aacTs).size
  // The broken version emitted a tiny fragment before the muxer gave up, so a
  // size close to the source is what proves the whole stream came through.
  check(
    `output is a full remux, not a stalled fragment (${(aacBytes / 1024).toFixed(0)} KB from ${(sourceBytes / 1024).toFixed(0)} KB)`,
    aacBytes > sourceBytes * 0.5,
    aacBytes
  )

  console.log('\nStream server end to end')
  const server = new StreamServer()
  await server.start()
  const session = await server.open({ url: tsFile, label: 'fixture' })

  check('session url is loopback only', session.url.startsWith('http://127.0.0.1:'), session.url)
  check('session url carries an auth token', /token=[0-9a-f]{48}/.test(session.url))
  check('piped sessions report themselves as non-seekable', session.seekable === false)

  const response = await fetch(session.url)
  check('server responds 200', response.status === 200, response.status)
  check('server declares video/mp4', response.headers.get('content-type') === 'video/mp4')

  const body = Buffer.from(await response.arrayBuffer())
  check(`streamed ${(body.length / 1024).toFixed(0)} KB through the server`, body.length > 5000)

  // A fragmented MP4 opens with ftyp and must contain moof boxes; a plain MP4
  // would not, and would be unplayable while still downloading.
  check('output begins with an ftyp box', body.subarray(4, 8).toString('latin1') === 'ftyp')
  check('output contains moof fragments', body.includes(Buffer.from('moof')))
  check('output has no trailing-index moov requirement', body.includes(Buffer.from('moov')))

  const unauthorized = await fetch(session.url.replace(/token=.*/, 'token=wrong'))
  check('a wrong token is rejected', unauthorized.status === 404, unauthorized.status)

  server.close(session.id)
  const closed = await fetch(session.url)
  check('a closed session is gone', closed.status === 410, closed.status)

  console.log('\nFinding the bundled binaries in a packaged build')

  // Electron teaches fs to see inside an asar archive, so both of these answer
  // true to existsSync in a real packaged application. Only one of them can be
  // executed without Electron copying 80 MB to a temp directory first, so the
  // order these are checked in is the whole point.
  //
  // The fixture stands an ordinary directory named `app.asar` in for the real
  // archive, which means Electron's asar shim has to be out of the way: given
  // a path through a would-be archive it tries to open it as one, and on
  // Windows a directory there fails with ENOTDIR before any of this is
  // reached. `unpacked()` is path manipulation over existsSync, so switching
  // the shim off tests exactly what it does, on every platform.
  const hadAsar = process.noAsar
  process.noAsar = true
  const root = mkdtempSync(join(tmpdir(), 'libercast-asar-'))
  const packed = join(root, 'resources', 'app.asar', 'node_modules', 'ffmpeg-static')
  const loose = join(root, 'resources', 'app.asar.unpacked', 'node_modules', 'ffmpeg-static')
  mkdirSync(packed, { recursive: true })
  mkdirSync(loose, { recursive: true })
  writeFileSync(join(packed, 'ffmpeg'), 'packed')
  writeFileSync(join(loose, 'ffmpeg'), 'unpacked')

  check(
    'the unpacked copy wins over the one in the archive',
    unpacked(join(packed, 'ffmpeg')) === join(loose, 'ffmpeg'),
    unpacked(join(packed, 'ffmpeg'))
  )

  // Development: the path has no asar in it and is simply real.
  const plain = join(root, 'node_modules', 'ffmpeg-static')
  mkdirSync(plain, { recursive: true })
  writeFileSync(join(plain, 'ffmpeg'), 'dev')
  check(
    'a development path is returned as it is',
    unpacked(join(plain, 'ffmpeg')) === join(plain, 'ffmpeg')
  )

  // An asar path with nothing unpacked beside it: fall back rather than return
  // a path that does not exist.
  mkdirSync(join(root, 'other', 'app.asar'), { recursive: true })
  const orphan = join(root, 'other', 'app.asar', 'ffprobe')
  writeFileSync(orphan, 'packed only')
  check('an archive path with no unpacked copy is still returned', unpacked(orphan) === orphan)

  check('a missing binary is null', unpacked(join(root, 'nope', 'ffmpeg')) === null)
  check('no path at all is null', unpacked(null) === null && unpacked(undefined) === null)

  process.noAsar = hadAsar

  server.closeAll()
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
