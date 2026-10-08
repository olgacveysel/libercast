<img src="resources/wordmark.png" alt="LiberCast" width="340">

A free, open-source IPTV player for Windows. Built with Electron, React and TypeScript.

LiberCast is **player-only software**. It ships no channels, playlists or subscriptions —
you connect your own provider.

---

## Download

Windows 10/11, 64-bit. Grab the installer or the portable build from
[Releases](../../releases).

This is a **beta**. The build is not code-signed, so Windows SmartScreen will
say the publisher is unknown and hide the Run button behind *More info → Run
anyway*. That warning is accurate — only get past it if you trust where you got
the file. [`docs/BETA-TESTING.md`](./docs/BETA-TESTING.md) covers what to expect
and how to send a useful bug report.

You also need your own IPTV source: an Xtream Codes login, or an M3U playlist
URL or file.

## Status

Beta — `0.9.0-beta.1`. Milestones 1–4 are implemented and building.

**Sources & live TV** — Xtream Codes and M3U/M3U8, connection testing before you
save, SQLite catalog that handles 50k+ channel playlists, category browsing,
virtualized channel list, multi-token search, sort, favorites, watch history.

**Guide** — XMLTV ingestion (plain or gzip, streamed) from the provider's own
feed or a URL you supply, a timeline grid with a live now-marker, program detail,
per-source timezone offset correction, and — when the provider's `tvg-id` values
do not line up with the feed — name-based matching plus a screen for fixing the
rest by hand.

**Movies & series** — poster browsing by category, backdrop detail pages with
metadata fetched lazily per title, season and episode expansion, watched marks,
resume, auto-play next episode, and Continue Watching on the home screen.

**Playback** — every stream, including the raw MPEG-TS most providers serve for
live channels, is remuxed to fragmented MP4 by a bundled ffmpeg and served over
loopback. VOD seeking, resume, and a transport bar work over that pipeline.

**Audio and subtitle tracks** — multi-language titles expose every audio and
subtitle track with readable names, selectable while watching. Set preferred
languages once in Settings and they are chosen automatically from then on.
External `.srt`, `.ass` and `.vtt` files can be opened for any title, with a
timing nudge for files that run out of sync.

**Multi-view** — two to nine channels at once in a configurable grid, with one
tile carrying the audio. The layout is remembered between sessions.

**Stream info** — resolution, measured frame rate, dropped frames, codec and
bitrate over the picture while windowed. Press I to toggle.

**Recording** — record the channel you are watching, or schedule a programme
from the guide with padding either side. Recordings copy the provider stream
without re-encoding, survive app restarts, and play back in the Library.

**Offline downloads** — keep films and episodes on disk. Transfers resume after
a pause, a crash or a dropped connection, and a downloaded title plays from the
local file with no provider connection at all.

**Parental controls** — a PIN hides locked categories, blocked words and adult
content everywhere at once, with an idle auto-lock.

**Backup and restore** — sources, favorites, watch history and positions to a
single file. Provider passwords are opt-in and force encryption.

**Shell** — frameless custom chrome, a Ctrl+K search across everything, a home
screen built around resuming, dark/light themes, accent colors, interface
scaling, and credentials encrypted with Windows DPAPI via `safeStorage`.

Every milestone in [`FEATURES.md`](./FEATURES.md) is now implemented; what is
left there is marked post-1.0.

## Quick start

```bash
npm ci
npm run dev
```

Then add a source from the sidebar and hit **Sync**.

Packaging has to happen on Windows: the build contains `better-sqlite3`, a
native module that must be compiled for the platform it will run on.

Do not build inside a OneDrive-synced folder. The sync client holds the output
files open while it uploads them, which makes electron-builder fail to replace
them and quietly produce a package containing the previous build.

## Scripts

| Script | Does |
|---|---|
| `npm run dev` | Runs the app with hot reload |
| `npm run typecheck` | Type-checks the main/preload and renderer projects separately |
| `npm test` | Runs the test suite under Electron's node runtime |
| `npm run build` | Type-checks and builds all three bundles |
| `npm run pack:win` | Builds an NSIS installer and a portable .exe into `release/` |
| `npm run pack:win:dir` | Packages without building the installer — quicker when you only want to check the app starts |
| `npm run verify:player` | Drives a real Electron window and asserts subtitles are *displayed*, not merely delivered. Needs a display (`xvfb-run` on Linux) |

