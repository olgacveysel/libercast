# LiberCast beta — testing notes

For anyone installing `LiberCast-0.9.0-beta.1-setup.exe` on a machine that is
not the one it was built on.

## What you need

Windows 10 or 11, 64-bit. Nothing else — ffmpeg is inside the installer.

You also need your own IPTV source: an Xtream Codes login, or an M3U playlist
URL or file. LiberCast provides none of that.

## Windows will warn you

This build is not code-signed, so Windows SmartScreen shows **"Windows
protected your PC"** and hides the Run button behind **More info → Run
anyway**. That warning is accurate: it means Windows cannot tell who built
this. Only get past it if you received the file directly from Veysel.

Signing it would remove the warning, but a code-signing certificate costs a few
hundred euros a year, which is not worth it for a beta. Expect the same warning
on every beta build.

Chrome, Edge and some antivirus tools may also flag the download for the same
reason — an unsigned executable that few people have downloaded.

## Two files, pick one

| File | Use it when |
| --- | --- |
| `LiberCast-0.9.0-beta.1-setup.exe` | Normal install: Start-menu entry, desktop shortcut, shows up in Add/Remove Programs. Installs for your user only, so it does not ask for an administrator. |
| `LiberCast-0.9.0-beta.1-portable.exe` | You want to try it without installing anything. Runs from wherever you put it. Still writes its settings to `%APPDATA%\LiberCast`. |

The installer shows a short beta notice you have to accept. It is worth the
thirty seconds: it says what the application does and does not do, and that the
bundled ffmpeg is under a different licence from LiberCast itself.

## First run

1. **Add a source.** Xtream Codes needs the panel URL, username and password.
   M3U needs a URL or a file.
2. **Sync it.** Channels, films and series are downloaded once and kept
   locally. On a big list this takes a minute or two.
3. **Refresh the guide** if your provider offers one. Optional, but it fills in
   what is on now and lets you schedule recordings.

## Please watch for

- **Playback that works in another player but not here.** The most useful kind
  of report. Say which channel or film, and attach the log.
- **Anything about connections.** Most accounts allow only one or two streams
  at once. If a stream refuses to start while something else is playing, that
  is usually the limit rather than a bug — but multi-view opens one connection
  per tile, so it will hit the limit deliberately.
- **Subtitles**, which have been the most troublesome part of this
  application. Both embedded tracks and a dragged-in `.srt`.
- **Recording and downloads**, which run ffmpeg directly and are the least
  exercised paths.

## Sending a bug report

Open **Settings → About → Show log file**. That opens
`%APPDATA%\LiberCast\logs\` with `libercast.log` selected. Attach it.

Provider usernames and passwords are stripped out before anything is written,
including the ones inside stream URLs, so the file is safe to send. It is worth
a glance before you do, all the same.

Say what you did, what you expected, and what happened. A channel name and a
timestamp are enough to find the right part of the log.

## Where your data lives

Everything is under `%APPDATA%\LiberCast`:

- `libercast.db` — channels, guide data, favourites, watch history
- `settings.json` — preferences
- `logs\` — the log file and one previous copy

Provider passwords are encrypted with your Windows account, so the database is
not readable if copied to another machine.

Uninstalling **leaves that folder alone** on purpose, so reinstalling a newer
beta keeps your sources. To remove everything, uninstall and then delete the
folder.

## Known gaps in this beta

- No auto-update. New betas arrive as a new installer.
- Stalker/MAC portals are not implemented. Xtream Codes and M3U only.
- No code signing, hence the warning above.
- Parts of Settings and the add-source dialog are English only, even with the
  interface set to Turkish or German.

## Building it yourself

```sh
npm ci
npm test
npm run pack:win
```

The installer and the portable build land in `release/`. `npm run pack:win:dir`
skips making the installer and just produces `release/win-unpacked/`, which is
quicker when you only want to check that the packaged application starts.

Building has to happen on Windows: the packaged application contains
`better-sqlite3`, a native module that must be compiled for the platform it
will run on.
