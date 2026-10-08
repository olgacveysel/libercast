import {
  clampZoom,
  formatSpeed,
  nextFit,
  SPEEDS,
  stepSpeed,
  videoFitStyle
} from '@renderer/features/player/videoFit'
import type { VideoFit } from '@shared/types'

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

console.log('\nFitting the picture to the window')

check('fit never distorts', videoFitStyle('fit', 1).objectFit === 'contain')
// `cover` is what removes bars baked into the picture, by cropping.
check('fill crops rather than squashes', videoFitStyle('fill', 1).objectFit === 'cover')
check('stretch is the one that distorts', videoFitStyle('stretch', 1).objectFit === 'fill')

const forced = videoFitStyle('16:9', 1)
check('a forced ratio sizes the element', forced.aspectRatio === '16 / 9', forced)
check('a forced ratio stretches into it', forced.objectFit === 'fill', forced)
check('a forced ratio cannot overflow', forced.maxHeight === '100%' && forced.maxWidth === '100%')
check('4:3 is the other forced ratio', videoFitStyle('4:3', 1).aspectRatio === '4 / 3')

check('no zoom means no transform', videoFitStyle('fit', 1).transform === undefined)
check('zoom becomes a scale', videoFitStyle('fit', 1.25).transform === 'scale(1.25)')
check('zoom applies to a forced ratio too', videoFitStyle('4:3', 1.1).transform === 'scale(1.1)')

console.log('\nZoom limits')

// Below 1 would letterbox inside the letterbox; the control cannot offer it.
check('zoom never goes below 1', clampZoom(0.4) === 1)
check('zoom is capped', clampZoom(9) === 1.6)
check('a sane zoom passes through', clampZoom(1.25) === 1.25)
check('rounding keeps two decimals', clampZoom(1.23456) === 1.23)
check('nonsense falls back to 1', clampZoom(Number.NaN) === 1)

console.log('\nCycling with the keyboard')

const seen: VideoFit[] = []
let fit: VideoFit = 'fit'
for (let i = 0; i < 5; i++) {
  seen.push(fit)
  fit = nextFit(fit)
}
check('every mode is reachable', new Set(seen).size === 5, seen)
check('the cycle returns to the start', fit === 'fit', fit)

console.log('\nPlayback speed')

check('speeds include normal', SPEEDS.includes(1 as never))
check('faster steps up the list', stepSpeed(1, 1) === 1.25)
check('slower steps down', stepSpeed(1, -1) === 0.75)
check('the top of the list holds', stepSpeed(2, 1) === 2)
check('the bottom holds', stepSpeed(0.5, -1) === 0.5)
// A rate restored from somewhere unexpected must not strand the control.
check('an off-list rate resumes from normal', stepSpeed(1.11, 1) === 1.25)

check('normal speed reads as 1×', formatSpeed(1) === '1×')
check('trailing zeroes are dropped', formatSpeed(1.5) === '1.5×')
check('quarter steps keep two decimals', formatSpeed(1.25) === '1.25×')

console.log(failures === 0 ? '\nvideofit: all passed' : `\nvideofit: ${failures} failed`)
if (failures > 0) process.exitCode = 1
