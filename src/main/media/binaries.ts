import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import { createLogger } from '@main/util/logger'

const log = createLogger('media')

export type BinaryKind = 'ffmpeg' | 'ffprobe'

export interface BinaryResolution {
  ffmpeg: string | null
  ffprobe: string | null
  /** Where each one came from, for the Settings screen and bug reports. */
  source: Record<BinaryKind, string>
}

/**
 * ffmpeg and ffprobe ship as real executables, so electron-builder keeps them
 * outside the asar archive (see `asarUnpack`); the packaged path differs from
 * the development one by a single directory segment.
 *
 * The unpacked copy is tried FIRST, before the path the package reported.
 * Checking that one first looks harmless and is not: Electron teaches `fs` to
 * see inside an asar archive, so `existsSync` answers true for a binary that
 * is still packed in it, and the archive path wins. Nothing then appears to be
 * wrong — Electron quietly copies the binary out to a temporary directory to
 * run it — but it copies 80 MB of ffmpeg on every single spawn, and this
 * application spawns one per stream, recording and probe.
 *
 * This only shows up in a packaged build, which is why it survived until the
 * first one.
 */
export function unpacked(path: string | null | undefined): string | null {
  if (!path) return null

  if (path.includes('app.asar')) {
    const relocated = path.replace('app.asar', 'app.asar.unpacked')
    if (existsSync(relocated)) return relocated
  }

  return existsSync(path) ? path : null
}

function onPath(name: string): string | null {
  const executable = process.platform === 'win32' ? `${name}.exe` : name
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (!directory) continue
    const candidate = join(directory, executable)
    if (existsSync(candidate)) return candidate
  }
  return null
}

/**
 * Presence on disk is not enough. A binary can be the wrong architecture, be
 * quarantined by antivirus, or — as seen with some static builds — crash on
 * startup. Running `-version` once costs a few milliseconds and turns a
 * mysterious failure at play time into a clear one at launch.
 */
function works(path: string | null): boolean {
  if (!path) return false
  try {
    execFileSync(path, ['-version'], { stdio: 'ignore', timeout: 8000 })
    return true
  } catch {
    return false
  }
}

interface Candidate {
  path: string | null
  source: string
}

let cached: BinaryResolution | null = null
let override: string | null = null

/** A path the user set in Settings, tried before anything else. */
export function setFfmpegOverride(directoryOrPath: string | null): void {
  override = directoryOrPath
  cached = null
}

function candidates(kind: BinaryKind): Candidate[] {
  const list: Candidate[] = []
  const executable = process.platform === 'win32' ? `${kind}.exe` : kind

  if (override) {
    // Accept either the directory holding both tools or a direct path to one.
    list.push({ path: join(override, executable), source: 'configured folder' })
    if (override.toLowerCase().includes(kind)) list.push({ path: override, source: 'configured path' })
  }

  list.push({
    path: unpacked(kind === 'ffmpeg' ? (ffmpegStatic as string | null) : ffprobeStatic.path),
    source: 'bundled'
  })
  list.push({ path: onPath(kind), source: 'system PATH' })

  return list
}

export function binaries(): BinaryResolution {
  if (cached) return cached

  const resolution: BinaryResolution = {
    ffmpeg: null,
    ffprobe: null,
    source: { ffmpeg: 'not found', ffprobe: 'not found' }
  }

  for (const kind of ['ffmpeg', 'ffprobe'] as BinaryKind[]) {
    for (const candidate of candidates(kind)) {
      if (!candidate.path || !existsSync(candidate.path)) continue

      if (!works(candidate.path)) {
        log.warn(`${kind} at ${candidate.path} (${candidate.source}) failed to run; trying the next option`)
        continue
      }

      resolution[kind] = candidate.path
      resolution.source[kind] = candidate.source
      break
    }
  }

  if (!resolution.ffmpeg) {
    log.warn('no working ffmpeg found — MPEG-TS playback and recording are unavailable')
  } else {
    log.info(`using ffmpeg from ${resolution.source.ffmpeg}: ${resolution.ffmpeg}`)
  }

  cached = resolution
  return resolution
}

export function ffmpegPath(): string {
  const path = binaries().ffmpeg
  if (!path) {
    throw new Error(
      'No working ffmpeg was found. Reinstall dependencies, or set a path to ffmpeg in Settings.'
    )
  }
  return path
}

export function hasFfmpeg(): boolean {
  return binaries().ffmpeg !== null
}

export function resetBinaryCache(): void {
  cached = null
}