## Architecture

```
src/
├─ shared/          Domain model + the typed IPC contract both sides import
├─ main/            Electron main process
│  ├─ db/           SQLite schema, migrations, repositories
│  ├─ media/        ffmpeg pipeline: probe, remux server, recorder, scheduler, downloader
│  ├─ sources/      M3U parser, Xtream client, XMLTV reader, sync orchestrator
│  ├─ secure/       DPAPI credential storage, parental PIN, encrypted backups
│  ├─ ipc/          Handler registration
│  └─ util/         HTTP with timeouts and credential redaction, logging
├─ preload/         contextBridge — the renderer's only door to the main process
└─ renderer/        React app
   ├─ features/     live · guide · vod · downloads · library · multiview · search
   │                 player · settings · onboarding · home
   ├─ ui/           Design-system primitives, icons, virtual list
   └─ store/        Zustand app state
```

### Design decisions worth knowing

**Everything crosses one typed IPC contract.** `src/shared/ipc.ts` declares every
channel with its request and response type. The preload bridge, the main-process
router and the renderer client all derive from that single map, so a renamed
channel is a compile error rather than a runtime `undefined`.

**Credentials never reach the renderer.** Passwords are encrypted with
`safeStorage` (DPAPI on Windows) and stored as ciphertext. Xtream stream URLs are
assembled in the main process on demand, so a stored channel row never contains a
password and changing your password does not require a re-sync. The renderer is
handed a `http://127.0.0.1` session URL and never the provider URL — which
matters, because for Xtream the password is a path segment in that URL.

**AAC out of MPEG-TS needs converting, not just copying.** AAC in a transport
stream is ADTS-framed; MP4 wants raw AAC with its configuration in the sample
entry. Copying between them without `aac_adtstoasc` makes the muxer reject the
first packet and kill the stream, which from the sofa looks like a channel that
opens and then freezes. The MP4 header is also held back with `delay_moov` until
the first packet, so the track's decoder configuration is known before it is
written — otherwise the browser reports an unsupported pixel format and shows
nothing. There is a regression test that builds exactly that stream and proves
the whole thing comes through rather than a stalled fragment.

**A copy failure downgrades itself.** If ffmpeg dies early complaining about
bitstreams or muxing, that stream is remembered as un-copyable and the player's
own retry comes back re-encoding. The user sees a reconnect, not a dead channel.

**One player, one session.** Each player sends a stable owner id, and opening a
new session retires that owner's previous one first. Without it a re-render or
a fast channel change leaves two ffmpeg processes competing for a provider
connection the account probably only has one of.

**Playback goes through ffmpeg, not the browser.** Chromium has no MPEG-TS
demuxer, and MPEG-TS is what most panels serve for live channels. Every session
spawns ffmpeg, which remuxes into fragmented MP4 on a loopback HTTP socket —
fragmented because a plain MP4 needs its index at the front, which a live source
can never provide. Codecs are probed first: H.264, HEVC and AAC are copied
untouched, and only what the container or the browser cannot take (AC-3 audio,
MPEG-2 video) is re-encoded, so the common case costs almost no CPU.

**A binary that starts is not a binary that works.** ffmpeg is resolved from a
configured folder, then the bundled copy, then `PATH`, and each candidate has to
survive a `-version` run before it is accepted. This is not hypothetical: the
bundled static build segfaults while demuxing MPEG-TS on some Linux hosts, and on
Windows antivirus quarantine is the usual cause. When nothing works the UI says
so and points at the setting, rather than showing a black screen.

**One ffmpeg carries the subtitles too.** Selecting a text subtitle adds a
second output on file descriptor 3 emitting WebVTT, alongside the video on
stdout. Two outputs from one process means one connection to the provider,
which matters because Xtream accounts commonly allow exactly one — extracting
subtitles with a separate ffmpeg would fight the video stream for it. Cues are
read from that pipe and pushed into a `TextTrack` as they arrive, rather than
loaded through a `<track src>`, because the WebVTT is still growing while the
film plays; a `<track>` would show nothing until the whole file had been read.

