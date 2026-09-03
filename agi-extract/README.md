# agi-extract

A Node.js command line tool that extracts Sierra AGI game resources as **raw binary files**.

It locates resources through the AGI directory/index files and copies the payload
bytes out of the corresponding `VOL` files, written exactly as stored after the
VOL resource header, ready for a separate decoding tool.

Graphics can optionally be **rendered to PNG** with `--png`: PICTURE resources by
replaying their vector drawing commands, and VIEW resources by decoding their
sprite frames — one PNG per frame, plus an animated PNG per loop. LOGIC and SOUND
payloads are never decoded.

Targets the AGI v2 resource layout: separate `LOGDIR` / `PICDIR` / `VIEWDIR` /
`SNDDIR` directory files plus `VOL.0`, `VOL.1`, … volume files. File names are
matched case-insensitively, so uppercase, lowercase and mixed-case dumps all work.

## Install

```sh
npm install -g agi-extract
# or run it in place
node bin/agi-extract.js --help
```

Requires Node.js 18 or newer. No runtime dependencies.

## Commands

```text
agi-extract one <type> <number> [options]   extract a single resource
agi-extract type <type> [options]           extract every resource of one type
agi-extract all [options]                   extract every supported type
agi-extract list [type] [options]           list resources without extracting
```

`<type>` is one of `logic`, `pic`, `view`, `sound`.

### Options

```text
-i, --input <dir>     input directory containing AGI files, default "."
-o, --output <dir>    output directory, default "./extracted"
    --include-header  write VOL header + payload instead of payload only
    --png             render PICTURE and VIEW resources to PNG instead of raw data
    --png-scale <n>   extra whole-number scale for --png output, default 1
    --view-fps <n>    frame rate of rendered VIEW animations, default 10
    --force           overwrite existing files
    --strict          stop bulk extraction at the first failure
    --json            emit machine-readable JSON result
-h, --help            show help
-V, --version         show version
```

### Examples

```sh
agi-extract one view 12 --input ./lsl1 --output ./out   # -> ./out/view/view.012.view
agi-extract type pic --input ./lsl1 --output ./out
agi-extract all --input ./lsl1 --output ./out
agi-extract list view --input ./lsl1
agi-extract type pic --png --input ./lsl1 --output ./out    # -> ./out/pic/pic.000.png
agi-extract all --png --png-scale 2 --input ./lsl1 --output ./out
agi-extract one view 12 --png --input ./lsl1 --output ./out
```

`list` prints a table, with `SIZE` read from each resource's VOL header:

```text
TYPE   ID   VOL   OFFSET    SIZE
view   0    0     0x00123A  412
view   1    0     0x0013DF  381
pic    0    1     0x000040  1276
```

## Output file naming

Deterministic, zero-padded, grouped by resource type:

```text
<output>/<type>/<type>.<3-digit id><extension>
```

```text
out/
  logic/logic.000.logic
  logic/logic.001.logic
  pic/pic.000.pic
  view/view.012.view
  sound/sound.004.sound
```

## Rendering pictures to PNG

A PICTURE resource is a list of drawing commands, not an image. With `--png`
those commands are replayed onto a 160x168 screen and the result is written as an
8-bit palette-indexed PNG using the 16 EGA colours, named `pic.000.png` instead of
`pic.000.pic`. Other resource types are unaffected and still extract as raw bytes.

An AGI pixel is twice as wide as it is tall, so output is 2x horizontally by
default — **320x168**, the aspect players actually saw. `--png-scale <n>`
multiplies both axes on top of that, so `--png-scale 2` gives 640x336. Scaling
replicates whole pixels, keeping the image sharp rather than blurred.

The interpreter implements the full AGI v2 command set: absolute and relative
lines, X and Y corners, flood fill, and both solid and splatter pens in circle and
rectangle shapes. It follows the AGI Specifications chapter 7 algorithms,
including Sierra's exact line rounding — an ordinary Bresenham line puts pixels a
place or two differently, which opens gaps that later fills escape through and
floods the whole picture.

Two notes on behaviour:

