/**
 * Container language codes are ISO 639-2, and the same language shows up under
 * both the bibliographic and terminological code depending on the muxer
 * ("ger" vs "deu"). Both map to one name here so a picker never lists German
 * twice.
 */
const NAMES: Record<string, string> = {
  eng: 'English',
  ger: 'German',
  deu: 'German',
  tur: 'Turkish',
  fre: 'French',
  fra: 'French',
  spa: 'Spanish',
  ita: 'Italian',
  por: 'Portuguese',
  rus: 'Russian',
  ara: 'Arabic',
  dut: 'Dutch',
  nld: 'Dutch',
  pol: 'Polish',
  swe: 'Swedish',
  nor: 'Norwegian',
  dan: 'Danish',
  fin: 'Finnish',
  gre: 'Greek',
  ell: 'Greek',
  heb: 'Hebrew',
  hin: 'Hindi',
  jpn: 'Japanese',
  kor: 'Korean',
  chi: 'Chinese',
  zho: 'Chinese',
  cze: 'Czech',
  ces: 'Czech',
  hun: 'Hungarian',
  rum: 'Romanian',
  ron: 'Romanian',
  bul: 'Bulgarian',
  ukr: 'Ukrainian',
  srp: 'Serbian',
  hrv: 'Croatian',
  slo: 'Slovak',
  slk: 'Slovak',
  slv: 'Slovenian',
  alb: 'Albanian',
  sqi: 'Albanian',
  fas: 'Persian',
  per: 'Persian',
  kur: 'Kurdish',
  aze: 'Azerbaijani',
  tha: 'Thai',
  vie: 'Vietnamese',
  ind: 'Indonesian',
  may: 'Malay',
  msa: 'Malay',
  fil: 'Filipino',
  tgl: 'Tagalog',
  mul: 'Multiple',
  und: 'Unknown'
}

/** Two-letter codes appear in some M3U-sourced streams. */
const TWO_LETTER: Record<string, string> = {
  en: 'eng',
  de: 'ger',
  tr: 'tur',
  fr: 'fre',
  es: 'spa',
  it: 'ita',
  pt: 'por',
  ru: 'rus',
  ar: 'ara',
  nl: 'dut',
  pl: 'pol',
  sv: 'swe',
  no: 'nor',
  da: 'dan',
  fi: 'fin',
  el: 'gre',
  he: 'heb',
  hi: 'hin',
  ja: 'jpn',
  ko: 'kor',
  zh: 'chi',
  cs: 'cze',
  hu: 'hun',
  ro: 'rum',
  bg: 'bul',
  uk: 'ukr',
  sr: 'srp',
  hr: 'hrv',
  sk: 'slo',
  sl: 'slv',
  sq: 'alb',
  fa: 'fas',
  ku: 'kur',
  az: 'aze',
  th: 'tha',
  vi: 'vie',
  id: 'ind',
  ms: 'may'
}

/** Canonical three-letter form, so "de", "deu" and "ger" compare equal. */
export function normalizeLanguage(code: string | null | undefined): string | null {
  if (!code) return null
  const lower = code.trim().toLowerCase().split(/[-_]/)[0] ?? ''
  if (lower === '' || lower === 'und') return null
  const three = lower.length === 2 ? TWO_LETTER[lower] ?? lower : lower
  // Collapse terminological codes onto the bibliographic ones used as keys.
  const canonical: Record<string, string> = {
    deu: 'ger',
    fra: 'fre',
    nld: 'dut',
    ell: 'gre',
    zho: 'chi',
    ces: 'cze',
    ron: 'rum',
    slk: 'slo',
    sqi: 'alb',
    per: 'fas',
    msa: 'may',
    tgl: 'fil'
  }
  return canonical[three] ?? three
}

export function languageName(code: string | null | undefined): string {
  const normalized = normalizeLanguage(code)
  if (!normalized) return 'Unknown'
  return NAMES[normalized] ?? normalized.toUpperCase()
}

export function sameLanguage(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeLanguage(a)
  const right = normalizeLanguage(b)
  return left !== null && left === right
}