**The guide matches by name when ids fail.** A channel only shows programmes if
its `tvg-id` appears in the XMLTV feed, and providers get this wrong constantly
— empty ids, stale ids, or a feed from somewhere else entirely. The symptom is
an empty grid with nothing to explain it. Every refresh now also captures the
feed's own channel declarations and matches the unmatched channels by name.

Two rules keep that from doing harm. Numbers identify a channel, so if two names
carry different numbers they never match however similar the words are —
otherwise "beIN Sports 2" cheerfully matches "beIN Sports 4", which is worse
than an empty guide because it looks like it works. But a number introduced by
a feed qualifier is not a channel number: "beIN Sports 2 (Hat 1)" is line 1 of
channel 2, so those are stripped before the rule applies. And a best candidate
must beat the runner-up by a clear margin, because two names scoring 0.84 and
0.83 means the answer is a guess.

**Corrections are kept apart from what the provider said.** An override lives in
its own column, so a re-sync — which overwrites the provider's id — cannot erase
it, and re-running the matcher replaces only its own earlier guesses, never a
choice made by hand.

**Bitmap subtitles are a different problem.** PGS, VobSub and DVB subtitles are
pictures, not text, so they cannot become WebVTT. Those are detected during the
probe and drawn into the video instead, which forces a re-encode — the UI says
so when it happens rather than silently costing a core.

**Subtitle files are rarely UTF-8.** Turkish subtitles are usually
Windows-1254 and Western European ones Windows-1252, and nothing in the file
declares which. Reading one as UTF-8 produces mojibake, so the encoding is
inferred instead: a BOM settles it outright, otherwise a strict UTF-8 decode is
attempted and its failure is taken as proof of a legacy code page. SubRip is
converted to WebVTT in-process, so external subtitles work even without ffmpeg;
only ASS and the more exotic formats need it.

**The frame rate shown is measured, not declared.** Containers state a frame
rate that is frequently wrong on live streams — `90000/1` appears regularly — so
the overlay counts frames the compositor actually presented, via
`requestVideoFrameCallback`, and shows the declared value beside it only for
comparison.

**Each multi-view tile is a separate provider connection.** That is a hard
constraint rather than an implementation detail: most Xtream accounts allow one
or two connections, so tiles past that limit will not start. The UI says so
before the failures happen instead of leaving the user guessing.

**Changing a track reopens the stream.** ffmpeg is mapping one audio and one
subtitle stream, so a different selection needs a different ffmpeg. That reuses
the seek machinery: the session reopens at the current position and playback
carries on.

**VOD seeking reopens the stream.** A piped fMP4 has no index, so the video
element cannot seek inside it. Seeking instead reopens the session with ffmpeg's
`-ss` before `-i` (which makes it a keyframe jump, not a decode-and-discard) and
treats that offset as the origin of the element's timeline.

**Downloads do not go through ffmpeg.** A VOD title is already a finished file
on the provider's server, so a plain HTTP transfer produces a byte-identical
copy at no CPU cost — and, because providers support range requests, one that
resumes from exactly where it stopped. A provider that ignores the range header
and answers 200 instead of 206 is detected, and the file is rewritten rather
than appended to; appending there would silently corrupt it.

**A download row is keyed to the same identity as playback progress.** A film
watched halfway online resumes at the same point once downloaded, because both
tables key on the same `(item type, item id)` pair.

**Recordings never re-encode.** ffmpeg copies the provider's stream to disk, so
a recording is bit-identical to the broadcast and costs almost nothing to make.
It lands in MP4 when the codecs fit that container and MPEG-TS otherwise. Stops
use SIGINT rather than SIGKILL, because a killed ffmpeg leaves an MP4 with no
moov atom that nothing can play.

**Re-syncs preserve channel ids.** The import path upserts on
`(playlist_id, external_id)` and prunes rows the provider stopped returning, so
favorites and watch history survive a provider reshuffling its catalog. M3U has no
stable id, so one is derived from the stream URL.

