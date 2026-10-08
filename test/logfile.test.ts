import { readFileSync, existsSync } from 'node:fs'
import { createLogger } from '@main/util/logger'
import { logFilePath } from '@main/util/logfile'
import { redact } from '@main/util/http'

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

console.log('\nRedacting credentials')

const panel = 'http://panel.example.com:8080/live/joe/s3cr3t/42.ts'
check('a path password is removed', !redact(panel).includes('s3cr3t'), redact(panel))

const query = 'http://p.example.com/player_api.php?username=joe&password=s3cr3t&action=get_live'
check('a query password is removed', !redact(query).includes('s3cr3t'), redact(query))
check('a query username is removed', !redact(query).includes('joe'), redact(query))
check('the rest of the URL survives', redact(query).includes('action=get_live'), redact(query))

// A single line can carry two URLs — a redirect, or an error naming both the
// URL it tried and the one it fell back to. Redacting only the first would put
// the second one's password in a file that gets emailed.
const two = `tried ${query} then http://q.example.com/api?username=ann&password=hunter2`
check('every password on the line goes', !redact(two).includes('hunter2'), redact(two))
check('every username on the line goes', !redact(two).includes('ann'), redact(two))

const basic = 'http://joe:s3cr3t@panel.example.com/list.m3u'
check('basic auth is removed', redact(basic) === 'http://***:***@panel.example.com/list.m3u', redact(basic))

const twoBasic = `${basic} and http://ann:hunter2@other.example.com/x.m3u`
check('both sets of basic auth go', !redact(twoBasic).includes('hunter2'), redact(twoBasic))

console.log('\nWriting the log file')

const log = createLogger('logtest')
log.info('plain message')
log.warn('a warning about a stream', new Error('connection refused'))

const path = logFilePath()
check('the log has a path', path !== null, path)
check('the file exists once something is logged', path !== null && existsSync(path), path)

const contents = path !== null && existsSync(path) ? readFileSync(path, 'utf8') : ''

check('the message is in it', contents.includes('plain message'))
check('the scope is in it', contents.includes('logtest'))
check('the level is in it', contents.includes('WARN'))
// JSON.stringify on an Error yields "{}", which is the one case that matters
// most in a bug report.
check('an error detail keeps its message', contents.includes('connection refused'), contents.slice(-400))
check('the session header names the version', contents.includes('0.0.0-test'), contents.slice(0, 200))

console.log('\nWhat must never reach the file')

log.error('stream failed', new Error(`GET ${panel} returned 401`))
log.error('sync failed', { url: query, status: 403 })
log.info(`resolved to ${basic}`)

const after = path !== null ? readFileSync(path, 'utf8') : ''
check('no path password reaches the file', !after.includes('s3cr3t'), lastLines(after))
check('no query username reaches the file', !after.includes('username=joe'), lastLines(after))
check('no basic-auth password reaches the file', !after.includes('joe:s3cr3t'), lastLines(after))
// The detail is where credentials hide: it is usually the error carrying the
// URL that failed, and it used to go to the console unredacted.
check('the failing URL is still identifiable', after.includes('panel.example.com'), lastLines(after))
check('the status is still there', after.includes('403'), lastLines(after))

function lastLines(text: string): string {
  return text.split('\n').slice(-6).join('\n')
}

console.log(failures === 0 ? '\nlogfile: all passed' : `\nlogfile: ${failures} failed`)
if (failures > 0) process.exitCode = 1
