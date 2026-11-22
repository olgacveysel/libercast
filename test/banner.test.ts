/**
 * Reading a stream's identity out of ffmpeg's own output.
 *
 * On a single-connection account LiberCast does not probe a live channel
 * before playing it, because ffprobe and ffmpeg back to back is two
 * connections and the second is the one that gets refused. It plays on a
 * guess instead — and when the guess is wrong the copy fails, the stream is
 * reopened and re-encoded, every single time that channel is opened.
 *
 * ffmpeg prints what the stream actually is, over the connection already
 * open. Reading it turns that into a cost paid once per channel instead of
 * once per play.
 *
 * The first half of this file checks the reading against the real thing: a
 * clip is built, ffmpeg's banner for it is parsed, and the answer is compared
 * against what ffprobe says about the same file. Agreeing with ffprobe is the
 * whole claim, so it is tested against ffprobe rather than against my idea of
 * what ffmpeg prints.
 *
 * The second half uses fixed text for the cases a generated clip cannot
 * easily produce — an interlaced broadcast stream above all, which is the one
 * the Source line exists to show.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffprobeStatic from 'ffprobe-static'
import { ffmpegPath } from './browser/ffmpeg.cjs'
import { bannerToProbeOutput, readInputBanner } from '@main/media/banner'
import { knownProbe, parseProbeOutput, rememberProbe } from '@main/media/probe'
import { planForSelection } from '@main/media/streamServer'

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

const work = mkdtempSync(join(tmpdir(), 'libercast-banner-'))
const clip = join(work, 'clip.mkv')

console.log('\nbanner\n')

/* A small clip with two audio tracks in different codecs and languages —
   the shape that caused the silent-English bug, and the shape whose tracks
   the picker has to get right. */
const made = spawnSync(
  ffmpegPath(),
  [
    '-hide_banner', '-nostdin',
    '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25',
    '-f', 'lavfi', '-i', 'sine=frequency=440',
    '-f', 'lavfi', '-i', 'sine=frequency=880',
    '-map', '0:v', '-map', '1:a', '-map', '2:a', '-t', '1',
    '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-c:a:0', 'aac', '-c:a:1', 'ac3',
    '-metadata:s:a:0', 'language=tur', '-metadata:s:a:1', 'language=eng',
    '-f', 'matroska', clip, '-y'
  ],
  { encoding: 'utf8' }
)
check('a fixture clip can be built', made.status === 0, made.stderr?.slice(-300))

if (made.status === 0) {
  /* Opening it the way the player does, and keeping what ffmpeg says. */
  const played = spawnSync(
    ffmpegPath(),
    ['-hide_banner', '-nostdin', '-i', clip, '-c', 'copy', '-f', 'matroska', join(work, 'out.mkv'), '-y'],
    { encoding: 'utf8' }
  )
  const fromBanner = readInputBanner(played.stderr ?? '')
  check('ffmpeg describes what it opened', fromBanner !== null, played.stderr?.slice(0, 400))

  /* And what a real probe says about the same file. */
  const ffprobe = ffprobeStatic.path
  const probed = spawnSync(
    ffprobe,
    ['-v', 'quiet', '-print_format', 'json', '-show_streams', '-show_format', clip],
    { encoding: 'utf8' }
  )
  const fromProbe = probed.status === 0 ? parseProbeOutput(probed.stdout) : null
  check('and ffprobe can be asked the same thing', fromProbe !== null)

  if (fromBanner && fromProbe) {
    check('the video codec agrees', fromBanner.video === fromProbe.video, [fromBanner.video, fromProbe.video])
    check('the first audio codec agrees', fromBanner.audio === fromProbe.audio, [fromBanner.audio, fromProbe.audio])
    check('the container agrees', fromBanner.container === fromProbe.container, [fromBanner.container, fromProbe.container])
    check(
      'both audio tracks are found, in order, with their codecs',
      JSON.stringify(fromBanner.tracks.audio.map((t) => t.codec)) ===
        JSON.stringify(fromProbe.tracks.audio.map((t) => t.codec)),
      fromBanner.tracks.audio.map((t) => t.codec)
    )
    check(
      'with their languages',
      JSON.stringify(fromBanner.tracks.audio.map((t) => t.language)) ===
        JSON.stringify(fromProbe.tracks.audio.map((t) => t.language)),
      fromBanner.tracks.audio.map((t) => t.language)
    )
    check(
      'and the labels the picker shows come out identical',
      JSON.stringify(fromBanner.tracks.audio.map((t) => t.label)) ===
        JSON.stringify(fromProbe.tracks.audio.map((t) => t.label)),
      fromBanner.tracks.audio.map((t) => t.label)
    )
    check(
      'the picture is described the same way',
      fromBanner.videoInfo?.width === fromProbe.videoInfo?.width &&
        fromBanner.videoInfo?.height === fromProbe.videoInfo?.height &&
        fromBanner.videoInfo?.profile === fromProbe.videoInfo?.profile &&
        fromBanner.videoInfo?.pixelFormat === fromProbe.videoInfo?.pixelFormat &&
        fromBanner.videoInfo?.fieldOrder === fromProbe.videoInfo?.fieldOrder,
      [fromBanner.videoInfo, fromProbe.videoInfo]
    )
  }
}

