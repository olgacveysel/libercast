# LiberCast — Feature Specification

**Platform:** Windows (Electron + React + TypeScript)
**License model:** Open source
**Scope:** Player only. The app ships no channels, playlists, or subscriptions — the user supplies their own provider.

---

## Release plan

| Milestone | Contents |
|---|---|
| **M1 — Spine** ✅ | App shell, Xtream + M3U sources, Live TV browsing, player, favorites, search |
| **M2 — Guide** ✅ | XMLTV/Xtream EPG, timeline grid, now/next, ID matching (reminders pending) |
| **M3 — VOD** ✅ | Movies, Series, continue watching, auto-next episode |
| **M4 — Capture** ✅ | Live recording, scheduled recordings, offline downloads |
| **M5 — Polish** ◐ | Parental controls, backup/restore, themes done; i18n and auto-update pending |

---

## 1. Sources & providers

| # | Feature | Milestone |
|---|---|---|
| 1.1 | Xtream Codes login (host, port, username, password, http/https) | M1 |
| 1.2 | M3U / M3U8 from remote URL | M1 |
| 1.3 | M3U / M3U8 from local file (drag & drop) | M1 |
| 1.4 | Parse `tvg-id`, `tvg-name`, `tvg-logo`, `group-title`, `tvg-chno` | M1 |
| 1.5 | Multiple named playlists, fast switching between them | M1 |
| 1.6 | Connection test + account panel (status, expiry, max/active connections) | M1 |
| 1.7 | Manual + scheduled playlist refresh, diff report (added/removed channels) | M2 |
| 1.8 | Playlist folders / grouping | M3 |
| 1.9 | Stalker / MAC portal handshake | M5 |
| 1.10 | Credentials stored via Windows DPAPI, never plaintext on disk | M1 |

## 2. Live TV

| # | Feature | Milestone |
|---|---|---|
| 2.1 | Category sidebar → channel list → player layout | M1 |
| 2.2 | Channel logos with disk cache and placeholder fallback | M1 |
| 2.3 | Virtualized channel list (must stay smooth at 50k+ entries) | M1 |
| 2.4 | Channel search, fuzzy match on name and group | M1 |
| 2.5 | Sort by name / channel number / group / recently watched | M1 |
| 2.6 | Favorites (per playlist and global) | M1 |
| 2.7 | Recently watched list | M1 |
| 2.8 | Hide / block channels and whole categories | M2 |
| 2.9 | Now-playing and next-up shown inline on each channel row | M2 |
| 2.10 | Last-channel toggle, channel up/down hotkeys, numeric channel entry | M2 |
| 2.11 | Picture-in-picture + mini player | M3 |
| 2.12 | Multi-view: configurable grid of simultaneous channels | ✅ |

## 3. EPG / Guide

| # | Feature | Milestone |
|---|---|---|
| 3.1 | Xtream native EPG ingestion | M2 |
| 3.2 | External XMLTV URL, gzip and plain, with scheduled refresh | M2 |
| 3.3 | Timeline grid: channels vertical, time horizontal, "now" marker line | M2 |
| 3.4 | Jump to now / +1h / +1d / date picker | M2 |
| 3.5 | Program detail panel: title, description, category, cast, progress bar | M2 |
| 3.6 | Per-playlist EPG time offset correction | M2 |
| 3.7 | Fuzzy `tvg-id` ↔ EPG channel matching with manual override screen | ✅ |
| 3.8 | Reminders with Windows toast notifications | M2 |
| 3.9 | EPG cached in local DB, incremental update, prune past programs | M2 |
| 3.10 | Catch-up / archive playback where the provider exposes it | Post-1.0 |

## 4. Movies (VOD)

