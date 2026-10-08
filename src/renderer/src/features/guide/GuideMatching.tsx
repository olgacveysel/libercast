import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import type { EpgMatchRow, EpgMatchSuggestion } from '@shared/types'
import { invoke, messageOf } from '@renderer/lib/api'
import { initials } from '@renderer/lib/format'
import { IconClose, IconSearch } from '@renderer/ui/Icon'
import { VirtualList } from '@renderer/ui/VirtualList'

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
          ? `Matched ${result.matched} channel${result.matched === 1 ? '' : 's'} by name.` +
              (result.ambiguous > 0
                ? ` ${result.ambiguous} were too ambiguous to guess and need choosing by hand.`
                : '')
          : 'Nothing new could be matched by name. Pick the right guide channel below.'
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
      <button className="btn btn--ghost sheet__close" onClick={onClose} aria-label="Close">
        <IconClose size={17} />
      </button>

      <div className="matching">
        <header className="matching__head">
          <h2>Guide matching</h2>
          <p>
            A channel only shows guide data when its id appears in the XMLTV feed. {matchedCount} of{' '}
            {rows.length} are matched. The rest can be matched by name, or picked by hand.
          </p>
        </header>

        <div className="matching__bar">
          <div className="search" style={{ maxWidth: 260 }}>
            <IconSearch size={15} />
            <input
              className="input"
              placeholder="Search channels…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          <div className="segmented">
            <button aria-pressed={onlyUnmatched} onClick={() => setOnlyUnmatched(true)}>
              Needs fixing ({rows.length - matchedCount})
            </button>
            <button aria-pressed={!onlyUnmatched} onClick={() => setOnlyUnmatched(false)}>
              All ({rows.length})
            </button>
          </div>

          <div className="spacer" />

          <button className="btn btn--primary" onClick={() => void runAutoMatch()} disabled={busy}>
            {busy ? <span className="spinner" /> : null}
            Match by name
          </button>
        </div>

        {error && <div className="notice notice--error">{error}</div>}
        {notice && <div className="notice notice--success">{notice}</div>}

        {loading ? (
          <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>Loading…</p>
        ) : visible.length === 0 ? (
          <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>
            {onlyUnmatched
              ? 'Every channel is matched to the guide.'
              : 'No channels match that search.'}
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
              <span className="matchrow__ok">✓ {row.matchedName ?? 'matched'}</span>
              {row.overrideId && (
                <span className="matchrow__tag">{row.overrideAuto ? 'auto' : 'manual'}</span>
              )}
            </>
          ) : row.providerEpgId ? (
            <span className="matchrow__bad">
              id &ldquo;{row.providerEpgId}&rdquo; is not in the guide
            </span>
          ) : (
            <span className="matchrow__bad">the provider gave this channel no guide id</span>
          )}
        </span>
      </span>

      {row.overrideId && (
        <button className="btn btn--ghost" onClick={onClear} title="Go back to the provider's own id">
          Reset
        </button>
      )}

      <button className={`btn ${row.matched ? 'btn--ghost' : ''}`} onClick={onPick}>
        {row.matched ? 'Change' : 'Choose…'}
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
          <h2>Guide channel for {row.channelName}</h2>
          <p>Ranked by how closely the names match. Type to search the feed for something else.</p>
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
            {loading && <p style={{ padding: 10, color: 'var(--text-dim)', fontSize: 12.5 }}>Searching…</p>}

            {!loading && suggestions.length === 0 && (
              <p style={{ padding: 10, color: 'var(--text-dim)', fontSize: 12.5, margin: 0 }}>
                Nothing in the guide resembles that. The feed may not cover this channel at all.
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
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