**The channel list is windowed.** A 50k-channel playlist renders as roughly one
viewport of DOM nodes. Search terms are matched against a pre-folded
(accent-stripped, punctuation-collapsed) column so `LIKE` stays index-friendly.

**Content kinds are a column, not a convention.** Live channels, movies and
series share one `channels` table, and every query filters on `kind`. This is
load-bearing: a sync imports the three catalogs in sequence, and each import
prunes the rows the provider stopped returning. Scoping that prune by kind is
what stops the movie pass from deleting the live channels the previous pass just
wrote. There is a regression test for exactly this.

**The XMLTV reader streams.** Provider guide files run to hundreds of megabytes.
Chunks are appended to a small buffer, complete `<programme>` elements are cut
out and flushed to SQLite in batches, and the remainder carries to the next
chunk — so memory stays flat and no DOM parser is involved. Gzip is detected by
sniffing magic bytes, because `xmltv.php` commonly serves gzip under a
`text/html` header.

**VOD metadata is fetched lazily.** Calling `get_vod_info` for every title during
a sync would mean thousands of requests. Metadata is fetched when a title is
opened and cached thereafter; a panel that does not expose it degrades to poster
and playback rather than failing.

**Parental filtering happens in SQL, not in the UI.** The lock adds its clauses
to the catalog queries themselves, so a hidden channel never reaches the
renderer at all. Doing it per screen would mean the list, search, favorites,
Continue Watching and the guide each needed their own filter — and one of them
would eventually be forgotten, which is the only kind of bug that matters here.
There is a test asserting a blocked title is unreachable from every one of them.

**The PIN is hashed with scrypt.** A four-digit PIN has ten thousand
possibilities, so the only meaningful defence is making each guess expensive.
Unlocking is process state rather than a stored flag, which means closing the
app always re-locks and no file can be edited to bypass it.

**A backup references channels by provider id, not row id.** Restoring into a
fresh database assigns entirely different row ids, so favorites and watch
positions are matched on the identity the provider gave them and reattach once
the source is synced.

## Third-party binaries

ffmpeg and ffprobe are fetched at install time by `ffmpeg-static` and
`ffprobe-static`, and are **invoked as separate executables** — LiberCast
spawns them and reads their output. Nothing from ffmpeg is linked into this
application.

The wrapper packages are MIT. The binaries they download are not:
`ffmpeg-static` declares **GPL-3.0-or-later**, and that is what the shipped
installer carries. Distributing it therefore means distributing a GPL-3 binary,
which is allowed and does not change LiberCast's own licence, but it does carry
two obligations — the licence text has to travel with it, and the corresponding
source has to be obtainable. Both are handled: the installer puts the GPL text,
the exact build's manifest, `LICENSE` and the notices beside `LiberCast.exe`
rather than burying them in the archive.

[`THIRD-PARTY-NOTICES.md`](./THIRD-PARTY-NOTICES.md) has the detail, including
how to produce a build with no GPL component at all — LiberCast already prefers
an `ffmpeg` on `PATH` over its bundled copy, so dropping those two packages
leaves a working application for anyone who installs ffmpeg themselves.

## Legal

LiberCast does not provide, host, resell or endorse any media content, channel
list, or subscription. It is a client for playlists and provider accounts that
users already have. Users are responsible for the legality of the sources they
configure.

## License

**LiberCast's own source code is MIT** — see [LICENSE](./LICENSE). Use it, fork
it, ship it closed-source if you like.

The packaged installer is a different question, because it also contains
ffmpeg, which is GPL-3. Those two licences sit side by side rather than
conflicting: LiberCast runs ffmpeg as a separate program rather than linking
its libraries, so the GPL covers the ffmpeg binary and not the application that
calls it. If you ever change that — linking `libavcodec` instead of spawning
`ffmpeg.exe` — the analysis changes and the whole thing would likely have to be
GPL.

The GPL text under `resources/licenses/` is ffmpeg's, not LiberCast's. It is in
this repository so the installer can place it next to the binary it applies to.

None of the above is legal advice.
