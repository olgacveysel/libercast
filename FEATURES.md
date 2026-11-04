# LiberCast — Feature Specification

**Platform:** Windows and Linux (Electron + React + TypeScript)
**License model:** Open source
**Scope:** Player only. The app ships no channels, playlists, or subscriptions — the user supplies their own provider.

---

> **Status column.** `Planned` is the milestone a feature was scheduled for and
> is kept as history. `Status` is what is in the build, checked against the code
> on 3 November 2026 for 0.9.0-beta.4. The two had drifted far enough apart that
> the table claimed work was outstanding that shipped months ago, and claimed
> milestones complete that contain features nobody ever wrote.

## Release plan

| Milestone | Contents |
|---|---|
| **M1 — Spine** ✅ | App shell, Xtream + M3U sources, Live TV browsing, player, favorites, search |
| **M2 — Guide** ✅ | XMLTV/Xtream EPG, timeline grid, now/next, ID matching (reminders pending) |
| **M3 — VOD** ◐ | Movies, Series, continue watching, auto-next episode — TMDB enrichment, VOD filters and playlist folders never built |
| **M4 — Capture** ✅ | Live recording, scheduled recordings, offline downloads |
| **M5 — Polish** ◐ | Parental controls, backup/restore, themes, i18n and update checks done; Stalker playback unverified |

---

## 1. Sources & providers

| # | Feature | Planned | Status |
|---|---|---|---|
| 1.1 | Xtream Codes login (host, port, username, password, http/https) | M1 | Built |
| 1.2 | M3U / M3U8 from remote URL | M1 | Built |
| 1.3 | M3U / M3U8 from local file (drag & drop) | M1 | Built |
| 1.4 | Parse `tvg-id`, `tvg-name`, `tvg-logo`, `group-title`, `tvg-chno` | M1 | Built |
| 1.5 | Multiple named playlists, fast switching between them | M1 | Built |
| 1.6 | Connection test + account panel (status, expiry, max/active connections) | M1 | Built |
| 1.7 | Manual + scheduled playlist refresh, diff report (added/removed channels) | M2 | Built |
| 1.8 | Playlist folders / grouping | M3 | Not built |
| 1.9 | Stalker / MAC portal handshake | M5 | Partial — Live TV and guide only; playback unverified |
| 1.10 | Credentials held by the OS keychain — DPAPI, Keychain, libsecret or KWallet — never plaintext on disk, and the interface says plainly when the machine offers none | M1 | Built |
| 1.11 | Play the same channel from another source when one fails, asking first when the names only resemble each other | — | Built |
| 1.12 | One merged channel list across sources, grouping the same channel from several providers | — | Built |

## 2. Live TV

| # | Feature | Planned | Status |
|---|---|---|---|
| 2.1 | Category sidebar → channel list → player layout | M1 | Built |
| 2.2 | Channel logos with placeholder fallback | M1 | Built — caching is Chromium's, not the application's |
| 2.3 | Virtualized channel list (must stay smooth at 50k+ entries) | M1 | Built |
| 2.4 | Channel search, fuzzy match on name and group | M1 | Built |
| 2.5 | Sort by name / channel number / group / recently watched | M1 | Built |
| 2.6 | Favorites (per playlist and global) | M1 | Built |
| 2.7 | Recently watched list | M1 | Built |
| 2.8 | Hide / block channels and whole categories | M2 | Built |
| 2.9 | Now-playing and next-up shown inline on each channel row | M2 | Built |
| 2.10 | Last-channel toggle, channel up/down hotkeys, numeric channel entry | M2 | Built |
| 2.11 | Picture-in-picture + mini player | M3 | Built — picture-in-picture floats over other applications; the corner player keeps the stream alive while you browse elsewhere in LiberCast |
| 2.12 | Multi-view: configurable grid of simultaneous channels | — | Built |

## 3. EPG / Guide

| # | Feature | Planned | Status |
|---|---|---|---|
| 3.1 | Xtream native EPG ingestion | M2 | Built |
| 3.2 | External XMLTV URL, gzip and plain, with scheduled refresh | M2 | Built |
| 3.3 | Timeline grid: channels vertical, time horizontal, "now" marker line | M2 | Built |
| 3.4 | Jump to now / +1h / +1d / date picker | M2 | Built |
| 3.5 | Program detail panel: title, description, category, cast, progress bar | M2 | Built |
| 3.6 | Per-playlist EPG time offset correction | M2 | Built |
| 3.7 | Fuzzy `tvg-id` ↔ EPG channel matching with manual override screen | — | Built |
| 3.8 | Reminders with Windows toast notifications | M2 | Built |
| 3.9 | EPG cached in local DB, incremental update, prune past programs | M2 | Built |
| 3.10 | Catch-up / archive playback where the provider exposes it | Post-1.0 | Partial — Xtream sources only |

## 4. Movies (VOD)

| # | Feature | Planned | Status |
|---|---|---|---|
| 4.1 | Poster grid by category, lazy image loading | M3 | Built |
| 4.2 | Detail page: backdrop hero, plot, cast, director, genre, year, rating, runtime | M3 | Built |
| 4.3 | Trailer playback where a YouTube ID is provided | M3 | Built |
| 4.4 | Continue Watching with exact resume position | M3 | Built |
| 4.5 | Optional TMDB enrichment when provider metadata is thin (user-supplied API key) | M3 | Not built |
| 4.6 | Filter by year and rating, sort by name / added / rating / year | M3 | Built — genre is served by the category pane; filters need a re-sync to populate |

## 5. Series