| # | Feature | Milestone |
|---|---|---|
| 4.1 | Poster grid by category, lazy image loading | M3 |
| 4.2 | Detail page: backdrop hero, plot, cast, director, genre, year, rating, runtime | M3 |
| 4.3 | Trailer playback where a YouTube ID is provided | M3 |
| 4.4 | Continue Watching with exact resume position | M3 |
| 4.5 | Optional TMDB enrichment when provider metadata is thin (user-supplied API key) | M3 |
| 4.6 | Filter by genre / year / rating, sort by added / name / rating | M3 |

## 5. Series

| # | Feature | Milestone |
|---|---|---|
| 5.1 | Series → seasons → episodes hierarchy | M3 |
| 5.2 | Watched / unwatched marks, per-episode progress | M3 |
| 5.3 | Auto-play next episode with skip countdown overlay | M3 |
| 5.4 | "Next up" resume entry at episode level on the home screen | M3 |
| 5.5 | Mark season / series as watched in one action | M3 |

## 6. Playback engine

| # | Feature | Milestone |
|---|---|---|
| 6.1 | HLS (.m3u8), MPEG-TS, MP4, MKV playback | M1 |
| 6.2 | Hardware decoding (D3D11 / DXVA2) with software fallback | M1 |
| 6.3 | Auto-reconnect and retry with backoff on stream drop | M1 |
| 6.4 | Multi audio track selection | ✅ |
| 6.5 | Subtitle track selection + external .srt/.ass loading with timing offset | ✅ |
| 6.6 | Aspect ratio modes, zoom/crop | M2 |
| 6.7 | Playback speed control for VOD | M3 |
| 6.8 | Stream info overlay: codec, resolution, bitrate, fps, dropped frames | ✅ |
| 6.9 | Volume memory, mute state persistence | M1 |
| 6.10 | Custom User-Agent and referrer per playlist (some providers require it) | M2 |

## 7. Recording & downloads

| # | Feature | Milestone |
|---|---|---|
| 7.1 | Record current live channel to disk, direct TS remux, no re-encode | M4 |
| 7.2 | Schedule a recording from a guide program entry | M4 |
| 7.3 | Recording manager: active, scheduled, completed, disk usage | M4 |
| 7.4 | Pre/post padding on scheduled recordings | M4 |
| 7.5 | Download movies and episodes for offline viewing | ✅ |
| 7.6 | Download queue: pause, resume, cancel, concurrency limit | ✅ |
| 7.7 | Local library view for recordings and downloads | ✅ |
| 7.8 | Configurable output folder and filename template | M4 |

## 8. Protection & data

| # | Feature | Milestone |
|---|---|---|
| 8.1 | Parental control: PIN gate (4–8 digits) | ✅ |
| 8.2 | Lock specific categories behind the PIN | ✅ |
| 8.3 | Keyword filter to hide matching titles | ✅ |
| 8.4 | Backup export: playlists, favorites, history, settings (optionally encrypted) | ✅ |
| 8.5 | Restore from backup, with merge or replace choice | ✅ |
| 8.6 | Full local-only operation — no telemetry, no phone-home | M1 |

## 9. UI & app shell

| # | Feature | Milestone |
|---|---|---|
| 9.1 | Custom frameless title bar with window controls | M1 |
| 9.2 | Dark-first design, accent color themes, light theme option | M1 |
| 9.3 | Sidebar nav: Home / Live / Movies / Series / Guide / Favorites / Library / Settings | M1 |
| 9.4 | Skeleton loaders and optimistic UI on every list | M1 |
| 9.5 | Global search across live, movies and series (Ctrl+K) | ✅ |
| 9.6 | Full keyboard navigation + shortcut cheat sheet | ✅ |
| 9.7 | Remote/gamepad-friendly focus mode for TV-style navigation | Post-1.0 |
| 9.8 | Settings: startup behavior, cache size, hardware accel, download paths | M1 |
| 9.9 | i18n — English, German, Turkish | M5 |
| 9.10 | First-run onboarding wizard (add your first source) | M1 |

## 10. Post-1.0 candidates

- Chromecast / DLNA casting
- Playlist health checker — bulk dead-link scan
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
