import { refreshVerdict, runIsStale, STALE_RUN_MS } from '@main/autoRefresh'
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

/*
 * The guard that stops two syncs must not become a latch.
 *
 * It is cleared in a `finally`, which runs when the run settles — and a run
 * that hangs settles never. One stalled guide feed used to leave the flag set
 * and refuse every later refresh, the manual button included, until the
 * application was restarted. The guide download has a deadline of its own now;
 * this is the second line, so that anything else that ever hangs costs half an
 * hour rather than the feature.
 */
console.log('\nWhen a refresh is already in flight')
check('nothing running means go ahead', runIsStale(null, now))
check('a run that just started blocks another', !runIsStale(now, now))
check('and still blocks it a minute later', !runIsStale(now - 60_000, now))
check('and most of the way through the window', !runIsStale(now - (STALE_RUN_MS - 1000), now))
check('but one that has outlived the window does not', runIsStale(now - STALE_RUN_MS, now))
check('nor one far past it', runIsStale(now - 4 * STALE_RUN_MS, now))

console.log(failures === 0 ? '\nautorefresh: all passed' : `\nautorefresh: ${failures} failed`)
if (failures > 0) process.exitCode = 1
