/**
 * ffmpeg argument construction.
 *
 * Kept pure and separate from process spawning so the decisions here — which
 * streams get copied, which get re-encoded, which flags a live source needs —
 * can be asserted in tests without launching anything.
 */

export interface StreamCodecs {
  video: string | null
  audio: string | null
  /** Seconds. Null for live streams. */
  durationSecs: number | null
  /** ffprobe's format name: "mpegts", "matroska,webm", "mov,mp4,…". */
  container?: string | null
}

/**
 * Whether the input carries AAC in ADTS framing.
 *
 * Only MPEG-TS does. AAC inside Matroska or MP4 already has its configuration
 * in the container, and running the ADTS conversion on it makes ffmpeg fail to
 * start at all — "Error initializing bitstream filter: aac_adtstoasc" — which
 * looked like an unplayable file rather than a wrong flag.
 */
export function isAdtsContainer(container: string | null | undefined): boolean {
  if (!container) return false
  return container.split(',').some((name) => name.trim() === 'mpegts' || name.trim() === 'mpeg')
}

/** Codecs the MP4 container and Chromium both accept without re-encoding. */
const VIDEO_COPYABLE = new Set(['h264', 'hevc', 'av1'])
// aac_latm is a different framing that MP4 cannot carry, so it is not here.
const AUDIO_COPYABLE = new Set(['aac'])

export interface RemuxPlan {
  videoCopy: boolean
  audioCopy: boolean
  /**
   * AAC inside MPEG-TS is ADTS-framed, but MP4 requires raw AAC with the
   * configuration in the sample entry. Copying between them without this
   * conversion makes the muxer reject every packet.
   */
  needsAdtsToAsc: boolean
  reason: string
}

export function planRemux(codecs: StreamCodecs, forceTranscode = false): RemuxPlan {
  // An unknown codec means the probe failed. Re-encoding always works, so that
  // is the safe assumption — a black screen is worse than some CPU.
  // `forceTranscode` is set after a copy attempt already failed for this
  // stream, so the second attempt does not repeat a mistake.
  const videoCopy = !forceTranscode && codecs.video !== null && VIDEO_COPYABLE.has(codecs.video)
  const audioCopy = !forceTranscode && codecs.audio !== null && AUDIO_COPYABLE.has(codecs.audio)

  const notes: string[] = []
  if (forceTranscode) notes.push('re-encoding after a copy failure')
  else {
    if (!videoCopy) notes.push(`video ${codecs.video ?? 'unknown'} → h264`)
    if (!audioCopy) notes.push(`audio ${codecs.audio ?? 'unknown'} → aac`)
  }

  return {
    videoCopy,
    audioCopy,
    needsAdtsToAsc: audioCopy && codecs.audio === 'aac' && isAdtsContainer(codecs.container),
    reason: notes.length === 0 ? 'direct copy' : notes.join(', ')
  }
}

export interface InputOptions {
  userAgent?: string | null
  referrer?: string | null
  /** Start this many seconds in. Only meaningful for seekable sources. */
  seekSecs?: number
}

export interface TrackSelection {
  /** Index within the audio tracks. Defaults to the first. */
  audioIndex?: number
  /**
   * Where the WebVTT for the selected subtitle is written.
   *
   * A file rather than an extra pipe. ffmpeg can write a second output to file
   * descriptor 3, and that is what this did — but a child process only inherits
   * descriptors beyond stderr on POSIX. On Windows the descriptor is not there,
   * so ffmpeg had nowhere to write and subtitles silently never appeared, which
   * is exactly what was happening.
   */
  subtitlePath?: string
  /** Index within the subtitle tracks, or null for none. */
  subtitleIndex?: number | null
  /**
   * Render the subtitle into the picture instead of emitting WebVTT. Required
   * for bitmap subtitles, and forces a video re-encode.
   */
  burnInSubtitles?: boolean
  /**
   * Keep the source's own timestamps instead of restarting the stream at zero.
   *
   * Seeking with `-ss` and a stream copy can only start at a keyframe, so the
   * stream really begins a little before the requested point. Zeroing the
   * timestamps throws that difference away and the player then reports a
   * position it invented.
   *
   * Worse, ffmpeg zeroes the two outputs differently — the video by the actual
   * keyframe, the subtitles by the requested seek — so the subtitles end up
   * running ahead of the picture by the size of that gap. Keeping the real
   * timestamps puts both outputs on the source's own timeline, where they
   * agree with each other and with the truth.
   *
   * Only for VOD. A live MPEG-TS carries huge timestamps that wrap, which is
   * what the zeroing is there to absorb.
   */
  absoluteTimestamps?: boolean
}

