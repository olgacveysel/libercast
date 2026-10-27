import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import type { EpgMatchRow, EpgMatchSuggestion } from '@shared/types'
import { invoke, messageOf } from '@renderer/lib/api'
import { initials } from '@renderer/lib/format'
import { IconClose, IconSearch } from '@renderer/ui/Icon'
import { VirtualList } from '@renderer/ui/VirtualList'
import { useT } from '@renderer/i18n'

interface Props {
  playlistId: number
  onClose: () => void
  /** Called after any change, so the guide behind can reload. */
  onChanged: () => void
}

const ROW_HEIGHT = 58

/**
 * Repairs the link between provider channels and the guide.
 *
 * A guide that shows nothing is the most common EPG complaint, and the cause is
 * almost always that the provider's `tvg-id` values do not appear in the XMLTV
 * feed. Until now there was no way to see that, let alone fix it — the grid was
 * simply empty. This screen names the problem and lets it be corrected per
 * channel.
 */
export function GuideMatching({ playlistId, onClose, onChanged }: Props): JSX.Element {
  const t = useT()
  const [rows, setRows] = useState<EpgMatchRow[]>([])
  const [onlyUnmatched, setOnlyUnmatched] = useState(true)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<EpgMatchRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const reload = useCallback(() => {
    setLoading(true)
    void invoke('epg:matchRows', { playlistId, onlyUnmatched: false })
      .then(setRows)
      .catch((e) => setError(messageOf(e)))
      .finally(() => setLoading(false))
  }, [playlistId])

  useEffect(reload, [reload])

  const matchedCount = rows.filter((row) => row.matched).length

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return rows.filter((row) => {
      if (onlyUnmatched && row.matched) return false
      if (needle && !row.channelName.toLowerCase().includes(needle)) return false
      return true
    })
  }, [rows, onlyUnmatched, search])

  const runAutoMatch = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const result = await invoke('epg:autoMatch', playlistId)
      setNotice(
        result.matched > 0
          ? (result.matched === 1
              ? t('guide.matchedOne')
              : t('guide.matchedMany', { count: result.matched })) +
              (result.ambiguous > 0
                ? ` ${t('guide.matchedAmbiguous', { count: result.ambiguous })}`
                : '')
          : t('guide.matchedNone')
      )
      reload()
      onChanged()
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setBusy(false)
    }
  }

  const apply = async (channelId: number, epgChannelId: string | null): Promise<void> => {
    try {
      await invoke('epg:setOverride', { channelId, epgChannelId })
      setSelected(null)
      reload()
      onChanged()
    } catch (e) {
      setError(messageOf(e))
    }
  }

  return (
    <div className="sheet">
      <button className="btn btn--ghost sheet__close" onClick={onClose} aria-label={t('common.close')}>
        <IconClose size={17} />
      </button>

      <div className="matching">
        <header className="matching__head">
          <h2>{t('guide.matching')}</h2>
          <p>{t('guide.matchingBody', { matched: matchedCount, total: rows.length })}</p>
        </header>

        <div className="matching__bar">
          <div className="search" style={{ maxWidth: 260 }}>
            <IconSearch size={15} />
            <input
              className="input"
              placeholder={t('live.searchChannels')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          <div className="segmented">
            <button aria-pressed={onlyUnmatched} onClick={() => setOnlyUnmatched(true)}>
              {t('guide.needsFixing', { count: rows.length - matchedCount })}
            </button>
            <button aria-pressed={!onlyUnmatched} onClick={() => setOnlyUnmatched(false)}>
              {t('guide.allCount', { count: rows.length })}
            </button>
          </div>

          <div className="spacer" />

          <button className="btn btn--primary" onClick={() => void runAutoMatch()} disabled={busy}>
            {busy ? <span className="spinner" /> : null}
            {t('guide.matchByName')}
          </button>
        </div>

        {error && <div className="notice notice--error">{error}</div>}
        {notice && <div className="notice notice--success">{notice}</div>}

        {loading ? (
          <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>{t('common.loading')}</p>
        ) : visible.length === 0 ? (
          <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>
            {onlyUnmatched ? t('guide.allMatched') : t('guide.noSearchMatch')}
          </p>
        ) : (
          <VirtualList
            className="matching__list"
            items={visible}
            itemHeight={ROW_HEIGHT}
            keyOf={(row) => row.channelId}
            renderItem={(row) => (
              <MatchRow row={row} onPick={() => setSelected(row)} onClear={() => void apply(row.channelId, null)} />
            )}
          />
        )}
      </div>

      {selected && (
        <SuggestionPicker
          playlistId={playlistId}
          row={selected}
          onClose={() => setSelected(null)}
          onPick={(epgChannelId) => void apply(selected.channelId, epgChannelId)}
        />
      )}
    </div>
  )
}