/*
  What a broadcast channel looks like: interlaced, two audio languages, the
  second in a codec Chromium cannot decode. This is the exact shape that
  played silently in English, and the exact shape the Source line was added
  to make visible.
*/
const BROADCAST = `Input #0, mpegts, from 'http://example.invalid/live/1.ts':
  Duration: N/A, start: 1.400000, bitrate: N/A
  Program 1
    Metadata:
      service_name    : A channel
  Stream #0:0[0x100]: Video: h264 (High) ([27][0][0][0] / 0x001B), yuv420p(tv, bt709, top first), 1920x1080 [SAR 1:1 DAR 16:9], 25 fps, 50 tbr, 90k tbn
  Stream #0:1[0x101](tur): Audio: aac (LC) ([15][0][0][0] / 0x000F), 48000 Hz, stereo, fltp, 128 kb/s
  Stream #0:2[0x102](eng): Audio: eac3 ([6][0][0][0] / 0x0006), 48000 Hz, 5.1(side), fltp, 384 kb/s
  Stream #0:3[0x103](ger): Subtitle: dvb_subtitle ([6][0][0][0] / 0x0006)
Stream mapping:
  Stream #0:0 -> #0:0 (copy)
`

const broadcast = readInputBanner(BROADCAST)
check('a broadcast banner is read', broadcast !== null)
if (broadcast) {
  check('the picture is 1080', broadcast.videoInfo?.height === 1080, broadcast.videoInfo)
  check(
    'and it is known to be interlaced, which is what the Source line is for',
    broadcast.videoInfo?.interlaced === true && broadcast.videoInfo.fieldOrder === 'tt',
    broadcast.videoInfo
  )
  check('the profile is kept, not the fourcc', broadcast.videoInfo?.profile === 'High', broadcast.videoInfo?.profile)
  check('both languages are offered', broadcast.tracks.audio.length === 2, broadcast.tracks.audio)
  check(
    'the second is E-AC-3, which is what decides it must be re-encoded',
    broadcast.tracks.audio[1]?.codec === 'eac3',
    broadcast.tracks.audio
  )
  check('and is labelled by its channel layout', broadcast.tracks.audio[1]?.channels === 6, broadcast.tracks.audio[1])
  check(
    'a bitmap subtitle is seen and marked as one',
    broadcast.tracks.subtitle[0]?.isTextBased === false,
    broadcast.tracks.subtitle
  )
  check('a live stream reports no duration', broadcast.durationSecs === null, broadcast.durationSecs)
}

