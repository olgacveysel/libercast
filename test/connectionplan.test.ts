import { connectionPlan } from '@renderer/features/settings/connectionPlan'

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

console.log('\nMatching the app to the account')

const one = connectionPlan(1)
check('a single connection turns on the frugal path', one?.singleConnection === true, one)
check('and still allows one download', one?.maxConcurrentDownloads === 1, one)

const two = connectionPlan(2)
check('two connections do not need the frugal path', two?.singleConnection === false, two)
// One is playback's; a download that stops the film is worse than a slow one.
check('two connections leave one for playback', two?.maxConcurrentDownloads === 1, two)

const five = connectionPlan(5)
check('five connections allow four downloads', five?.maxConcurrentDownloads === 4, five)
check('and no frugal path', five?.singleConnection === false, five)

console.log('\nWhat the provider did not say')

// Many panels report 0, or a blank that became 0. Configuring from that would
// be worse than leaving the user's own choice alone.
check('an unreported limit changes nothing', connectionPlan(0) === null)
check('a negative limit changes nothing', connectionPlan(-3) === null)
check('a missing number changes nothing', connectionPlan(Number.NaN) === null)
check('an infinite number changes nothing', connectionPlan(Number.POSITIVE_INFINITY) === null)

// A fractional report is nonsense but must not produce a fractional setting.
const fractional = connectionPlan(3.7)
check('a fractional limit rounds down rather than propagating', fractional?.maxConcurrentDownloads === 2, fractional)
check(
  'the download count is always a whole number',
  Number.isInteger(fractional?.maxConcurrentDownloads),
  fractional
)

console.log(failures === 0 ? '\nconnectionplan: all passed' : `\nconnectionplan: ${failures} failed`)
if (failures > 0) process.exitCode = 1