- `--include-header` does not apply to a rendered picture, since the output is an
  image rather than a slice of the VOL file. `includedHeader` is `false` for it.
- A picture whose data is damaged renders whatever was drawn before the damage
  rather than failing, so a partially corrupt resource still yields something
  useful. `payloadLength` continues to report the size of the source vectors.

The priority screen is also produced by the interpreter and available through the
library API (`decodePicture(...).priority`), though the CLI writes only the visual
screen.

## Rendering views to PNG

A VIEW holds the game's sprites: one or more *loops* (animations, typically one
per facing direction), each a sequence of *cels* (frames). With `--png` a view is
written as one PNG per cel, plus an animated PNG for every loop with more than
one cel:

```text
out/view/
  view.000.loop00.cel00.png
  view.000.loop00.cel01.png
  ...
  view.000.loop00.anim.png    <- APNG, loops forever
  view.000.loop01.cel00.png
  ...
```

Loop and cel numbers are zero-padded to two digits so the frames sort in order.
A loop with a single cel gets no animation, since there is nothing to animate.

**Transparency** is preserved. Each cel declares a transparent colour; those
pixels become genuinely transparent in the PNG via a `tRNS` chunk, so sprites
composite onto any background instead of carrying a coloured box around.

**Mirroring** is resolved. AGI stores a character walking left and right as one
set of cels shared by two loops, with a flag saying which loop they are drawn
for. Frames belonging to the other loop are flipped horizontally on the way out,
so both directions render correctly.

**Frame size.** Each cel PNG is the size of that cel. An animation needs one
canvas for all its frames, so it uses the largest cel in the loop and anchors
every frame at the bottom-left — the corner AGI positions a view by — which keeps
a walk cycle standing in one spot rather than bobbing.

**Speed.** AGI stores no frame rate; cycling speed is decided by the game's LOGIC
at run time. Rendered animations therefore default to 10 fps, adjustable with
`--view-fps <n>`.

The animation is a standard APNG. Viewers that do not support APNG show the first
frame, which is a reasonable still of the sprite.

## JSON output

`--json` on `one`, `type` and `all` emits the result envelope:

```json
{
  "ok": true,
  "resources": [
    {
      "type": "view",
      "id": 12,
      "volume": 0,
      "offset": 123456,
      "payloadLength": 789,
      "outputPath": "/absolute/path/out/view/view.012.view",
      "includedHeader": false
    }
  ],
  "errors": []
}
```

`payloadLength` is always the length declared in the VOL header. With
`--include-header` the file on disk is 5 bytes longer, and `includedHeader` is `true`.

A picture rendered with `--png` carries three extra fields:

```json
{ "format": "png", "width": 320, "height": 168 }
```

A view rendered with `--png` instead reports every file it produced, and a
summary per loop. `outputPath` is the first frame, and `payloadLength` remains the
size of the source VIEW data:

```json
{
  "type": "view",
  "id": 0,
  "payloadLength": 2883,
  "outputPath": "/abs/out/view/view.000.loop00.cel00.png",
  "includedHeader": false,
  "format": "png",
  "files": ["/abs/out/view/view.000.loop00.cel00.png", "..."],
  "loops": [
    {
      "loop": 0,
      "cels": 8,
      "width": 14,
      "height": 33,
      "animationPath": "/abs/out/view/view.000.loop00.anim.png"
    }
  ],
  "description": "Your wallet contains some wrinkled business cards..."
}
```

`description` appears only for views that carry one — AGI stores descriptive text
on inventory close-ups.

`list --json` emits a bare array instead:

```json
[{ "type": "view", "id": 0, "volume": 0, "offset": 4666, "payloadLength": 412 }]
```

## Exit codes and errors

| Code | Meaning |
| ---- | ------- |
| `0`  | Everything requested succeeded |
| `1`  | One or more resources failed (each carries a stable error code) |
| `2`  | Malformed command line (unknown command, missing operands) |

During bulk extraction the default is to skip missing directory entries, continue
past individual failures, report them at the end and exit `1`. `--strict` stops at
the first failure instead.

Stable error codes:

