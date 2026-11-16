import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkPathSetting, checkPathSettings, PATH_SETTINGS } from '@main/ipc/paths'

/*
 * The IPC arguments that stop being strings.
 *
 * Payloads arrive as whatever the renderer sent and are trusted by a type
 * that exists only at compile time. For nearly every channel that is fine —
 * the renderer has no Node access, context isolation is on, and a wrong
 * number reaches a bound SQL parameter and fails harmlessly.
 *
 * Three do not fit that description. `ffmpegPath` is a path this application
 * then executes; `recordingsPath` and `downloadsPath` are directories it
 * writes into. Those are checked, and this says so out loud — including the
 * structural half, because the risk is not a wrong rule but a fourth path
 * setting added later with nothing checking it.
 */

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

function refused(value: unknown): string | null {
  try {
    checkPathSetting('The path', value)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

console.log('\nWhat may be stored as a path')
check('an absolute POSIX path', refused('/usr/bin/ffmpeg') === null)
// Both spellings, on either platform: `path.isAbsolute` answers for the host,
// and the rule must not mean one thing here and another on a user's machine.
check('an absolute Windows path', refused('C:\\tools\\ffmpeg.exe') === null)
check('a UNC share', refused('\\\\nas\\media\\recordings') === null)
check('clearing it with null', refused(null) === null)
check('clearing it with an empty string', refused('') === null)
check('and the value comes back trimmed', checkPathSetting('x', '  /usr/bin/ffmpeg  ') === '/usr/bin/ffmpeg')
check('an empty string reads as cleared', checkPathSetting('x', '   ') === null)

console.log('\nWhat may not')
check('a number', refused(42) !== null)
check('an object', refused({ toString: () => '/usr/bin/ffmpeg' }) !== null)
check('an array', refused(['/usr/bin/ffmpeg']) !== null)
check('a relative path', refused('../../usr/bin/ffmpeg') !== null)
check('a bare name', refused('ffmpeg') !== null)

// A NUL ends the string for the operating system but not for JavaScript, so
// one value is two different paths depending on who reads it.
check('a path with a NUL in it', refused('/usr/bin/ffmpeg\0/../../etc/passwd') !== null)
check('something absurdly long', refused(`/${'a'.repeat(5000)}`) !== null)

console.log('\nThe refusals say which setting')
let named: string | null = null
try {
  checkPathSettings({ ffmpegPath: 7 })
} catch (error) {
  named = error instanceof Error ? error.message : String(error)
}
check('the message names the setting', named?.includes('ffmpegPath') === true, named)

// A patch that mentions none of them is nobody's business here.
let untouched = true
try {
  checkPathSettings({ accentColor: '#fff', autoRefreshHours: 12 })
} catch {
  untouched = false
}
check('a patch with no paths in it passes', untouched)

console.log('\nEvery setting that becomes a file or a process')

/*
 * Structural, because the failure mode is a fourth one added later.
 *
 * Any setting whose name ends in "Path" is handed to the filesystem by
 * definition; if one exists that this file does not check, the list has
 * drifted from the thing it describes.
 */
const types = readFileSync(join(process.cwd(), 'src', 'shared', 'types.ts'), 'utf8')
const block = /export interface AppSettings \{([\s\S]*?)\n\}/.exec(types)?.[1] ?? ''
const declared = [...block.matchAll(/^\s{2}(\w*[Pp]ath)\s*[?:]/gm)].map((m) => m[1]!)

check('AppSettings was found and has path settings', declared.length > 0, declared)

const unchecked = declared.filter((name) => !PATH_SETTINGS.includes(name as never))
check('every one of them is validated', unchecked.length === 0, unchecked)

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`)
process.exit(failures === 0 ? 0 : 1)
