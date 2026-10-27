import {
  clampFocus,
  evenGrid,
  gridStyle,
  nextFocus,
  spotlightGrid
} from '@renderer/features/multiview/layout'

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

console.log('\nThe even grid')

check('2x2 is two by two', evenGrid(2, 2).gridTemplateColumns === 'repeat(2, 1fr)')
check('3x2 is three across', evenGrid(3, 2).gridTemplateColumns === 'repeat(3, 1fr)')
check('3x2 is two down', evenGrid(3, 2).gridTemplateRows === 'repeat(2, 1fr)')
// A corrupt setting must not produce `repeat(0, 1fr)`, which collapses the
// whole grid and shows nothing at all.
check('zero columns is still one column', evenGrid(0, 2).gridTemplateColumns === 'repeat(1, 1fr)')

console.log('\nThe spotlight')

// One column per remaining tile, so the strip is exactly full. Spans inside
// the original tracks cannot do this: promoting in a 2x2 would leave three
// tiles fighting over two cells.
check('four tiles leave a strip of three', spotlightGrid(4).gridTemplateColumns === 'repeat(3, 1fr)')
check('nine tiles leave a strip of eight', spotlightGrid(9).gridTemplateColumns === 'repeat(8, 1fr)')
check('two tiles leave a strip of one', spotlightGrid(2).gridTemplateColumns === 'repeat(1, 1fr)')
check('one tile still has a strip track', spotlightGrid(1).gridTemplateColumns === 'repeat(1, 1fr)')
check('the promoted tile takes the top row', spotlightGrid(4).gridTemplateRows.startsWith('1fr '))
// A floor on the strip, or it collapses to nothing on a short window.
check('the strip cannot collapse', spotlightGrid(4).gridTemplateRows.includes('minmax(76px'))

console.log('\nWhich grid applies')

check('no promotion means the even grid', gridStyle(2, 2, null).gridTemplateColumns === 'repeat(2, 1fr)')
check('a promotion means the spotlight', gridStyle(2, 2, 0).gridTemplateColumns === 'repeat(3, 1fr)')
check('the spotlight counts tiles, not columns', gridStyle(3, 3, 4).gridTemplateColumns === 'repeat(8, 1fr)')

console.log('\nKeeping the promotion valid')

check('a tile that exists is kept', clampFocus(2, 4) === 2)
// 3x3 down to 1x2 with tile 7 promoted would leave the spotlight pointing at
// nothing: a big empty cell, and a strip one short.
check('a tile past the layout is dropped', clampFocus(7, 2) === null)
check('the last tile of the layout is valid', clampFocus(3, 4) === 3)
check('nothing promoted stays nothing', clampFocus(null, 4) === null)
check('a negative index is dropped', clampFocus(-1, 4) === null)
check('a fractional index is dropped', clampFocus(1.5, 4) === null)

console.log('\nPromoting is a toggle')

check('clicking a plain tile promotes it', nextFocus(null, 2) === 2)
check('clicking the promoted tile puts it back', nextFocus(2, 2) === null)
check('clicking another tile moves the spotlight', nextFocus(2, 3) === 3)

console.log(failures === 0 ? '\nmultiviewlayout: all passed' : `\nmultiviewlayout: ${failures} failed`)
if (failures > 0) process.exitCode = 1
