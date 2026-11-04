import {
  DEFAULT_TEMPLATE,
  renderTemplate,
  sanitize,
  tokensUsed,
  truncateBytes
} from '@shared/filename'

/**
 * Naming a recording so the filesystem accepts it.
 *
 * Most of this is about Windows, which is where most of these recordings are
 * written and which refuses several names that look perfectly ordinary. The
 * two functions this replaced stripped the characters their authors
 * remembered and missed the rules that actually bite.
 */

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

// A fixed local time, so the expected strings do not depend on when this runs.
const at = new Date(2026, 10, 4, 21, 5).getTime()
const parts = { channel: 'Alto Sports 2', title: 'The Big Match', at }

console.log('\nFilling a template')

check('the default reads as it should',
  renderTemplate(DEFAULT_TEMPLATE, parts) === 'Alto Sports 2 - The Big Match (2026-11-04 21-05)',
  renderTemplate(DEFAULT_TEMPLATE, parts))
check('tokens can be reordered',
  renderTemplate('{date} {time} {title}', parts) === '2026-11-04 21-05 The Big Match',
  renderTemplate('{date} {time} {title}', parts))
check('a token can be used twice',
  renderTemplate('{year} {year}', parts) === '2026 2026', renderTemplate('{year} {year}', parts))
// People write this meaning a folder. A folder is not created, but the
// boundary they meant survives rather than the two values fusing together.
check('a slash becomes a space rather than vanishing',
  renderTemplate('{year}/{title}', parts) === '2026 The Big Match',
  renderTemplate('{year}/{title}', parts))
check('case does not matter', renderTemplate('{TITLE}', parts) === 'The Big Match')
check('an empty template falls back to the default',
  renderTemplate('   ', parts) === renderTemplate(DEFAULT_TEMPLATE, parts))
// A silently dropped token is a filename the user cannot account for.
check('an unknown token is left visible rather than blanked',
  renderTemplate('{titel}', parts) === '{titel}', renderTemplate('{titel}', parts))
check('the parts are separated out',
  renderTemplate('{year}-{month}-{day}', parts) === '2026-11-04')

console.log('\nWhat Windows will not accept')

check('separators become spaces and the rest are removed',
  sanitize('A: B/C\\D?E*F"G<H>I|J') === 'A B C DEFGHI J',
  sanitize('A: B/C\\D?E*F"G<H>I|J'))
check('control characters go', sanitize('a\u0000b\u001fc') === 'abc')
// CON, PRN, AUX, NUL, COM1..9, LPT1..9 cannot be files at all.
check('a reserved device name is made safe', sanitize('CON') === 'CON_')
check('in any case', sanitize('aux') === 'aux_')
check('and the numbered ones', sanitize('COM4') === 'COM4_' && sanitize('LPT9') === 'LPT9_')
check('something merely starting with one is left alone', sanitize('Console') === 'Console')
check('and a reserved word inside a longer name is fine', sanitize('The CON Job') === 'The CON Job')
// Windows strips these on create, then cannot find what it wrote.
check('a trailing dot goes', sanitize('Episode 1.') === 'Episode 1')
check('trailing spaces go', sanitize('Episode 1   ') === 'Episode 1')
check('and a mixture of both', sanitize('Episode 1. . ') === 'Episode 1')
check('a leading dot is kept, since it is legal',
  sanitize('.hidden') === '.hidden', sanitize('.hidden'))

console.log('\nNames that sanitise away to nothing')

// Providers really do send titles that are entirely punctuation. Without
// this the file is called ".ts" — hidden on Unix, refused on Windows.
check('punctuation alone still yields a name', sanitize('///') === 'Recording')
check('as does an empty string', sanitize('') === 'Recording')
check('and whitespace', sanitize('   ') === 'Recording')

console.log('\nLength')

check('a short name is untouched', truncateBytes('short', 20) === 'short')
check('a long one is cut', truncateBytes('a'.repeat(200), 10).length === 10)
// Filesystem limits are in bytes; a Turkish title is longer than it looks.
const turkish = 'Çınar'.repeat(40)
check('the cut is by bytes, not characters',
  new TextEncoder().encode(truncateBytes(turkish, 30)).length <= 30,
  new TextEncoder().encode(truncateBytes(turkish, 30)).length)
check('and never splits a character',
  !truncateBytes(turkish, 31).includes('�'), truncateBytes(turkish, 31))
check('a long title is cut rather than refused',
  sanitize('x'.repeat(400)).length <= 120, sanitize('x'.repeat(400)).length)

console.log('\nA real title that would have broken')

const awkward = renderTemplate(DEFAULT_TEMPLATE, {
  channel: 'Kanal Güneş',
  title: 'Aux: The Story / Part 2',
  at
})
check('it is writable', !/[<>:"/\\|?*]/.test(awkward), awkward)
check('and still readable', awkward.includes('Kanal Güneş') && awkward.includes('Part 2'), awkward)

console.log('\nReading a template back')

check('the tokens are listed',
  tokensUsed('{channel} - {title}').join(',') === 'channel,title')
check('duplicates are listed once', tokensUsed('{year}{year}').join(',') === 'year')
check('unknown ones are ignored', tokensUsed('{nope}').length === 0)
check('a template naming nothing is visible as such', tokensUsed('recording').length === 0)

console.log(failures === 0 ? '\nfilename: all passed' : `\nfilename: ${failures} failed`)
process.exit(failures === 0 ? 0 : 1)
