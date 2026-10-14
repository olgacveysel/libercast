import {
  SLEEP_OPTIONS,
  formatRemaining,
  hasExpired,
  remaining,
  sleepDeadline
} from '@renderer/features/player/sleepTimer'
import { compareVersions, isNewer, parseVersion } from '@shared/version'
import { onPrereleaseLine, pickUpdate, type ReleaseSummary } from '@shared/releases'

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

console.log(failures === 0 ? '\nsleeptimer: all passed' : `\nsleeptimer: ${failures} failed`)
if (failures > 0) process.exitCode = 1
