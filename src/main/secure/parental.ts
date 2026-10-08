import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { ParentalRules, ParentalStatus } from '@shared/types'
import { getDb } from '@main/db'
import { createLogger } from '@main/util/logger'

const log = createLogger('parental')

const KEY_HASH = 'parental:hash'
const KEY_SALT = 'parental:salt'
const KEY_RULES = 'parental:rules'

const DEFAULT_RULES: ParentalRules = {
  lockedCategoryIds: [],
  keywords: [],
  lockAdult: true,
  autoLockMinutes: 30
}

/**
 * Unlocking is deliberately process state, not a stored flag: closing the app
 * always re-locks, and nothing on disk can be edited to bypass the PIN.
 */
let unlockedAt: number | null = null

/**
 * Settings values are stored as JSON, so reading one already yields its real
 * type. Returning the raw parsed value and letting callers say what they expect
 * avoids the double-parse that silently turned every rule back into a default.
 */
function read<T>(key: string): T | null {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  if (!row) return null
  try {
    return JSON.parse(row.value) as T
  } catch {
    return null
  }
}

function write(key: string, value: unknown): void {
  getDb()
    .prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
    .run(key, JSON.stringify(value))
}

function remove(key: string): void {
  getDb().prepare('DELETE FROM settings WHERE key = ?').run(key)
}

export function getRules(): ParentalRules {
  const stored = read<Partial<ParentalRules>>(KEY_RULES)
  if (!stored || typeof stored !== 'object') return DEFAULT_RULES
  return {
    ...DEFAULT_RULES,
    ...stored,
    lockedCategoryIds: Array.isArray(stored.lockedCategoryIds) ? stored.lockedCategoryIds : [],
    keywords: Array.isArray(stored.keywords) ? stored.keywords : []
  }
}

export function isEnabled(): boolean {
  return read<string>(KEY_HASH) !== null
}

/**
 * Whether locked content should currently be hidden.
 *
 * The auto-lock is evaluated on read rather than by a timer, so a session left
 * open overnight is locked again the moment anything asks.
 */
export function isLocked(): boolean {
  if (!isEnabled()) return false
  if (unlockedAt === null) return true

  const { autoLockMinutes } = getRules()
  if (autoLockMinutes > 0 && Date.now() - unlockedAt > autoLockMinutes * 60_000) {
    unlockedAt = null
    return true
  }

  return false
}

/** Extends the unlock window. Called whenever the user does something. */
export function touch(): void {
  if (unlockedAt !== null) unlockedAt = Date.now()
}

/**
 * Hashes with scrypt rather than a plain digest: a four-digit PIN has only
 * 10,000 possibilities, so the only meaningful defence is making each guess
 * expensive.
 */
function hash(pin: string, salt: Buffer): Buffer {
  return scryptSync(pin.normalize('NFKC'), salt, 32, { N: 16384, r: 8, p: 1 })
}

export function setPin(currentPin: string | null, newPin: string): void {
  if (isEnabled() && !verify(currentPin ?? '')) {
    throw new Error('The current PIN is not correct')
  }
  if (!/^\d{4,8}$/.test(newPin)) {
    throw new Error('The PIN must be 4 to 8 digits')
  }

  const salt = randomBytes(16)
  write(KEY_SALT, salt.toString('base64'))
  write(KEY_HASH, hash(newPin, salt).toString('base64'))
  unlockedAt = Date.now()
  log.info('parental PIN set')
}

export function verify(pin: string): boolean {
  const storedHash = read<string>(KEY_HASH)
  const storedSalt = read<string>(KEY_SALT)
  if (!storedHash || !storedSalt) return false

  const expected = Buffer.from(storedHash, 'base64')
  const actual = hash(pin, Buffer.from(storedSalt, 'base64'))

  // Constant-time comparison, so the failure time carries no information.
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export function unlock(pin: string): boolean {
  if (!isEnabled()) return true
  if (!verify(pin)) return false
  unlockedAt = Date.now()
  return true
}

export function lock(): void {
  unlockedAt = null
}

export function disable(pin: string): void {
  if (!verify(pin)) throw new Error('The PIN is not correct')
  remove(KEY_HASH)
  remove(KEY_SALT)
  unlockedAt = null
  log.info('parental controls disabled')
}

export function setRules(rules: ParentalRules): ParentalRules {
  if (isLocked()) throw new Error('Unlock with your PIN before changing these settings')

  const clean: ParentalRules = {
    lockedCategoryIds: [...new Set(rules.lockedCategoryIds.filter(Number.isFinite))],
    keywords: [
      ...new Set(
        rules.keywords
          .map((word) => word.trim().toLowerCase())
          .filter((word) => word.length >= 2)
      )
    ],
    lockAdult: rules.lockAdult,
    autoLockMinutes: Math.max(0, Math.min(720, Math.round(rules.autoLockMinutes)))
  }

  write(KEY_RULES, clean)
  return clean
}

export function status(): ParentalStatus {
  const rules = getRules()
  return {
    enabled: isEnabled(),
    unlocked: !isLocked(),
    lockedCategoryIds: rules.lockedCategoryIds,
    keywords: rules.keywords,
    lockAdult: rules.lockAdult,
    autoLockMinutes: rules.autoLockMinutes
  }
}

/**
 * SQL that excludes locked content, for splicing into catalog queries.
 *
 * Filtering in the query rather than in the UI matters: a hidden row must not
 * reach the renderer at all, or search, Continue Watching and the guide would
 * each need their own filter and one of them would eventually be forgotten.
 */
export function lockClause(alias = 'ch'): { sql: string; params: unknown[] } | null {
  if (!isLocked()) return null

  const rules = getRules()
  const clauses: string[] = []
  const params: unknown[] = []

  if (rules.lockAdult) clauses.push(`${alias}.is_adult = 0`)

  if (rules.lockedCategoryIds.length > 0) {
    const placeholders = rules.lockedCategoryIds.map(() => '?').join(',')
    clauses.push(`(${alias}.category_id IS NULL OR ${alias}.category_id NOT IN (${placeholders}))`)
    params.push(...rules.lockedCategoryIds)
  }

  for (const keyword of rules.keywords) {
    clauses.push(`${alias}.name_folded NOT LIKE ?`)
    params.push(`%${keyword}%`)
  }

  if (clauses.length === 0) return null
  return { sql: clauses.join(' AND '), params }
}

/** Whether one specific item may be played right now. */
export function isBlocked(channel: {
  categoryId: number | null
  isAdult: boolean
  name: string
}): boolean {
  if (!isLocked()) return false

  const rules = getRules()
  if (rules.lockAdult && channel.isAdult) return true
  if (channel.categoryId !== null && rules.lockedCategoryIds.includes(channel.categoryId)) return true

  const folded = channel.name.toLowerCase()
  return rules.keywords.some((keyword) => folded.includes(keyword))
}
