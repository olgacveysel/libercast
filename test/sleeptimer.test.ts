import {
  SLEEP_OPTIONS,
  formatRemaining,
  hasExpired,
  remaining,
  sleepDeadline
} from '@renderer/features/player/sleepTimer'
import { compareVersions, isNewer, parseVersion } from '@shared/version'
import {
  bannerUpdate,
  onPrereleaseLine,
  pickUpdate,
  shouldCheckNow,
  type ReleaseSummary
} from '@shared/releases'

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

console.log('\nSleep timer')

const NOW = 1_700_000_000_000
check('30 minutes is half an hour away', sleepDeadline(30, NOW) === NOW + 1_800_000)
check('the options are all usable', SLEEP_OPTIONS.every((m) => m > 0 && Number.isInteger(m)))
// A deadline rather than a countdown: nothing has to keep ticking for it to
// stay correct across a sleeping machine or a throttled renderer.
check('a deadline is absolute', sleepDeadline(15, NOW) > NOW)
check('fractional minutes round', sleepDeadline(15.4, NOW) === NOW + 900_000)
check('zero still buys a minute', sleepDeadline(0, NOW) === NOW + 60_000)

check('time left counts down', remaining(NOW + 60_000, NOW) === 60_000)
check('time left never goes negative', remaining(NOW - 5_000, NOW) === 0)
check('no timer means nothing left', remaining(null, NOW) === 0)
check('a corrupt deadline means nothing left', remaining(Number.NaN, NOW) === 0)

check('not expired before the deadline', !hasExpired(NOW + 1, NOW))
check('expired exactly on it', hasExpired(NOW, NOW))
check('expired after it', hasExpired(NOW - 1, NOW))
check('no timer never expires', !hasExpired(null, NOW))

console.log('\nThe countdown as it reads')

check('two minutes reads in minutes', formatRemaining(120_000) === '2 min')
// Seconds only in the last minute: a control that twitches once a second for
// two hours is a control nobody leaves on screen.
check('ninety seconds rounds up to minutes', formatRemaining(90_000) === '2 min')
check('exactly a minute reads in seconds', formatRemaining(60_000) === '0:60')
check('under a minute shows seconds', formatRemaining(9_000) === '0:09')
check('seconds are padded', formatRemaining(5_400) === '0:06')
check('zero reads as zero', formatRemaining(0) === '0:00')
check('negative reads as zero', formatRemaining(-50) === '0:00')

console.log('\nComparing versions')

check('a plain version parses', parseVersion('1.2.3')?.numbers.join('.') === '1.2.3')
check('a leading v is tolerated', parseVersion('v1.2.3')?.numbers.join('.') === '1.2.3')
check('build metadata is ignored', parseVersion('1.2.3+build7')?.prerelease.length === 0)
check('a prerelease is kept', parseVersion('0.9.0-beta.1')?.prerelease.join('.') === 'beta.1')
check('nonsense does not parse', parseVersion('next') === null)

check('patch beats patch', compareVersions('1.0.1', '1.0.0') === 1)
check('minor beats patch', compareVersions('1.1.0', '1.0.9') === 1)
check('major beats minor', compareVersions('2.0.0', '1.9.9') === 1)
check('equal is equal', compareVersions('1.2.3', '1.2.3') === 0)

// The one that matters here: everything shipped so far is a prerelease.
check('a release beats its own beta', compareVersions('0.9.0', '0.9.0-beta.1') === 1)
check('and the beta loses to it', compareVersions('0.9.0-beta.1', '0.9.0') === -1)
check('beta 2 beats beta 1', compareVersions('0.9.0-beta.2', '0.9.0-beta.1') === 1)
// Numerically, not alphabetically — otherwise beta.10 looks older than beta.9.
check('beta 10 beats beta 9', compareVersions('0.9.0-beta.10', '0.9.0-beta.9') === 1)
check('alpha loses to beta', compareVersions('0.9.0-alpha.1', '0.9.0-beta.1') === -1)
check('a longer prerelease wins a tie', compareVersions('0.9.0-beta.1.2', '0.9.0-beta.1') === 1)

check('an update is offered', isNewer('0.9.1', '0.9.0-beta.1'))
check('the same version is not an update', !isNewer('0.9.0-beta.1', '0.9.0-beta.1'))
// The case that would nag every user on a release: do not offer a beta to
// someone already past it.
check('an older beta is not an update', !isNewer('0.9.0-beta.1', '0.9.0'))
check('garbage is never an update', !isNewer('latest', '0.9.0'))

console.log('\nPicking a release to offer')

const RELEASES: ReleaseSummary[] = [
  { tag_name: 'v0.9.0-beta.3', html_url: 'https://github.com/o/r/releases/tag/v0.9.0-beta.3', prerelease: true },
  { tag_name: 'v0.9.0-beta.2', html_url: 'https://github.com/o/r/releases/tag/v0.9.0-beta.2', prerelease: true },
  { tag_name: 'v1.0.0', html_url: 'https://github.com/o/r/releases/tag/v1.0.0', draft: true },
  { tag_name: 'v0.8.0', html_url: 'https://github.com/o/r/releases/tag/v0.8.0' }
]

const onBeta = pickUpdate(RELEASES, '0.9.0-beta.1', true)
check('a tester on a beta is offered the newest beta', onBeta?.version === '0.9.0-beta.3', onBeta)
check('the v is stripped from the version', !(onBeta?.version ?? '').startsWith('v'))
check('the link is carried through', onBeta?.url.includes('beta.3') === true)

