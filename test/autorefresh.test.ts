import { refreshVerdict } from '@main/autoRefresh'
import type { AutoRefreshReport } from '@shared/types'

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

const HOUR = 3600_000
const now = Date.UTC(2026, 8, 6, 12, 0, 0)

function ran(at: number): AutoRefreshReport {
  return { at, sources: [], programmes: null, epgError: null }
}

console.log('\nWhen an automatic refresh is owed')

check('off means off', refreshVerdict({ autoRefreshHours: 0, lastAutoRefresh: null }, now) === 'off')
check(
  'a negative interval is treated as off, not as always due',
  refreshVerdict({ autoRefreshHours: -1, lastAutoRefresh: ran(now) }, now) === 'off'
)

// Turning the setting on should do something the same day, not tomorrow.
check(
  'never having run is due immediately',
  refreshVerdict({ autoRefreshHours: 24, lastAutoRefresh: null }, now) === 'due'
)

check(
  'inside the interval it waits',
  refreshVerdict({ autoRefreshHours: 24, lastAutoRefresh: ran(now - 5 * HOUR) }, now) === 'not-yet'
)
check(
  'at the interval exactly it runs',
  refreshVerdict({ autoRefreshHours: 24, lastAutoRefresh: ran(now - 24 * HOUR) }, now) === 'due'
)

// The machine was asleep for a week. Elapsed time is compared rather than a
// fixed wall-clock slot, so a missed window is picked up on the next check
// instead of being skipped until the same hour comes round again.
check(
  'a long gap is caught up on, not skipped',
  refreshVerdict({ autoRefreshHours: 6, lastAutoRefresh: ran(now - 8 * 24 * HOUR) }, now) === 'due'
)

// A timestamp in the future means the clock moved back. Waiting it out could
// mean waiting months.
check(
  'a clock that went backwards does not strand the schedule',
  refreshVerdict({ autoRefreshHours: 6, lastAutoRefresh: ran(now + 30 * 24 * HOUR) }, now) === 'due'
)

// Shortening the interval must take effect against the existing last-run time.
check(
  'shortening the interval can make it due at once',
  refreshVerdict({ autoRefreshHours: 6, lastAutoRefresh: ran(now - 12 * HOUR) }, now) === 'due'
)
check(
  'lengthening the interval postpones it',
  refreshVerdict({ autoRefreshHours: 48, lastAutoRefresh: ran(now - 12 * HOUR) }, now) === 'not-yet'
)

console.log(failures === 0 ? '\nautorefresh: all passed' : `\nautorefresh: ${failures} failed`)
if (failures > 0) process.exitCode = 1