| # | Feature | Planned | Status |
|---|---|---|---|
| 5.1 | Series → seasons → episodes hierarchy | M3 | Built |
| 5.2 | Watched / unwatched marks, per-episode progress | M3 | Built |
| 5.3 | Auto-play next episode with skip countdown overlay | M3 | Built |
| 5.4 | "Next up" resume entry at episode level on the home screen | M3 | Built |
| 5.5 | Mark season / series as watched in one action | M3 | Built |

## 6. Playback engine

| # | Feature | Planned | Status |
|---|---|---|---|
| 6.1 | HLS (.m3u8), MPEG-TS, MP4, MKV playback | M1 | Built |
| 6.2 | Hardware decoding with software fallback (D3D11/DXVA2 on Windows, VA-API on Linux) | M1 | Built |
| 6.3 | Auto-reconnect and retry with backoff on stream drop | M1 | Built |
| 6.4 | Multi audio track selection | — | Built |
| 6.5 | Subtitle track selection + external .srt/.ass loading with timing offset | — | Built |
| 6.6 | Aspect ratio modes, zoom/crop | M2 | Built |
| 6.7 | Playback speed control for VOD | M3 | Built |
| 6.8 | Stream info overlay: codec, resolution, bitrate, fps, dropped frames | — | Built |
| 6.9 | Volume memory, mute state persistence | M1 | Built |
| 6.10 | Custom User-Agent and referrer per playlist (some providers require it) | M2 | Built |

## 7. Recording & downloads

| # | Feature | Planned | Status |
|---|---|---|---|
| 7.1 | Record current live channel to disk, direct TS remux, no re-encode | M4 | Built |
| 7.2 | Schedule a recording from a guide program entry | M4 | Built |
| 7.3 | Recording manager: active, scheduled, completed, disk usage | M4 | Built |
| 7.4 | Pre/post padding on scheduled recordings | M4 | Built |
| 7.5 | Download movies and episodes for offline viewing | — | Built |
| 7.6 | Download queue: pause, resume, cancel, concurrency limit | — | Built |
| 7.7 | Local library view for recordings and downloads | — | Built |
| 7.8 | Configurable output folder and filename template | M4 | Built |

## 8. Protection & data

| # | Feature | Planned | Status |
|---|---|---|---|
| 8.1 | Parental control: PIN gate (4–8 digits) | — | Built |
| 8.2 | Lock specific categories behind the PIN | — | Built |
| 8.3 | Keyword filter to hide matching titles | — | Built |
| 8.4 | Backup export: playlists, favorites, history, settings (optionally encrypted) | — | Built |
| 8.5 | Restore from backup, with merge or replace choice | — | Built |
| 8.6 | Full local-only operation — no telemetry, no phone-home | M1 | Built |

## 9. UI & app shell

| # | Feature | Planned | Status |
|---|---|---|---|
| 9.1 | Custom frameless title bar with window controls | M1 | Built |
| 9.2 | Dark-first design, accent color themes, light theme option | M1 | Built |
| 9.3 | Sidebar nav: Home / Live / Movies / Series / Guide / Favorites / Library / Settings | M1 | Built |
| 9.4 | Skeleton loaders and optimistic UI on every list | M1 | Built |
| 9.5 | Global search across live, movies and series (Ctrl+K) | — | Built |
| 9.6 | Full keyboard navigation + shortcut cheat sheet | — | Built |
| 9.7 | Remote-friendly focus mode for TV-style navigation | Post-1.0 | Built — arrow keys move focus, focus is visible, the player yields the arrows and takes a remote's media keys. Gamepads are not read; a remote that sends key events is |
| 9.8 | Settings: startup behavior, hardware accel, download paths | M1 | Built — "cache size" dropped: the application manages no disk cache, logos come from Chromium's own HTTP cache and the rest is in memory |
| 9.9 | i18n — English, German, Turkish | M5 | Built |
| 9.10 | First-run onboarding wizard (add your first source) | M1 | Built |
| 9.11 | Opt-in update checks, asked once on first run, never before an answer | — | Built |

## 10. Post-1.0 candidates

- Chromecast / DLNA casting
- Watch statistics dashboard
- Profile sync across devices
- Plugin/extension API

---

## Proposed architecture

```
libercast/
├─ src/main/            Electron main process (Node)
│  ├─ ipc/              typed IPC channel handlers
│  ├─ sources/          xtream.ts | m3u.ts | stalker.ts  → normalized model
│  ├─ epg/              xmltv parser (streaming), matcher, scheduler
│  ├─ db/               better-sqlite3 schema + migrations
│  ├─ capture/          ffmpeg recording + download manager
│  └─ secure/           DPAPI credential storage
├─ src/preload/         contextBridge — no nodeIntegration in renderer
├─ src/renderer/        React 18 + TypeScript
│  ├─ features/         live | guide | movies | series | library | settings
│  ├─ player/           mpv/video surface wrapper + controls
│  ├─ ui/               design system primitives
│  └─ store/            Zustand + TanStack Query
└─ resources/           ffmpeg.exe, mpv binaries, icons
```

**Key choices to confirm**

- **Player core:** `mpv` via `libmpv` (best format tolerance for IPTV's messy streams) vs. `hls.js` + `<video>` (simpler, but weaker on raw MPEG-TS). Recommendation: mpv.
- **Storage:** `better-sqlite3` — needed because a 50k-channel playlist plus EPG is far too large for JSON files.
- **Build:** Vite + `electron-vite`, packaged with `electron-builder` (NSIS installer + portable exe).
- **Recording:** bundled `ffmpeg` with `-c copy` remux.
