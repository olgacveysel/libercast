/**
 * The bounds on the Live TV list widths.
 *
 * Worth a test of its own because the same function guards two very different
 * entrances: a drag, where the number is a pointer position and arrives
 * hundreds of times a second, and a read from the database, where it is
 * whatever was last written — or whatever a restored backup brought with it
 * from a machine with a different screen.
 */
import { clampPaneWidth, MIN_PLAYER_WIDTH, PANE_WIDTHS } from '@shared/panes'

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

console.log('\npanes\n')

const cat = PANE_WIDTHS.category
const chan = PANE_WIDTHS.channel

check('a width inside the bounds is kept', clampPaneWidth('category', 260) === 260)
check('too narrow is raised to the minimum', clampPaneWidth('category', 10) === cat.min)
check('too wide is cut to the maximum', clampPaneWidth('category', 9000) === cat.max)
check('the channel list has its own bounds', chan.min !== cat.min && chan.max !== cat.max)

/*
  The reason the fixed maximum is not enough on its own. A width well inside
  the bounds can still be most of a small window, and the pane the user cannot
  resize — the picture — is the one that would pay for it.
*/
check(
  'a narrow window overrides the fixed maximum',
  clampPaneWidth('channel', 560, 700) === 700 - MIN_PLAYER_WIDTH,
  clampPaneWidth('channel', 560, 700)
)
check(
  'but never below the minimum, however small the window',
  clampPaneWidth('channel', 560, 300) === chan.min
)
check(
  'a roomy window is bounded by the maximum, not by itself',
  clampPaneWidth('channel', 9000, 3000) === chan.max
)

/*
  A settings file is a file. `JSON.parse` of a hand-edited one, or a column
  that went through a migration badly, can hand this anything at all — and a
  NaN width reaches CSS as `NaNpx`, which is ignored, leaving a pane at zero
  with no way to get it back.
*/
check('NaN falls back to the preset', clampPaneWidth('category', Number.NaN) === cat.preset)
check('Infinity falls back too', clampPaneWidth('channel', Number.POSITIVE_INFINITY) === chan.preset)
check('a fraction is rounded, so the style never carries one', clampPaneWidth('category', 260.4) === 260)

/* The presets are what a fresh install and a double-click both land on, so
   they have to survive their own clamp. */
check('the category preset is itself valid', clampPaneWidth('category', cat.preset) === cat.preset)
check('the channel preset is itself valid', clampPaneWidth('channel', chan.preset) === chan.preset)

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`)
process.exit(failures === 0 ? 0 : 1)
