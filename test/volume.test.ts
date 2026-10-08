import {
  VOLUME_STEP,
  clampVolume,
  formatVolume,
  stepVolume,
  volumeLevel
} from '@renderer/features/player/volume'
import { clampAudioTile, tileFromKey } from '@renderer/features/multiview/audioFocus'

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

console.log('\nVolume')

check('a step goes up', stepVolume(0.5, VOLUME_STEP) === 0.55)
check('a step goes down', stepVolume(0.5, -VOLUME_STEP) === 0.45)
check('it stops at the top', stepVolume(0.98, 0.1) === 1)
check('it stops at silence', stepVolume(0.02, -0.1) === 0)
check('silence is reachable exactly', stepVolume(0.05, -0.05) === 0)

// Adding 0.05 repeatedly is exactly how a settings file ends up holding
// 0.35000000000000003, which then shows as a nonsense percentage.
let level = 0
for (let i = 0; i < 7; i++) level = stepVolume(level, VOLUME_STEP)
check('repeated steps stay clean', level === 0.35, level)
check('a full sweep up lands on 1', Array.from({ length: 20 }).reduce<number>((v) => stepVolume(v, VOLUME_STEP), 0) === 1)

check('a corrupt level falls back to full', clampVolume(Number.NaN) === 1)
check('Infinity falls back to full', clampVolume(Number.POSITIVE_INFINITY) === 1)
check('a negative level is silence', clampVolume(-2) === 0)
check('an over-loud level is clamped', clampVolume(4) === 1)

check('it reads as a percentage', formatVolume(0.72) === '72%')
check('silence reads as zero', formatVolume(0) === '0%')
check('full reads as a hundred', formatVolume(1) === '100%')
check('no fractional percentages', formatVolume(0.725) === '73%', formatVolume(0.725))

console.log('\nWhich speaker icon')

check('mute wins over the level', volumeLevel(0.9, true) === 'muted')
// A speaker drawn emitting sound while producing none is worse than no icon.
check('a level of zero draws as muted', volumeLevel(0, false) === 'muted')
check('below half is quiet', volumeLevel(0.3, false) === 'low')
check('half is not quiet', volumeLevel(0.5, false) === 'high')
check('loud is loud', volumeLevel(1, false) === 'high')

console.log('\nMoving the sound between tiles')

check('1 is the first tile', tileFromKey('1', 4) === 0)
check('4 is the fourth tile', tileFromKey('4', 4) === 3)
// Pressing 9 in a 2x2 layout must do nothing rather than silence everything.
check('a digit past the layout is not a tile', tileFromKey('9', 4) === null)
check('0 is not a tile', tileFromKey('0', 4) === null)
check('a letter is not a tile', tileFromKey('m', 4) === null)
check('a multi-character key is not a tile', tileFromKey('ArrowUp', 4) === null)
check('all nine work in a 3x3', tileFromKey('9', 9) === 8)

console.log('\nShrinking the layout')

check('a tile that still exists is kept', clampAudioTile(2, 4) === 2)
// 3x3 down to 1x2 with tile 7 audible would otherwise leave nothing audible.
check('a tile that no longer exists falls back to the first', clampAudioTile(6, 2) === 0)
check('the last tile of the layout is valid', clampAudioTile(3, 4) === 3)
check('a negative index falls back', clampAudioTile(-1, 4) === 0)
check('a fractional index falls back', clampAudioTile(1.5, 4) === 0)

console.log(failures === 0 ? '\nvolume: all passed' : `\nvolume: ${failures} failed`)
if (failures > 0) process.exitCode = 1
