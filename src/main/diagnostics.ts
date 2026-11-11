import { arch, platform, release, totalmem } from 'node:os'
import { app } from 'electron'
import type { DiagnosticsReport } from '@shared/types'
import { binaries } from '@main/media/binaries'
import { getSettings } from '@main/db/repo/settings'
import { logFilePath } from '@main/util/logfile'

/**
 * Everything worth knowing about this installation, in one call.
 *
 * This exists because answering one question — why a stream that Chromium can
 * decode in hardware is being decoded in software — took eight exchanges and
 * two throwaway scripts, most of which were spent establishing facts the
 * application already knew: which ffmpeg it had resolved, what the GPU
 * reported, whether acceleration was even switched on.
 *
 * None of it is diagnosis. It is the context a diagnosis needs, gathered
 * before anyone has to ask for it, in a form that can be pasted into an issue.
 */
export function collectDiagnostics(): DiagnosticsReport {
  /*
   * Asked now rather than at startup, and that is not incidental.
   *
   * `getGPUFeatureStatus` consulted before the GPU process has finished
   * initialising answers `disabled_software` for every feature — which is
   * what the first version of the throwaway script did, and it produced a
   * confident, completely wrong report about a machine whose decoding was
   * fine. By the time a person can click a button, a window has been drawn
   * and the answer is real.
   */
  let features: Record<string, string> = {}
  try {
    features = app.getGPUFeatureStatus() as unknown as Record<string, string>
  } catch {
    // Not available on a headless or very early call; an empty map says so.
  }

  const resolved = binaries()

  return {
    generatedAt: Date.now(),
    app: { version: app.getVersion(), packaged: app.isPackaged },
    runtime: {
      electron: process.versions['electron'] ?? 'unknown',
      chrome: process.versions['chrome'] ?? 'unknown',
      node: process.versions['node'] ?? 'unknown',
      v8: process.versions['v8'] ?? 'unknown'
    },
    system: {
      platform: platform(),
      arch: arch(),
      release: release(),
      memoryGb: Math.round((totalmem() / 1024 ** 3) * 10) / 10
    },
    gpu: {
      features,
      // The switch the user holds, which is not the same as what Chromium
      // decided. Both belong in the report: "acceleration is on and video
      // decode is still software" is a different bug from "acceleration is
      // off and nobody remembered".
      accelerationEnabled: getSettings().hardwareAcceleration
    },
    media: {
      ffmpeg: resolved.ffmpeg,
      ffmpegSource: resolved.source.ffmpeg,
      ffprobe: resolved.ffprobe,
      ffprobeSource: resolved.source.ffprobe
    },
    logPath: logFilePath()
  }
}

/**
 * The report as text, for pasting into an issue.
 *
 * Plain lines rather than JSON: this gets attached to a bug report by someone
 * who is already annoyed, and a wall of braces invites being trimmed to the
 * part they think matters.
 */
export function formatDiagnostics(report: DiagnosticsReport, stream?: string | null): string {
  const lines: string[] = [
    `LiberCast ${report.app.version}${report.app.packaged ? '' : ' (development build)'}`,
    `Generated ${new Date(report.generatedAt).toISOString()}`,
    '',
    `System       ${report.system.platform} ${report.system.arch}, kernel ${report.system.release}, ${report.system.memoryGb} GB`,
    `Runtime      Electron ${report.runtime.electron}, Chromium ${report.runtime.chrome}, Node ${report.runtime.node}`,
    '',
    `Acceleration ${report.gpu.accelerationEnabled ? 'on in Settings' : 'OFF in Settings'}`
  ]

  const features = Object.entries(report.gpu.features)
  if (features.length === 0) lines.push('GPU          no status reported')
  else for (const [name, status] of features) lines.push(`  ${name.padEnd(26)} ${status}`)

  lines.push(
    '',
    `ffmpeg       ${report.media.ffmpeg ?? 'not found'} (${report.media.ffmpegSource})`,
    `ffprobe      ${report.media.ffprobe ?? 'not found'} (${report.media.ffprobeSource})`,
    `Log file     ${report.logPath ?? 'none yet'}`
  )

  if (stream) lines.push('', `Playing      ${stream}`)

  return lines.join('\n')
}
