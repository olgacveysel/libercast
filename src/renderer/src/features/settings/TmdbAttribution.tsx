import type { JSX } from 'react'
import { useT } from '@renderer/i18n'

/*
 * The attribution The Movie Database's terms require.
 *
 * Two parts, both theirs: an approved logo, and a sentence that is quoted
 * rather than translated. Their terms also require the logo to be "less
 * prominent than the logo or mark that primarily describes the application",
 * which the stylesheet enforces by capping its height well under the
 * LiberCast mark's.
 *
 * The logo is loaded by glob rather than imported directly. It is not in this
 * repository — it has to come from TMDB's own attribution page, unaltered —
 * and a static import of a missing file breaks the build for everyone who
 * clones. This way the build stays green, the notice still shows, and
 * `test/tmdb.test.ts` is what says the file is missing.
 */
const LOGOS = import.meta.glob('@renderer/assets/tmdb.{svg,png}', {
  eager: true,
  query: '?url',
  import: 'default'
}) as Record<string, string>

const LOGO = Object.values(LOGOS)[0] ?? null

export function TmdbAttribution(): JSX.Element {
  const t = useT()

  return (
    <p className="tmdb-credit">
      {LOGO && <img className="tmdb-credit__logo" src={LOGO} alt="The Movie Database" />}
      <span>{t('settings.metaAttribution')}</span>
    </p>
  )
}
