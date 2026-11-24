import { getDb } from '../index'

/**
 * Which group each channel belongs to in the all-sources list.
 *
 * The merged list shows one row per channel across every provider, and
 * deciding what "the same channel" means is the expensive part: normalise the
 * name, work out which country prefixes may be dropped, and check that each
 * unprefixed form is claimed by only one prefix — "UK harbour sports 2" and
 * "DE harbour sports 2" both reduce to "harbour sports 2", so all three stay
 * apart, because those are different feeds.
 *
 * That whole analysis was being redone for every page and every keystroke.
 * Measured on 150,000 channels it cost 480 ms a page, with another 164 for
 * the count beside it. Nothing in it depends on anything that changes between
 * reads: it is a function of the names and the providers, and those change
 * when a sync runs and at no other time.
 *
 * So it is resolved here, once, into `channels.group_key`, and the merged
 * query reads the answer. 480 ms becomes 63.
 */

/** The grouping key before prefixes are considered. */
const RAW_KEY = "CASE WHEN ch.match_key = '' THEN 'id:' || ch.id ELSE ch.match_key END"

/**
 * The key with a short leading word removed, or null when there is not one.
 *
 * Three or fewer letters and no digit: long enough to catch tr, uk, de and
 * ger, short enough to leave real first words alone. A digit disqualifies it,
 * because a number at the front identifies the channel rather than the
 * provider's filing.
 */
const WITHOUT_PREFIX = (key: string): string =>
  `CASE WHEN instr(${key}, ' ') BETWEEN 2 AND 4
         AND substr(${key}, 1, instr(${key}, ' ') - 1) NOT GLOB '*[0-9]*'
        THEN substr(${key}, instr(${key}, ' ') + 1) END`

const PREFIX = (key: string): string => `substr(${key}, 1, instr(${key}, ' ') - 1)`

/**
 * Resolves the grouping for the whole catalogue.
 *
 * Whole, not per playlist, and that is not laziness: whether a prefixed name
 * may collapse onto its unprefixed form depends on what every *other*
 * provider offers, so importing one playlist can change the grouping of
 * another's channels.
 *
 * Costs about 600 ms on 150,000 channels and proportionally less on anything
 * smaller, inside a sync that already takes seconds.
 */
export function rebuildGrouping(): void {
  const db = getDb()

  db.transaction(() => {
    // The provider's position in the user's ordering, which decides whose
    // copy represents a group when nobody has starred one.
    db.exec(
      `UPDATE channels
          SET playlist_sort = COALESCE(
                (SELECT p.sort_order FROM playlists p WHERE p.id = channels.playlist_id), 0)`
    )

    db.exec(
      `WITH raw AS (SELECT ch.id, ${RAW_KEY} AS gkey FROM channels ch),
            keys AS (SELECT DISTINCT gkey FROM raw),
            usable AS (
              SELECT ${WITHOUT_PREFIX('k.gkey')} AS base
              FROM keys k
              WHERE ${WITHOUT_PREFIX('k.gkey')} IS NOT NULL
                AND ${WITHOUT_PREFIX('k.gkey')} IN (SELECT gkey FROM keys)
              GROUP BY base
              HAVING COUNT(DISTINCT ${PREFIX('k.gkey')}) = 1
            )
       UPDATE channels
          SET group_key = (
                SELECT COALESCE(
                         (SELECT u.base FROM usable u WHERE u.base = ${WITHOUT_PREFIX('r.gkey')}),
                         r.gkey)
                FROM raw r WHERE r.id = channels.id)`
    )
  })()
}

/**
 * Packs a provider's position and a channel's id into one sortable number.
 *
 * `MIN()` over this is "the first copy in the user's own order", which is
 * what choosing a group's representative means — and it is a single
 * aggregate, so the whole choice happens in the same streamed pass that
 * counts the providers, with no window function and no sort.
 *
 * 2^32 as the stride, not a round decimal: SQLite integers are 64-bit, so
 * this is exact for any id below four billion and any ordering below two
 * billion, which is to say always. `% STRIDE` gives the id back unharmed.
 */
export const SORT_STRIDE = 4294967296
