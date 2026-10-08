# Brand assets

Three SVGs are the masters; everything else here is rendered from them.

| File | What it is |
| --- | --- |
| `icon.svg` | The mark on its tile, with the folds. The app icon at 48px and up. |
| `icon-small.svg` | The same silhouette with the folds closed, for 16–32px. |
| `mark.svg` | The mark alone, no tile, for dark backgrounds. |
| `icon.png` | 1024px render of `icon.svg`. |
| `icon.ico` | What electron-builder ships: 16, 24, 32, 48, 64, 128, 256. |
| `wordmark.png` | Mark plus wordmark, for the readme and release pages. |

The `.ico` deliberately mixes the two drawings — the three smallest entries
come from `icon-small.svg`. Windows picks an entry by size, so the taskbar and
the Alt-Tab switcher get a drawing made for the size they render at rather than
a shrunk version of the detailed one.

## Where the geometry came from

The mark was supplied as a PNG of flat, hard-edged facets separated by
transparent gaps. Rather than redraw it by eye, the vector was traced from that
file's alpha channel, so the facets are the designer's own:

1. Threshold the alpha to a bitmap.
2. Pad it — the artwork runs to the edge of its canvas, and without a margin of
   empty pixels the traced outline merges with the image border and the whole
   frame comes back as one filled shape with the bird knocked out of it.
3. Trace with corner smoothing off. This is folded-paper geometry; smoothing
   rounds off the facets that give it its character.
4. Fit the result into a 1024 box with an inset that keeps it clear of the
   tile's rounded corners.

`icon-small.svg` is the same pipeline with the bitmap thickened first, which
closes the gaps between facets and leaves a solid silhouette.

The gradient — `#2a5f69` → `#447b77` → `#9bd3bf`, running from the lower left
to the upper right — was averaged out of the artwork along that diagonal rather
than picked by hand.

Both potrace and a renderer are needed to redo this. Note that `potracer`
treats the **false** cells as ink, the opposite of the obvious convention: hand
it the mask the right way up and you get the canvas with the bird cut out of
it.

## Regenerating the raster files

```sh
python3 - <<'PY'
import cairosvg
for size in (16, 24, 32):
    cairosvg.svg2png(url='icon-small.svg', write_to=f'/tmp/i{size}.png',
                     output_width=size, output_height=size)
for size in (48, 64, 128, 256):
    cairosvg.svg2png(url='icon.svg', write_to=f'/tmp/i{size}.png',
                     output_width=size, output_height=size)
cairosvg.svg2png(url='icon.svg', write_to='icon.png',
                 output_width=1024, output_height=1024)
PY
convert /tmp/i16.png /tmp/i24.png /tmp/i32.png /tmp/i48.png \
        /tmp/i64.png /tmp/i128.png /tmp/i256.png icon.ico
```

Pillow cannot write a multi-image `.ico` from separate drawings — it re-scales
one image — so the last step needs ImageMagick or an equivalent.

## The interface copy

`src/renderer/src/ui/Mark.tsx` holds the same two paths inline, so the title
bar can draw the mark at any size. A change to the shape has to be made there
as well as here. It needs `fillRule="evenodd"`: the gaps between facets are
holes in a single path, and without that rule the bird fills in solid.