/**
 * ffmpeg's own User-Agent is `Lavf/<version>`, and a good number of Xtream
 * panels answer that with an error page while serving the same URL happily to a
 * player. Every IPTV client sends something like this for the same reason.
 */
export const DEFAULT_USER_AGENT = 'VLC/3.0.20 LibVLC/3.0.20'

/**
 * HTTP options shared by probing, playback and recording.
 *
 * These must be identical across all three. When the probe used different
 * options than playback, a provider that redirects or that checks the
 * User-Agent would fail in one and succeed in the other, and the mismatch
 * surfaced as codecs being reported as unknown for a stream that plays fine.
 */
/**
 * Options this ffmpeg build has rejected.
 *
 * All of these are documented, but builds differ and ffmpeg aborts the *entire*
 * command on one it does not know — a single unsupported flag does not degrade
 * playback, it ends it. The offending option is removed by name and everything
 * else is kept, because dropping the whole set would also give up the
 * reconnect behaviour on a build that supports it.
 */
const rejected = new Set<string>()

export function setConservativeHttp(value: boolean): void {
  if (value) for (const option of TUNING_OPTIONS) rejected.add(option)
  else rejected.clear()
}

export function isConservativeHttp(): boolean {
  return rejected.size > 0
}

/** Records one specific option as unsupported. Returns false if none was named. */
export function rejectOption(stderr: string): string | null {
  // "Unrecognized option 'x'." and "Failed to set value '1' for option 'x'"
  const match = /(?:unrecognized option|for option)\s+'([a-z0-9_]+)'/i.exec(stderr)
  const name = match?.[1]
  if (!name) return null
  rejected.add(name)
  return name
}

/** Everything that may be dropped. The User-Agent is not among them. */
const TUNING_OPTIONS = [
  'reconnect',
  'reconnect_streamed',
  'reconnect_on_network_error',
  'reconnect_delay_max',
  'rw_timeout'
]

/** ffmpeg complaining that it does not know an option we passed. */
export function looksLikeBadOption(stderr: string): boolean {
  const text = stderr.toLowerCase()
  return (
    text.includes('unrecognized option') ||
    text.includes('option not found') ||
    text.includes('error splitting the argument list')
  )
}

export function httpFlags(url: string, options: InputOptions): string[] {
  // Every one of these belongs to the HTTP protocol handler. Passing them for a
  // local recording makes ffmpeg exit immediately with "Option user_agent not
  // found", so the guard is not a tidiness measure.
  if (!/^https?:/i.test(url)) return []

  // The User-Agent is the one option worth the risk of a build not having it:
  // ffmpeg's own `Lavf/…` is refused outright by a good number of panels.
  const base: string[] = [
    '-user_agent', options.userAgent || DEFAULT_USER_AGENT,
    ...(options.referrer ? ['-referer', options.referrer] : [])
  ]

  // Providers drop connections constantly; without these a single blip ends
  // the stream instead of resuming it. Each is included only if this build has
  // not already refused it.
  const tuning: [string, string][] = [
    ['reconnect', '1'],
    ['reconnect_streamed', '1'],
    ['reconnect_on_network_error', '1'],
    ['reconnect_delay_max', '5'],
    // Microseconds. Stops a silently stalled socket from hanging forever.
    ['rw_timeout', '20000000']
  ]

  for (const [name, value] of tuning) {
    if (!rejected.has(name)) base.push(`-${name}`, value)
  }

  return base
}