```text
INPUT_DIR_NOT_FOUND      DIR_FILE_NOT_FOUND       UNKNOWN_RESOURCE_TYPE
INVALID_RESOURCE_ID      RESOURCE_ID_OUT_OF_RANGE RESOURCE_MISSING
VOL_FILE_NOT_FOUND       VOL_OFFSET_OUT_OF_RANGE  VOL_HEADER_TRUNCATED
INVALID_VOL_SIGNATURE    VOL_NUMBER_MISMATCH      PAYLOAD_OUT_OF_RANGE
OUTPUT_EXISTS            WRITE_FAILED
```

`PIC_RENDER_FAILED` and `VIEW_RENDER_FAILED` are additional codes beyond the
specified set, reported when a picture or view cannot be rendered to PNG.

A directory file whose length is not a multiple of 3 produces a warning on stderr;
the trailing bytes are ignored and the rest of the file is used.

## Format notes

**Directory entries** are 3 bytes each, and the resource number is the entry's
index in the file:

```text
byte 0: high nibble = volume number, low nibble = offset bits 16-19
byte 1: offset bits 8-15
byte 2: offset bits 0-7
```

`FF FF FF` marks a missing resource.

**VOL resource headers** are 5 bytes, validated before every extraction:

```text
byte 0: 0x12
byte 1: 0x34
byte 2: volume number (must match the directory entry)
byte 3: payload length, low byte
byte 4: payload length, high byte
```

## Source layout

```text
src/
  cli.js            argument parsing, command dispatch, output formatting, exit codes
  agi/
    files.js        path resolution, case-insensitive lookup, VOL.n discovery
    directory.js    3-byte directory entry parsing
    volume.js       VOL header format: parsing and validation, no I/O
    volume-file.js  reading VOL files from disk, and caching the open handles
    pic.js          PICTURE vector interpreter (visual + priority screens)
    view.js         VIEW decoder (RLE cels, loops, mirroring, transparency)
    extract.js      coordination, output directories, result and error collection
  util/
    errors.js       AgiError and the stable error codes
    format.js       human-readable and JSON output
    png.js          indexed PNG and APNG encoders, whole-pixel scaling
test/
  helpers.js        synthetic games and resource fixtures
  directory.test.js
  volume.test.js
  pic.test.js
  view.test.js
  extract.test.js
```

`volume.js` and `volume-file.js` are split on purpose: the header format has to
stay free of Node built-ins so it can be bundled for a browser, which cannot
resolve `node:fs/promises` at all. `web-agi` imports `parseVolHeader` from it and
supplies its own reader.

## Library use

```js
import { Session, extractAll, renderPictureToPng } from 'agi-extract';

const session = await Session.open('./lsl1', { outputDir: './out' });
try {
  const { payload } = await session.readResource('logic', 0); // Buffer
  const result = await extractAll(session);
  console.log(result.ok, result.resources.length);
} finally {
  await session.close();
}
```

Decoding a view's sprites directly:

```js
import { decodeView, celPixelsForLoop } from 'agi-extract/view';
import { renderViewToPngs } from 'agi-extract';

const { files, loops, description } = renderViewToPngs(viewPayload, { scale: 2, fps: 12 });
// files: [{ name: 'loop00.cel00.png', data: Buffer, width, height }, ...]

const view = decodeView(viewPayload);
const cel = view.loops[0].cels[0];
celPixelsForLoop(cel, 0); // Uint8Array, 16 = transparent
```

Rendering a picture directly, including the priority screen:

```js
import { decodePicture } from 'agi-extract/pic';
import { renderPictureToPng } from 'agi-extract';

const { data, width, height } = renderPictureToPng(picPayload, { scale: 2 });

const screens = decodePicture(picPayload);
screens.visual;   // Uint8Array(160 * 168), one EGA colour index per pixel
screens.priority; // Uint8Array(160 * 168), one priority value per pixel
```

## Tests

```sh
npm test
```

## Not supported

No LOGIC decompilation, no SOUND→WAV/MIDI conversion, no game-specific patching,
and no SCI games. AGI v3 is a possible future extension; only the v2 layout is
handled today.
