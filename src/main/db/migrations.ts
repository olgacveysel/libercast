import type Database from 'better-sqlite3'

export interface Migration {
  version: number
  name: string
  up: string
}

/**
 * Forward-only migrations. Never edit a shipped entry — append a new one.
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial',
    up: `
      CREATE TABLE playlists (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        name              TEXT    NOT NULL,
        kind              TEXT    NOT NULL CHECK (kind IN ('xtream','m3u','stalker')),
        url               TEXT    NOT NULL DEFAULT '',
        file_path         TEXT,
        username          TEXT,
        mac_address       TEXT,
        epg_url           TEXT,
        epg_offset_min    INTEGER NOT NULL DEFAULT 0,
        user_agent        TEXT,
        referrer          TEXT,
        enabled           INTEGER NOT NULL DEFAULT 1,
        sort_order        INTEGER NOT NULL DEFAULT 0,
        last_synced_at    INTEGER,
        created_at        INTEGER NOT NULL
      );

      CREATE TABLE categories (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        playlist_id   INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        external_id   TEXT    NOT NULL,
        name          TEXT    NOT NULL,
        kind          TEXT    NOT NULL CHECK (kind IN ('live','movie','series')),
        sort_order    INTEGER NOT NULL DEFAULT 0,
        UNIQUE (playlist_id, kind, external_id)
      );

      CREATE TABLE channels (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        playlist_id           INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        category_id           INTEGER REFERENCES categories(id) ON DELETE SET NULL,
        external_id           TEXT    NOT NULL,
        name                  TEXT    NOT NULL,
        name_folded           TEXT    NOT NULL,
        number                INTEGER,
        logo_url              TEXT,
        epg_channel_id        TEXT,
        stream_url            TEXT    NOT NULL,
        container_extension   TEXT,
        is_adult              INTEGER NOT NULL DEFAULT 0,
        hidden                INTEGER NOT NULL DEFAULT 0,
        added_at              INTEGER NOT NULL,
        seen_at               INTEGER NOT NULL,
        UNIQUE (playlist_id, external_id)
      );

      CREATE INDEX idx_channels_category   ON channels(category_id);
      CREATE INDEX idx_channels_playlist   ON channels(playlist_id, hidden);
      CREATE INDEX idx_channels_folded     ON channels(playlist_id, name_folded);
      CREATE INDEX idx_channels_epg        ON channels(epg_channel_id);

      CREATE TABLE favorites (
        channel_id  INTEGER PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
        added_at    INTEGER NOT NULL
      );

      CREATE TABLE watch_history (
        channel_id      INTEGER PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
        last_watched_at INTEGER NOT NULL,
        watch_count     INTEGER NOT NULL DEFAULT 1
      );

      CREATE INDEX idx_history_recent ON watch_history(last_watched_at DESC);

      CREATE TABLE epg_programs (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        playlist_id     INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        epg_channel_id  TEXT    NOT NULL,
        title           TEXT    NOT NULL,
        description     TEXT,
        category        TEXT,
        starts_at       INTEGER NOT NULL,
        ends_at         INTEGER NOT NULL
      );

      CREATE INDEX idx_epg_lookup ON epg_programs(epg_channel_id, starts_at, ends_at);
      CREATE INDEX idx_epg_prune  ON epg_programs(ends_at);

      CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `
  },
  {
    version: 2,
    name: 'content-kinds-vod-and-progress',
    up: `
      -- v1 stored the content kind only on categories, so the per-playlist
      -- prune at the end of an import could not tell live channels from movies
      -- and deleted whatever the current import did not touch. Channels carry
      -- their own kind now and the prune is scoped by it.
      ALTER TABLE channels ADD COLUMN kind TEXT NOT NULL DEFAULT 'live';

      UPDATE channels
      SET kind = COALESCE(
        (SELECT c.kind FROM categories c WHERE c.id = channels.category_id),
        CASE
          WHEN channels.external_id LIKE 'vod:%'    THEN 'movie'
          WHEN channels.external_id LIKE 'series:%' THEN 'series'
          ELSE 'live'
        END
      );

      CREATE INDEX idx_channels_kind ON channels(playlist_id, kind, hidden);

      -- Extended VOD metadata, fetched lazily per title and cached.
      CREATE TABLE vod_info (
        channel_id     INTEGER PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
        plot           TEXT,
        cast_list      TEXT,
        director       TEXT,
        genre          TEXT,
        release_date   TEXT,
        rating         REAL,
        duration_secs  INTEGER,
        backdrop_url   TEXT,
        trailer_id     TEXT,
        fetched_at     INTEGER NOT NULL
      );

      -- Episodes are expanded on demand: fetching them for every series up
      -- front would mean thousands of requests per sync.
      CREATE TABLE series_episodes (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id          INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        external_id         TEXT    NOT NULL,
        season              INTEGER NOT NULL,
        episode             INTEGER NOT NULL,
        title               TEXT    NOT NULL,
        plot                TEXT,
        duration_secs       INTEGER,
        container_extension TEXT,
        still_url           TEXT,
        UNIQUE (channel_id, external_id)
      );

      CREATE INDEX idx_episodes_series ON series_episodes(channel_id, season, episode);

      -- One row per playable VOD item. Series episodes and movies share the
      -- table so Continue Watching is a single ordered query.
      CREATE TABLE playback_progress (
        item_type     TEXT    NOT NULL CHECK (item_type IN ('movie','episode')),
        item_id       INTEGER NOT NULL,
        channel_id    INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        position_secs REAL    NOT NULL,
        duration_secs REAL    NOT NULL,
        completed     INTEGER NOT NULL DEFAULT 0,
        updated_at    INTEGER NOT NULL,
        PRIMARY KEY (item_type, item_id)
      );

      CREATE INDEX idx_progress_recent  ON playback_progress(updated_at DESC);
      CREATE INDEX idx_progress_channel ON playback_progress(channel_id);

      -- Records which XMLTV ids a playlist's EPG refresh actually matched, so
      -- the guide can report coverage instead of silently showing nothing.
      CREATE TABLE epg_state (
        playlist_id      INTEGER PRIMARY KEY REFERENCES playlists(id) ON DELETE CASCADE,
        refreshed_at     INTEGER NOT NULL,
        programme_count  INTEGER NOT NULL,
        matched_channels INTEGER NOT NULL,
        source_url       TEXT
      );
    `
  },
  {
    version: 3,
    name: 'recordings',
    up: `
      CREATE TABLE recordings (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id    INTEGER REFERENCES channels(id) ON DELETE SET NULL,
        playlist_id   INTEGER REFERENCES playlists(id) ON DELETE CASCADE,
        -- Denormalized so a finished recording survives the channel being
        -- renamed, moved to another category, or dropped by the provider.
        title         TEXT    NOT NULL,
        channel_name  TEXT    NOT NULL,
        file_path     TEXT,
        status        TEXT    NOT NULL CHECK (status IN ('scheduled','recording','completed','failed','cancelled')),
        error         TEXT,
        starts_at     INTEGER NOT NULL,
        ends_at       INTEGER NOT NULL,
        started_at    INTEGER,
        finished_at   INTEGER,
        bytes         INTEGER NOT NULL DEFAULT 0,
        created_at    INTEGER NOT NULL
      );

      CREATE INDEX idx_recordings_status ON recordings(status, starts_at);
      CREATE INDEX idx_recordings_recent ON recordings(created_at DESC);
    `
  },
  {
    version: 4,
    name: 'downloads',
    up: `
      CREATE TABLE downloads (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        -- Deliberately the same (type, id) pair playback_progress uses, so a
        -- film watched half online resumes at the same point once downloaded.
        item_type     TEXT    NOT NULL CHECK (item_type IN ('movie','episode')),
        item_id       INTEGER NOT NULL,
        channel_id    INTEGER REFERENCES channels(id) ON DELETE CASCADE,
        playlist_id   INTEGER REFERENCES playlists(id) ON DELETE CASCADE,
        title         TEXT    NOT NULL,
        subtitle      TEXT,
        poster_url    TEXT,
        file_path     TEXT,
        status        TEXT    NOT NULL CHECK (status IN ('queued','downloading','paused','completed','failed','cancelled')),
        error         TEXT,
        bytes_total   INTEGER NOT NULL DEFAULT 0,
        bytes_done    INTEGER NOT NULL DEFAULT 0,
        created_at    INTEGER NOT NULL,
        finished_at   INTEGER,
        UNIQUE (item_type, item_id)
      );

      CREATE INDEX idx_downloads_status ON downloads(status, created_at);
    `
  },
  {
    version: 5,
    name: 'epg-channel-matching',
    up: `
      -- The channel declarations from the XMLTV feed. Without them the only
      -- way to connect a channel to the guide is an exact tvg-id match, which
      -- is exactly what fails on most providers.
      CREATE TABLE epg_channels (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        playlist_id    INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        epg_channel_id TEXT    NOT NULL,
        display_name   TEXT    NOT NULL,
        name_folded    TEXT    NOT NULL,
        icon_url       TEXT,
        UNIQUE (playlist_id, epg_channel_id)
      );

      CREATE INDEX idx_epg_channels_name ON epg_channels(playlist_id, name_folded);

      -- The guide id actually used, when it differs from what the provider
      -- advertised. Kept separate from epg_channel_id so a re-sync, which
      -- overwrites the provider's value, cannot wipe the user's correction.
      ALTER TABLE channels ADD COLUMN epg_override_id TEXT;

      -- Marks an override the matcher chose. Re-running auto-match may replace
      -- these; a manual choice is never touched.
      ALTER TABLE channels ADD COLUMN epg_override_auto INTEGER NOT NULL DEFAULT 0;

      CREATE INDEX idx_channels_epg_override ON channels(epg_override_id);
    `
  },
  {
    version: 6,
    name: 'epg-reminders',
    up: `
      -- A reminder is deliberately a copy of the programme rather than a
      -- reference to it. The epg_programs table is emptied and rebuilt on every
      -- guide refresh, so a foreign key there would delete the user's reminders
      -- as a side effect of updating the guide.
      CREATE TABLE epg_reminders (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id   INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        title        TEXT    NOT NULL,
        starts_at    INTEGER NOT NULL,
        ends_at      INTEGER NOT NULL,
        -- How long before the start to notify. 0 means at the start.
        lead_minutes INTEGER NOT NULL DEFAULT 5,
        -- Set when the notification has been shown, so a restart does not
        -- replay every reminder that already fired.
        notified_at  INTEGER,
        created_at   INTEGER NOT NULL,
        UNIQUE (channel_id, title, starts_at)
      );

      CREATE INDEX idx_reminders_due ON epg_reminders(notified_at, starts_at);
    `
  },
  {
    version: 7,
    name: 'stream-probe-cache',
    up: `
      -- What ffprobe found, kept between runs.
      --
      -- Identifying a stream costs a connection to the provider, and playing it
      -- costs a second one straight after. Most accounts allow very few at once
      -- — often one — so that pair is the difference between a channel opening
      -- and the provider refusing. A film's codecs never change, so asking
      -- again on every play is a connection spent on an answer already known.
      CREATE TABLE stream_probes (
        -- Host and path, never credentials.
        key        TEXT PRIMARY KEY,
        payload    TEXT    NOT NULL,
        -- Live and VOD expire on very different schedules.
        is_live    INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX idx_stream_probes_age ON stream_probes(updated_at);
    `
  },
  {
    version: 8,
    name: 'channel-health',
    up: `
      -- What the last favourites scan found, per channel.
      --
      -- The scan is slow by necessity — one channel at a time, because the
      -- account allows one or two connections — so throwing the answer away
      -- when the panel closes means paying for it again every time. Kept here,
      -- a favourite that failed last night is marked in the list this morning.
      CREATE TABLE channel_health (
        channel_id  INTEGER PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
        ok          INTEGER NOT NULL,
        -- The provider's own wording, where it gave any.
        reason      TEXT,
        checked_at  INTEGER NOT NULL
      );

      CREATE INDEX idx_channel_health_age ON channel_health(checked_at);
    `
  },
  {
    version: 9,
    name: 'catchup-window',
    up: `
      -- How many days of this channel the panel keeps.
      --
      -- Xtream reports it per channel and it varies wildly inside one account:
      -- the sports channels often keep a week while everything else keeps
      -- none. Storing it means a finished programme can be offered for replay
      -- only where there is actually something to replay — offering it
      -- everywhere and letting the provider refuse would spend a connection to
      -- learn what the listing already said.
      ALTER TABLE channels ADD COLUMN catchup_days INTEGER NOT NULL DEFAULT 0;

      -- The panel's own timezone, as it reports it.
      --
      -- Catch-up URLs carry a start time as local wall clock on the server,
      -- not as UTC and not as the viewer's clock. Guessing the viewer's is
      -- right only while viewer and panel share a timezone, which is the
      -- common case and exactly the kind of assumption that breaks silently
      -- for everyone it does not hold for — an hour out is a programme that
      -- starts in the wrong place with nothing on screen to explain it.
      ALTER TABLE playlists ADD COLUMN server_timezone TEXT;
    `
  },
  {
    version: 10,
    name: 'cross-source-match-key',
    up: `
      -- The identifying words of a channel name, normalised.
      --
      -- Two providers almost never spell a channel the same way — "Alto
      -- Sports 2 HD", "ALTO SPORTS 2", "TR | Alto Sports 2 (Hat 1)" — so
      -- showing them as one list means grouping on something other than the
      -- name. Scoring every pair in JavaScript would mean thousands of
      -- comparisons on every keystroke, so the normalised form is computed
      -- once at import and grouped on here. Digits survive normalisation,
      -- which is what keeps Alto 2 and Alto 4 apart.
      ALTER TABLE channels ADD COLUMN match_key TEXT NOT NULL DEFAULT '';

      CREATE INDEX idx_channels_match ON channels(kind, match_key);
    `
  }
]

export function migrate(db: Database.Database): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)')

  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((r) => (r as { version: number }).version)
  )

  const record = db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue
    const run = db.transaction(() => {
      db.exec(migration.up)
      record.run(migration.version, migration.name, Date.now())
    })
    run()
  }
}
