import { en, type TranslationKey } from '@renderer/i18n/en'
import { tr } from '@renderer/i18n/tr'
import { de } from '@renderer/i18n/de'
import { localeOf } from '@renderer/i18n/locale'
import { translate } from '@renderer/i18n/translate'

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    failures++
    console.log(`  FAIL  ${label}`, detail ?? '')
  }
}

const keys = Object.keys(en) as TranslationKey[]

console.log('\nEvery language covers every string')

for (const [name, dictionary] of [['Turkish', tr], ['German', de]] as const) {
  const missing = keys.filter((key) => !(key in dictionary))
  check(`${name} has all ${keys.length} keys`, missing.length === 0, missing)

  const blank = keys.filter((key) => (dictionary[key] ?? '').trim() === '')
  check(`${name} has no blank strings`, blank.length === 0, blank)

  // A key that exists in a translation but not in English is dead weight, and
  // usually a rename that was only half applied.
  const extra = Object.keys(dictionary).filter((key) => !(key in en))
  check(`${name} has no keys English lacks`, extra.length === 0, extra)
}

console.log('\nPlaceholders survive translation')

// A translator dropping a placeholder is the classic i18n bug: the string
// still reads fine but the number never appears.
for (const [name, dictionary] of [['English', en], ['Turkish', tr], ['German', de]] as const) {
  const wrong = keys.filter((key) => {
    const source = [...en[key].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    const target = [...(dictionary[key] ?? '').matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    return source.join(',') !== target.join(',')
  })
  check(`${name} keeps every placeholder`, wrong.length === 0, wrong)
}

console.log('\nLooking a string up')

check('a plain string comes back', translate('en', 'nav.home') === 'Home')
check('the Turkish one comes back in Turkish', translate('tr', 'nav.home') === 'Ana sayfa')
check('the German one comes back in German', translate('de', 'nav.home') === 'Start')

check(
  'a placeholder is filled',
  translate('en', 'home.minutesLeft', { minutes: 12 }) === '12 min left'
)
check(
  'and filled in Turkish too',
  translate('tr', 'home.minutesLeft', { minutes: 12 }) === '12 dk kaldı'
)
// Turkish does not pluralise after a number, which is why counts are formatted
// by the translation rather than by appending an "s" in the caller.
check('Turkish does not pluralise a counted noun', tr['common.channels'] === 'kanal')

check(
  'a placeholder with no value is left visible rather than blanked',
  translate('en', 'home.minutesLeft').includes('{minutes}')
)
check(
  'an unrelated variable changes nothing',
  translate('en', 'nav.home', { minutes: 3 }) === 'Home'
)

// An unknown key must be obvious on screen, not an empty gap.
check(
  'an unknown key renders as itself',
  translate('en', 'does.not.exist' as TranslationKey) === 'does.not.exist'
)
check(
  'an unknown language falls back to English',
  translate('xx' as 'en', 'nav.home') === 'Home'
)

console.log('\nDates follow the interface')

check('Turkish maps to a Turkish locale', localeOf('tr') === 'tr-TR')
check('German maps to a German locale', localeOf('de') === 'de-DE')
check('English defaults to en-GB', localeOf('en') === 'en-GB')

// The whole point: a Turkish menu must not print an English month.
const sample = Date.UTC(2026, 8, 7, 12, 0, 0)
const turkishDate = new Date(sample).toLocaleDateString(localeOf('tr'), { month: 'short' })
const englishDate = new Date(sample).toLocaleDateString(localeOf('en'), { month: 'short' })
check('the month name differs by language', turkishDate !== englishDate, { turkishDate, englishDate })

console.log(failures === 0 ? '\ni18n: all passed' : `\ni18n: ${failures} failed`)
if (failures > 0) process.exitCode = 1