/*
  What must NOT be believed. Each of these would otherwise be stored and
  consulted on the next play, so a wrong answer here is worse than no answer:
  it is a wrong answer that persists.
*/
const progressive = readInputBanner(BROADCAST.replace('top first', 'progressive'))
check('a progressive stream is not called interlaced', progressive?.videoInfo?.interlaced === false)

const undeclared = readInputBanner(BROADCAST.replace('(tv, bt709, top first)', '(tv, bt709)'))
check(
  'a stream that declares no field order makes no claim either way',
  undeclared?.videoInfo?.fieldOrder === null && undeclared.videoInfo.interlaced === null,
  undeclared?.videoInfo
)

check('warnings alone are not an identification', readInputBanner('[mpegts] PES packet size mismatch\n') === null)
check('an empty banner is not one either', readInputBanner('') === null)
check(
  'a banner cut off before any stream is not believed',
  readInputBanner("Input #0, mpegts, from 'http://example.invalid/x':\n  Duration: N/A\n") === null
)
check(
  'and neither is one with no video in it',
  readInputBanner(
    "Input #0, mp3, from 'http://example.invalid/x':\n  Stream #0:0: Audio: mp3, 44100 Hz, stereo\nStream mapping:\n"
  ) === null
)

/*
  The output side of the same text. ffmpeg prints `Stream #0:0` lines for what
  it is writing as well as for what it opened, and those describe LiberCast's
  own muxing — reading them would store the answer to the wrong question.
*/
const withOutput = `${BROADCAST}Output #0, mp4, to 'pipe:':
  Stream #0:0: Video: hevc, yuv420p10le, 3840x2160, 60 fps
  Stream #0:1: Audio: opus, 48000 Hz, mono
`
const stopped = readInputBanner(withOutput)
check(
  'the output section is ignored',
  stopped?.videoInfo?.codec === 'h264' && stopped.tracks.audio.length === 2,
  stopped?.videoInfo
)

/* A second input is the subtitle connection or a filter, not the channel. */
const twoInputs = `${BROADCAST.split('Stream mapping:')[0]}Input #1, lavfi, from 'anullsrc':
  Stream #1:0: Audio: pcm_s16le, 44100 Hz, stereo
Stream mapping:
`
check(
  'a second input does not add its streams to the first',
  readInputBanner(twoInputs)?.tracks.audio.length === 2,
  readInputBanner(twoInputs)?.tracks.audio.length
)

check('and the shaped output is JSON a probe parser accepts', (() => {
  const json = bannerToProbeOutput(BROADCAST)
  if (json === null) return false
  return parseProbeOutput(json).video === 'h264'
})())

/*
  What any of this is for.

  The guess a frugal open starts from is h264 and AAC, so the English E-AC-3
  track on the channel above is planned as a copy — which fails at the muxer,
  because Chromium has no E-AC-3 decoder and the MP4 it would produce is
  unplayable. Once the stream has been identified, the same choice plans a
  re-encode on the first attempt instead. That difference is the feature.
*/
console.log('\nwhat it changes\n')

const url = 'http://example.invalid/live/1.ts'
const guess = { video: 'h264', audio: 'aac', durationSecs: null, container: 'mpegts',
  tracks: { audio: [], subtitle: [] }, videoInfo: null, ok: true, error: null }

check('nothing is known about a channel never played', knownProbe(url) === null)
check(
  'so the guess would copy the audio, which is what fails',
  planForSelection(guess, 1, false).audioCopy
)

rememberProbe(url, broadcast!, true)
const recalled = knownProbe(url)
check('after one play it is known', recalled !== null)
check('with the track that was silent', recalled?.tracks.audio[1]?.codec === 'eac3')
check(
  'and now the second track is planned as a re-encode from the start',
  recalled !== null && !planForSelection(recalled, 1, false).audioCopy
)
check(
  'while the first, which really is AAC, is still copied',
  recalled !== null && planForSelection(recalled, 0, false).audioCopy
)

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`)
process.exit(failures === 0 ? 0 : 1)
