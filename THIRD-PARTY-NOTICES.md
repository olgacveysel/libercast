# Third-party notices

LiberCast's own source code is under the MIT licence (see `LICENSE`). The
installer also carries other people's software, some of it under different
terms. This file lists what ships and what those terms require.

## ffmpeg and ffprobe — GNU General Public License v3 or later

LiberCast cannot play most IPTV streams without ffmpeg: the browser engine it
is built on cannot demux MPEG-TS, so every stream is remuxed on the way
through. ffmpeg also does the recording and the downloads.

The binaries are fetched at install time by the
[`ffmpeg-static`](https://github.com/eugeneware/ffmpeg-static) and
[`ffprobe-static`](https://github.com/joshwnj/node-ffprobe-static) npm
packages. The wrapper packages are MIT; **the ffmpeg and ffprobe executables
they download are not.** `ffmpeg-static` declares
`GPL-3.0-or-later`, and the licence text shipped beside the binary is the GNU
GPL version 3.

This matters when you hand the installer to someone else. Distributing a
GPL-3 binary is allowed, and it does not change LiberCast's own licence, but it
does put two obligations on whoever distributes it:

1. **The licence text must accompany the distribution.** It does: the full GPL
   is installed as `licenses/ffmpeg-GPL-3.0.txt`, and the build manifest of the
   exact binary — its version and the libraries compiled into it — as
   `licenses/ffmpeg-build.txt`.
2. **The corresponding source must be available.** ffmpeg's source for any
   version is at <https://ffmpeg.org/download.html> and
   <https://git.ffmpeg.org/ffmpeg.git>; the exact build and the script that
   produced it are on the `ffmpeg-static` releases page linked above. Anyone
   who received a LiberCast installer from the author can also request that
   source from the author directly.

If you would rather distribute nothing under the GPL, LiberCast already looks
for `ffmpeg` and `ffprobe` on the system `PATH` before falling back to the
bundled copies — so a build with those two packages removed from
`package.json` still works for anyone who installs ffmpeg themselves. That
trade is discussed in `docs/BETA-TESTING.md`.

## Everything else

All MIT licensed, and all either the framework LiberCast is built on or a
library it calls:

| Package | Licence | What it does here |
| --- | --- | --- |
| Electron | MIT | The application shell and the browser engine that draws the window. |
| React | MIT | The interface. |
| better-sqlite3 | MIT | The local database holding channels, guide data and settings. |
| zustand | MIT | Interface state. |
| electron-vite, electron-builder, esbuild, TypeScript, Vite | MIT | Build tools. Not shipped in the installer. |

Electron itself bundles Chromium and Node.js, which carry their own notices —
Chromium's are in `LICENSES.chromium.html` in the installation folder, put
there by Electron.

## Fonts and artwork

The interface uses fonts already present on Windows (Segoe UI and its
variants) and does not ship any font files. The LiberCast mark, wordmark and
icons in `resources/` were drawn for this project and are covered by
`LICENSE` along with the rest of it.
