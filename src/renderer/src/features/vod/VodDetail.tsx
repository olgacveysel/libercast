import { useEffect, useState, type JSX } from 'react'
import type { ChannelWithState, SeriesEpisode, SeriesSeason, VodInfo } from '@shared/types'
import { invoke, messageOf } from '@renderer/lib/api'
import { initials } from '@renderer/lib/format'
import { IconClose, IconStar } from '@renderer/ui/Icon'
import { DownloadButton } from '@renderer/features/downloads/DownloadButton'
import { useDownload } from '@renderer/features/downloads/useDownload'
import type { VodTarget } from './VodPlayer'

interface Props {
  channel: ChannelWithState
  onClose: () => void
  onPlay: (target: VodTarget) => void
  onToggleFavorite: (channel: ChannelWithState) => void
}

export function VodDetail({ channel, onClose, onPlay, onToggleFavorite }: Props): JSX.Element {
  const isSeries = channel.kind === 'series'

  const [info, setInfo] = useState<VodInfo | null>(null)
  const [seasons, setSeasons] = useState<SeriesSeason[]>([])
  const [activeSeason, setActiveSeason] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // A finished download plays from disk, so the button becomes a state badge.
  const { download } = useDownload('movie', isSeries ? null : channel.id)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setSeasons([])
    setInfo(null)

    const load = async (): Promise<void> => {
      try {
        if (isSeries) {
          const detail = await invoke('vod:seriesDetail', { channelId: channel.id })
          if (cancelled) return
          setInfo(detail.info)
          setSeasons(detail.seasons)
          setActiveSeason(detail.seasons[0]?.season ?? null)
        } else {
          const movie = await invoke('vod:movieInfo', { channelId: channel.id })
          if (cancelled) return
          setInfo(movie)
        }
      } catch (e) {
        if (!cancelled) setError(messageOf(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [channel.id, isSeries])

  const season = seasons.find((s) => s.season === activeSeason) ?? seasons[0] ?? null
  const facts = [
    info?.releaseDate?.slice(0, 4),
    info?.genre,
    info?.durationSecs ? formatRuntime(info.durationSecs) : null,
    isSeries ? `${seasons.length} season${seasons.length === 1 ? '' : 's'}` : null
  ].filter(Boolean) as string[]

  const playFirstUnwatched = (): void => {
    const episodes = seasons.flatMap((s) => s.episodes)
    const target = episodes.find((e) => !e.completed) ?? episodes[0]
    if (target) void playEpisode(target)
  }

  const playEpisode = async (episode: SeriesEpisode): Promise<void> => {
    // Prefer a finished download so playback needs no provider connection.
    const local = await invoke('downloads:forItem', { itemType: 'episode', itemId: episode.id }).catch(
      () => null
    )

    onPlay({
      itemType: 'episode',
      itemId: episode.id,
      channelId: channel.id,
      title: `${channel.name} — S${pad(episode.season)}E${pad(episode.episode)} ${episode.title}`,
      source: local?.status === 'completed' ? { type: 'download', id: local.id } : undefined
    })
  }

  return (
    <div className="sheet">
      <button className="btn btn--ghost sheet__close" onClick={onClose} aria-label="Back">
        <IconClose size={17} />
      </button>

      <div className="sheet__hero">
        {(info?.backdropUrl || channel.logoUrl) && (
          <div
            className="sheet__backdrop"
            style={{ backgroundImage: `url(${info?.backdropUrl ?? channel.logoUrl})` }}
          />
        )}

        <div className="sheet__poster">
          {channel.logoUrl ? (
            <img src={channel.logoUrl} alt="" />
          ) : (
            <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--text-dim)' }}>
              {initials(channel.name)}
            </div>
          )}
        </div>

        <div className="sheet__info">
          <h2>{channel.name}</h2>

          <div className="sheet__facts">
            {info?.rating != null && info.rating > 0 && (
              <span className="badge">★ {info.rating.toFixed(1)}</span>
            )}
            {facts.map((fact) => (
              <span key={fact}>{fact}</span>
            ))}
          </div>

          {loading ? (
            <p className="sheet__plot">
              <span className="spinner" style={{ display: 'inline-block', verticalAlign: 'middle' }} /> Loading
              details…
            </p>
          ) : (
            info?.plot && <p className="sheet__plot">{info.plot}</p>
          )}

          {error && <div className="notice notice--error" style={{ marginBottom: 12 }}>{error}</div>}

          <div className="sheet__actions">
            {isSeries ? (
              <button className="btn btn--primary" onClick={playFirstUnwatched} disabled={seasons.length === 0}>
                Play
              </button>
            ) : (
              <button
                className="btn btn--primary"
                onClick={() =>
                  onPlay({
                    itemType: 'movie',
                    itemId: channel.id,
                    channelId: channel.id,
                    title: channel.name,
                    // Prefer the downloaded copy: no provider connection, and
                    // it works with no network at all.
                    source:
                      download?.status === 'completed'
                        ? { type: 'download', id: download.id }
                        : undefined
                  })
                }
              >
                {download?.status === 'completed' ? 'Play offline' : 'Play'}
              </button>
            )}

            <button
              className={`btn ${channel.favorite ? 'btn--primary' : ''}`}
              onClick={() => onToggleFavorite(channel)}
            >
              <IconStar size={15} filled={channel.favorite} />
              {channel.favorite ? 'In favorites' : 'Favorite'}
            </button>

            {!isSeries && (
              <DownloadButton
                itemType="movie"
                itemId={channel.id}
                channelId={channel.id}
                title={channel.name}
                posterUrl={channel.logoUrl}
                onError={setError}
              />
            )}

            {info?.director && (
              <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>Directed by {info.director}</span>
            )}
          </div>
        </div>
      </div>

      {isSeries && (
        <div className="sheet__body">
          {seasons.length === 0 && !loading ? (
            <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>
              This provider did not return episodes for this series.
            </p>
          ) : (
            <>
              <div className="seasontabs">
                {seasons.map((s) => (
                  <button
                    key={s.season}
                    className={`btn ${s.season === season?.season ? 'btn--primary' : ''}`}
                    onClick={() => setActiveSeason(s.season)}
                  >
                    Season {s.season}
                  </button>
                ))}
              </div>

              {season?.episodes.map((episode) => {
                const progress =
                  episode.durationSecs && episode.positionSecs
                    ? Math.min(1, episode.positionSecs / episode.durationSecs)
                    : 0

                return (
                  <div
                    key={episode.id}
                    className="episode"
                    role="button"
                    tabIndex={0}
                    onClick={() => void playEpisode(episode)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        void playEpisode(episode)
                      }
                    }}
                  >
                    <span className="episode__num">{episode.episode}</span>

                    {episode.stillUrl ? (
                      <img className="episode__still" src={episode.stillUrl} alt="" loading="lazy" />
                    ) : (
                      <span className="episode__still" />
                    )}

                    <span className="episode__text">
                      <strong>{episode.title}</strong>
                      {episode.plot && <p>{episode.plot}</p>}
                      {progress > 0 && !episode.completed && (
                        <span className="progressbar" style={{ display: 'block', marginTop: 5, maxWidth: 220 }}>
                          <span className="progressbar__fill" style={{ width: `${progress * 100}%` }} />
                        </span>
                      )}
                    </span>

                    {episode.completed && <span className="episode__done">✓</span>}
                    {episode.durationSecs != null && episode.durationSecs > 0 && (
                      <span style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>
                        {formatRuntime(episode.durationSecs)}
                      </span>
                    )}

                    <DownloadButton
                      compact
                      itemType="episode"
                      itemId={episode.id}
                      channelId={channel.id}
                      title={channel.name}
                      subtitle={`S${pad(episode.season)}E${pad(episode.episode)} ${episode.title}`}
                      posterUrl={episode.stillUrl ?? channel.logoUrl}
                      onError={setError}
                    />
                  </div>
                )
              })}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function formatRuntime(seconds: number): string {
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}
