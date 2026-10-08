import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/**
 * A copy of the log on disk.
 *
 * A packaged Windows application has no console, so everything the logger
 * writes is invisible to whoever is running it — which makes a bug report from
 * a tester a description rather than evidence. This is the file they can send.
 *
 * Deliberately dependency-free and best-effort: if anything here fails, the
 * application carries on without a log file rather than not starting.
 */

/** Rotate at 2 MB. Two files, so a session's history survives one restart. */
const MAX_BYTES = 2 * 1024 * 1024

let started = false
let broken = false
let folder: string | null = null

/** Where the files live, or null before the app knows its own paths. */
export function logFolder(): string | null {
  if (folder) return folder
  try {
    folder = join(app.getPath('userData'), 'logs')
    return folder
  } catch {
    // Called before Electron can resolve paths. The caller falls back to the
    // console, and the next call will succeed.
    return null
  }
}

export function logFilePath(): string | null {
  const base = logFolder()
  return base === null ? null : join(base, 'libercast.log')
}

/**
 * Appends one already-formatted, already-redacted line.
 *
 * Redaction happens in the logger before this is called. Nothing should reach
 * this function that has not been through it: this file is written to be sent
 * to someone else.
 */
export function appendLogLine(line: string): void {
  if (broken) return

  const path = logFilePath()
  if (path === null) return

  try {
    if (!started) {
      mkdirSync(logFolder()!, { recursive: true })
      rotateIfLarge(path)
      started = true
      appendFileSync(
        path,
        `\n=== ${app.getName()} ${app.getVersion()} started ${new Date().toISOString()} ===\n`
      )
    }

    // Synchronous on purpose. A write stream buffers, and the lines worth
    // having are the ones written just before a crash — exactly the ones a
    // buffer loses. The volume is a few lines per action, so the cost of doing
    // it this way is not measurable next to the work being logged.
    appendFileSync(path, `${line}\n`)
  } catch {
    // Out of disk, or a folder that cannot be written. Give up quietly rather
    // than throwing on every log call for the rest of the session.
    broken = true
  }
}

function rotateIfLarge(path: string): void {
  try {
    if (statSync(path).size < MAX_BYTES) return
    renameSync(path, `${path}.1`)
  } catch {
    // No file yet, or it cannot be moved because something else has it open.
    // Either way, keep appending to what is there.
  }
}