function MatchRow({
  row,
  onPick,
  onClear
}: {
  row: EpgMatchRow
  onPick: () => void
  onClear: () => void
}): JSX.Element {
  const t = useT()

  return (
    <div className="matchrow" style={{ height: ROW_HEIGHT }}>
      <span className="matchrow__logo">
        {row.logoUrl ? <img src={row.logoUrl} alt="" loading="lazy" /> : <span>{initials(row.channelName)}</span>}
      </span>

      <span className="matchrow__text">
        <strong>{row.channelName}</strong>
        <span>
          {row.matched ? (
            <>
              <span className="matchrow__ok">✓ {row.matchedName ?? t('guide.matched')}</span>
              {row.overrideId && (
                <span className="matchrow__tag">
                  {row.overrideAuto ? t('guide.overrideAuto') : t('guide.overrideManual')}
                </span>
              )}
            </>
          ) : row.providerEpgId ? (
            <span className="matchrow__bad">{t('guide.idNotInGuide', { id: row.providerEpgId })}</span>
          ) : (
            <span className="matchrow__bad">{t('guide.noProviderId')}</span>
          )}
        </span>
      </span>

      {row.overrideId && (
        <button className="btn btn--ghost" onClick={onClear} title={t('guide.resetToProviderId')}>
          {t('player.reset')}
        </button>
      )}

      <button className={`btn ${row.matched ? 'btn--ghost' : ''}`} onClick={onPick}>
        {row.matched ? t('guide.change') : t('settings.choose')}
      </button>
    </div>
  )
}

function SuggestionPicker({
  playlistId,
  row,
  onClose,
  onPick
}: {
  playlistId: number
  row: EpgMatchRow
  onClose: () => void
  onPick: (epgChannelId: string) => void
}): JSX.Element {
  const t = useT()
  const [suggestions, setSuggestions] = useState<EpgMatchSuggestion[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    void invoke('epg:suggestions', { playlistId, channelName: search.trim() || row.channelName })
      .then(setSuggestions)
      .catch(() => setSuggestions([]))
      .finally(() => setLoading(false))
  }, [playlistId, row.channelName, search])

  return (
    <div className="scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true">
        <div className="dialog__head">
          <h2>{t('guide.channelFor', { name: row.channelName })}</h2>
          <p>{t('guide.rankedBody')}</p>
        </div>

        <div className="dialog__body" style={{ gap: 10 }}>
          <div className="search" style={{ maxWidth: 'none' }}>
            <IconSearch size={15} />
            <input
              className="input"
              placeholder={row.channelName}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              autoFocus
            />
          </div>

          <div style={{ maxHeight: 320, overflowY: 'auto', margin: '0 -4px' }}>
            {loading && (
              <p style={{ padding: 10, color: 'var(--text-dim)', fontSize: 12.5 }}>{t('guide.searching')}</p>
            )}

            {!loading && suggestions.length === 0 && (
              <p style={{ padding: 10, color: 'var(--text-dim)', fontSize: 12.5, margin: 0 }}>
                {t('guide.noSuggestions')}
              </p>
            )}

            {suggestions.map((suggestion) => (
              <button
                key={suggestion.epgChannelId}
                className="mvpick"
                onClick={() => onPick(suggestion.epgChannelId)}
              >
                <span className="mvpick__name">{suggestion.displayName}</span>
                <span className={`matchrow__score ${suggestion.score >= 0.82 ? 'matchrow__score--good' : ''}`}>
                  {Math.round(suggestion.score * 100)}%
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="dialog__foot">
          <div className="spacer" />
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}