// A draft release is visible only to whoever can publish it. Offering one
// sends every user to a 404.
check('a draft is never offered', pickUpdate([RELEASES[2]!], '0.1.0', true) === null)

// Someone on a stable release must not be pulled back onto the beta line.
const onStable = pickUpdate(RELEASES, '0.9.0', false)
check('a stable user is offered nothing from betas', onStable === null, onStable)
check(
  'a stable user is offered a newer stable',
  pickUpdate([{ tag_name: 'v1.1.0', html_url: 'https://github.com/o/r/releases/tag/v1.1.0' }], '1.0.0', false)?.version === '1.1.0'
)

check('an older release is not an update', pickUpdate([RELEASES[3]!], '0.9.0-beta.1', true) === null)
check('nothing at all is not an update', pickUpdate([], '0.9.0', true) === null)
check('a release with no tag is skipped', pickUpdate([{ html_url: 'https://github.com/o/r' }], '0.1.0', true) === null)

// The response is third-party data: a link that is not a GitHub release page
// is not something to open on the user's behalf.
check(
  'a link off GitHub is refused',
  pickUpdate([{ tag_name: 'v9.9.9', html_url: 'https://example.com/pwn' }], '0.1.0', true) === null
)

check('a beta build is on the prerelease line', onPrereleaseLine('0.9.0-beta.1'))
check('a release build is not', !onPrereleaseLine('0.9.0'))


console.log('\nWhen to ask GitHub')

const DAY = 24 * 60 * 60 * 1000
const now = 1_700_000_000_000

// `null` means nobody has been asked yet. It has to behave exactly like a no,
// or the installer's promise that nothing leaves the machine unasked is false
// for every user between installing and answering the prompt.
check('an unanswered prompt checks nothing',
  !shouldCheckNow({ autoCheckUpdates: null, lastUpdateCheck: null }, now))
check('and a declined one checks nothing either',
  !shouldCheckNow({ autoCheckUpdates: false, lastUpdateCheck: null }, now))
check('and neither becomes stale enough to start',
  !shouldCheckNow({ autoCheckUpdates: null, lastUpdateCheck: now - 10 * DAY }, now))

check('having opted in, the first launch checks',
  shouldCheckNow({ autoCheckUpdates: true, lastUpdateCheck: null }, now))
check('a check an hour ago is recent enough to skip',
  !shouldCheckNow({ autoCheckUpdates: true, lastUpdateCheck: now - 3_600_000 }, now))
check('a day later it checks again',
  shouldCheckNow({ autoCheckUpdates: true, lastUpdateCheck: now - DAY }, now))
check('just under a day it does not',
  !shouldCheckNow({ autoCheckUpdates: true, lastUpdateCheck: now - DAY + 1000 }, now))
// A clock that has gone backwards — a correction, a timezone change, a
// restored backup — must not lock checking out until it catches up.
check('a timestamp from the future does not lock it out',
  shouldCheckNow({ autoCheckUpdates: true, lastUpdateCheck: now + 5 * DAY }, now))
check('a corrupt timestamp is treated as never',
  shouldCheckNow({ autoCheckUpdates: true, lastUpdateCheck: Number.NaN }, now))

console.log('\nWhat to put on screen')

const remembered = {
  knownUpdateVersion: '0.9.0-beta.3',
  knownUpdateUrl: 'https://github.com/olgacveysel/libercast/releases/tag/v0.9.0-beta.3',
  dismissedUpdate: null
}

check('a newer remembered version is announced',
  bannerUpdate(remembered, '0.9.0-beta.2')?.version === '0.9.0-beta.3')
check('and carries its link', bannerUpdate(remembered, '0.9.0-beta.2')?.url.includes('github.com') === true)
// After updating, the note has to clear itself rather than waiting a day for
// the next check to notice.
check('the same version is not announced to itself', bannerUpdate(remembered, '0.9.0-beta.3') === null)
check('nor is an older one', bannerUpdate(remembered, '1.0.0') === null)
check('a version the user waved away stays away',
  bannerUpdate({ ...remembered, dismissedUpdate: '0.9.0-beta.3' }, '0.9.0-beta.2') === null)
check('but the next one is announced again',
  bannerUpdate({ ...remembered, knownUpdateVersion: '0.9.0-beta.4',
                 dismissedUpdate: '0.9.0-beta.3' }, '0.9.0-beta.2')?.version === '0.9.0-beta.4')
check('nothing remembered means nothing shown',
  bannerUpdate({ knownUpdateVersion: null, knownUpdateUrl: null, dismissedUpdate: null }, '0.9.0') === null)
check('a version with no link is not shown',
  bannerUpdate({ ...remembered, knownUpdateUrl: null }, '0.9.0-beta.2') === null)
// The remembered url came from GitHub's own JSON, which is third-party data
// that reached the database. It is checked again on the way out.
check('a link that is not on github is refused',
  bannerUpdate({ ...remembered, knownUpdateUrl: 'https://elsewhere.example/x' }, '0.9.0-beta.2') === null)

console.log(failures === 0 ? '\nsleeptimer: all passed' : `\nsleeptimer: ${failures} failed`)
if (failures > 0) process.exitCode = 1