/** Flags that only make sense for a network input. */
function inputFlags(url: string, options: InputOptions): string[] {
  const flags = httpFlags(url, options)

  // Seeking before -i makes ffmpeg jump without decoding everything first.
  if (options.seekSecs && options.seekSecs > 0) flags.push('-ss', options.seekSecs.toFixed(3))

  return flags
}

/**
 * Builds the argument list that turns a provider stream into fragmented MP4 on
 * stdout. Fragmented MP4 is what lets Chromium play a stream it is still
 * receiving; a plain MP4 needs its index at the front, which a live source can
 * never provide.
 *
 * When a text subtitle is selected, a *second* output is added carrying WebVTT
 * to `subtitlePath`. Two outputs from one ffmpeg means one connection to the
 * provider, which matters because most Xtream accounts cap concurrent
 * connections — often at one.
 */
export function buildStreamArgs(
  url: string,
  plan: RemuxPlan,
  options: InputOptions & TrackSelection = {}
): string[] {
  const audioIndex = options.audioIndex ?? 0
  const subtitleIndex = options.subtitleIndex ?? null
  const burnIn = subtitleIndex !== null && options.burnInSubtitles === true

  // Burning a subtitle into the picture means the video must be re-encoded,
  // whatever the codec plan said.
  const videoCopy = plan.videoCopy && !burnIn

  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-fflags', '+genpts+discardcorrupt',
    // The muxer writes the track's decoder configuration from what the demuxer
    // found. Give it enough of the stream to find SPS/PPS, or the MP4 header
    // goes out with an empty avcC and the browser reports an unsupported pixel
    // format.
    '-analyzeduration', '6000000',
    '-probesize', '6000000',
    ...inputFlags(url, options),
    '-i', url
  ]

  if (burnIn) {
    // `si` selects which subtitle stream the filter renders. The filter reads
    // the file a second time internally, which is why it is the fallback and
    // not the default path.
    args.push('-filter_complex', `[0:v:0]subtitles=${escapeFilterPath(url)}:si=${subtitleIndex}[vout]`)
    args.push('-map', '[vout]')
  } else {
    args.push('-map', '0:v:0?')
  }

  // Tolerate a missing audio stream — radio channels have none.
  args.push('-map', `0:a:${audioIndex}?`)

  args.push('-c:v', videoCopy ? 'copy' : 'libx264')
  if (!videoCopy) args.push('-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-g', '50')

  args.push('-c:a', plan.audioCopy ? 'copy' : 'aac')
  if (!plan.audioCopy) args.push('-b:a', '160k', '-ac', '2')

  // Without this, copying AAC out of MPEG-TS into MP4 fails on the first packet
  // with "Malformed AAC bitstream detected", and the stream dies rather than
  // degrading — which is exactly what a frozen live channel looks like.
  if (plan.needsAdtsToAsc) args.push('-bsf:a', 'aac_adtstoasc')

  args.push(
    ...(options.absoluteTimestamps
      ? // The source's timeline is kept, so nothing has to be shifted — and
        // nothing may be, or the shift reintroduces the gap this avoids.
        ['-copyts', '-avoid_negative_ts', 'disabled']
      : // Timestamps out of a live TS are frequently non-monotonic.
        ['-avoid_negative_ts', 'make_zero']),
    '-max_muxing_queue_size', '4096',
    // A live TS often interleaves audio and video badly. Without this the muxer
    // waits for the lagging stream and playback stalls in bursts.
    '-max_interleave_delta', '0',
    '-f', 'mp4',
    // delay_moov holds the header back until the first packet, so codec
    // parameters are known before it is written. omit_tfhd_offset is a DASH
    // packaging option and is deliberately absent.
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof+delay_moov',
    '-frag_duration', '2000000',
    'pipe:1'
  )

  if (subtitleIndex !== null && !burnIn && options.subtitlePath) {
    args.push(
      '-map', `0:s:${subtitleIndex}`,
      '-c:s', 'webvtt',
      // Stated again for this output. Left to itself the subtitle muxer offsets
      // cues by the *requested* seek while the video is offset by the keyframe
      // actually reached, and the two drift apart by the difference.
      ...(options.absoluteTimestamps ? ['-copyts'] : []),
      '-f', 'webvtt',
      // Cues have to reach the file as they are produced, not when the muxer's
      // 32KB buffer happens to fill — otherwise subtitles arrive minutes late
      // or, on a short clip, never.
      '-flush_packets', '1',
      '-y',
      options.subtitlePath
    )
  }

  return args
}

