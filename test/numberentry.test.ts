import { findByNumber } from '@renderer/features/live/useNumberEntry'
import type { ChannelWithState } from '@shared/types'

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

function channel(number: number | null, name: string): ChannelWithState {
  return { number, name } as ChannelWithState
}

const channels = [
  channel(1, 'One'),
  channel(7, 'Seven'),
  channel(101, 'One Hundred and One'),
  channel(null, 'Unnumbered')
]

console.log('\nJumping to a channel by number')

check('a single digit finds its channel', findByNumber(channels, '1')?.name === 'One')
check('three digits find theirs', findByNumber(channels, '101')?.name === 'One Hundred and One')

// Providers pad numbers and viewers do not; both must reach the same channel.
check('a leading zero is ignored', findByNumber(channels, '07')?.name === 'Seven')
check('several leading zeroes too', findByNumber(channels, '0007')?.name === 'Seven')

check('a number nobody has finds nothing', findByNumber(channels, '999') === null)
check('an unnumbered channel is never matched', findByNumber(channels, '0') === null)

// Partial entry: "10" on the way to "101" must not land on a channel 10 that
// does not exist, and must not throw.
check('a partial entry with no match resolves to nothing', findByNumber(channels, '10') === null)

check('an empty entry matches nothing', findByNumber(channels, '') === null)
check('nonsense matches nothing', findByNumber(channels, 'abc') === null)
check('an empty list matches nothing', findByNumber([], '1') === null)

console.log(failures === 0 ? '\nnumberentry: all passed' : `\nnumberentry: ${failures} failed`)
if (failures > 0) process.exitCode = 1
