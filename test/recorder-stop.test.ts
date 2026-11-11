import { spawn } from 'node:child_process'
import { mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { canBeOpened } from '@main/media/recorder'
import { ffmpegPath } from './browser/ffmpeg.cjs'

/*
 * What a stopped recording leaves behind.
 *
 * The recorder used to send SIGINT and then call anything with bytes in it
 * `completed`. On Windows, Node cannot deliver a POSIX signal: libuv turns
 * `kill('SIGINT')` into `TerminateProcess`, so ffmpeg never wrote the `moov`
 * atom and every stopped recording was an unplayable file with a row saying
 * it had finished.
 *
 * Two claims hold the fix up, and both are checked here against the real
 * ffmpeg this application ships:
 *
 *   1. Writing `q` to ffmpeg's stdin finishes the file. This is ffmpeg's own
 *      quit command and is the same on every platform, which is the whole
 *      reason it replaced the signal.
 *   2. A file left by a hard kill does not open, and `canBeOpened` says so —
 *      which is what stops the row claiming success.
 *
 * These run on Linux in CI, where the signal worked anyway, so they cannot
 * prove the Windows behaviour that caused the bug. They prove the mechanism
 * that replaced it, and that the verification catches what a kill leaves.
 */

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

const work = mkdtempSync(join(tmpdir(), 'libercast-rec-'))

/**
 * Records a few seconds of generated video to an MP4, the way the recorder
 * does — `+faststart`, which is exactly the flag that makes an unfinished
 * file useless, because the index is written at the very end.
 */
function startRecording(target: string): ReturnType<typeof spawn> {
  // `-re` matters: without it ffmpeg renders the whole thirty seconds in under
  // a second and exits on its own, and the test would be stopping a process
  // that had already finished — which is not the situation being tested.
  const child = spawn(
    ffmpegPath(),
    [
      '-hide_banner',
      '-loglevel', 'error',
      '-re',
      '-f', 'lavfi',
      '-i', 'testsrc=size=320x240:rate=15',
      '-t', '30',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-pix_fmt', 'yuv420p',
      '-f', 'mp4',
      '-movflags', '+faststart',
      '-y',
      target
    ],
    { stdio: ['pipe', 'ignore', 'ignore'] }
  )

  // EPIPE when the process is already gone is the expected end of this pipe,
  // not an error; unhandled, it would take the test process down with it.
  child.stdin?.on('error', () => undefined)
  return child
}

function exited(child: ReturnType<typeof spawn>): Promise<number | null> {
  return new Promise((resolve) => child.on('exit', (code) => resolve(code)))
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function sizeOf(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

async function main(): Promise<void> {
  console.log('\nA file ffmpeg finished')
  const finished = join(work, 'finished.mp4')
  const short = spawn(
    ffmpegPath(),
    [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=15',
      '-t', '1', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-f', 'mp4', '-movflags', '+faststart', '-y', finished
    ],
    { stdio: 'ignore' }
  )
  check('ffmpeg exits cleanly', (await exited(short)) === 0)
  check('and the file opens', await canBeOpened(finished))

  console.log('\nA recording stopped with q')
  const stopped = join(work, 'stopped.mp4')
  const quitting = startRecording(stopped)
  await wait(2500)
  check('it is writing', sizeOf(stopped) > 0, sizeOf(stopped))

  // Listening before writing: ffmpeg can be gone by the next tick.
  const quitExit = exited(quitting)
  quitting.stdin?.write('q\n')
  const quitCode = await quitExit
  console.log(`         (ffmpeg exited with code ${quitCode})`)

  check('bytes reached disk', sizeOf(stopped) > 0, sizeOf(stopped))
  // The claim the whole fix rests on. If this fails, `q` is not finishing the
  // container on this build and the recorder has no graceful stop at all.
  check('and the stopped file opens', await canBeOpened(stopped), sizeOf(stopped))

  console.log('\nA recording that was killed')
  const killed = join(work, 'killed.mp4')
  const doomed = startRecording(killed)
  await wait(2500)
  check('it is writing', sizeOf(killed) > 0, sizeOf(killed))

  const doomedExit = exited(doomed)
  doomed.kill('SIGKILL')
  await doomedExit

  check('bytes are on disk', sizeOf(killed) > 0, sizeOf(killed))
  // This is the file the old code called `completed`: megabytes of video with
  // no index in front of it.
  check('but the file does not open', !(await canBeOpened(killed)), sizeOf(killed))

  console.log('\nThings that are not recordings')
  check('a file that does not exist', !(await canBeOpened(join(work, 'nothing.mp4'))))
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