/** The subtitles filter treats `:` and `\` as syntax, so both need escaping. */
export function escapeFilterPath(path: string): string {
  return `'${path.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:')}'`
}

export interface RecordOptions extends InputOptions {
  /** Stop after this many seconds. Omitted for an open-ended recording. */
  durationSecs?: number
}

/**
 * Recording never re-encodes: the point is an exact copy of what the provider
 * sent, at near-zero CPU. The container choice follows from the codecs — MP4
 * when it can hold them, MPEG-TS otherwise, which accepts anything.
 */
export function buildRecordArgs(
  url: string,
  outputPath: string,
  codecs: StreamCodecs,
  options: RecordOptions = {}
): string[] {
  const container = recordingContainer(codecs)

  return [
    '-hide_banner',
    '-loglevel', 'error',
    '-fflags', '+genpts+discardcorrupt',
    '-analyzeduration', '6000000',
    '-probesize', '6000000',
    ...inputFlags(url, options),
    '-i', url,
    '-map', '0:v:0?',
    '-map', '0:a:0?',
    '-c', 'copy',
    // Same ADTS-to-ASC conversion as the streaming path, on the same condition:
    // only MPEG-TS input is ADTS-framed, and applying it to anything else stops
    // ffmpeg from starting.
    ...(container === 'mp4' && codecs.audio === 'aac' && isAdtsContainer(codecs.container)
      ? ['-bsf:a', 'aac_adtstoasc']
      : []),
    ...(options.durationSecs ? ['-t', String(Math.ceil(options.durationSecs))] : []),
    '-avoid_negative_ts', 'make_zero',
    '-max_muxing_queue_size', '4096',
    '-max_interleave_delta', '0',
    '-f', container === 'mp4' ? 'mp4' : 'mpegts',
    ...(container === 'mp4' ? ['-movflags', '+faststart'] : []),
    '-y',
    outputPath
  ]
}

export function recordingContainer(codecs: StreamCodecs): 'mp4' | 'ts' {
  const video = codecs.video === null || VIDEO_COPYABLE.has(codecs.video)
  const audio = codecs.audio === null || AUDIO_COPYABLE.has(codecs.audio)
  return video && audio ? 'mp4' : 'ts'
}

export function buildProbeArgs(url: string, options: InputOptions = {}): string[] {
  return [
    '-hide_banner',
    '-loglevel', 'error',
    // Identical to the playback path on purpose — see httpFlags.
    ...httpFlags(url, options),
    '-print_format', 'json',
    '-show_streams',
    '-show_format',
    // A live TS needs a moment of data before its codecs are identifiable, but
    // waiting long makes channel changes feel broken.
    '-analyzeduration', '4000000',
    '-probesize', '4000000',
    url
  ]
}

/** Strips credentials from an argument list before it reaches a log. */
export function redactArgs(args: string[]): string[] {
  return args.map((arg) =>
    /^https?:/i.test(arg)
      ? arg.replace(/\/\/[^/]+\/(live|movie|series)\/[^/]+\/[^/]+\//i, '//***/$1/***/***/')
      : arg
  )
}
