# Spec: Node.js CLI for extracting Sierra AGI resources

## Overview

Build a Node.js command line tool that reads Sierra AGI game resource files from a directory and extracts resources as raw binary files.

By default the tool does not decode resource payloads. It locates resources through AGI directory/index files and copies the resource payload bytes out of the corresponding VOL files.

The exception is graphics. A PICTURE is a list of vector drawing commands and a VIEW is a set of run-length encoded sprite frames, so neither is of much use as raw bytes. When `--png` is passed, both are decoded and rendered to PNG instead. LOGIC and SOUND payloads are never decoded.

Primary target:

- Sierra AGI v2-style resource layout
- Separate directory files:
  - `LOGDIR`
  - `PICDIR`
  - `VIEWDIR`
  - `SNDDIR`
- Volume files:
  - `VOL.0`
  - `VOL.1`
  - `VOL.2`
  - etc.

The input directory can be passed explicitly. If omitted, the current working directory is used.

## Goals

- Extract a single AGI resource as a binary file.
- Extract all resources of one type.
- Extract all resources of all supported types.
- Validate VOL resource headers before extraction.
- Preserve the raw resource payload exactly as stored after the VOL header.
- Produce predictable file names suitable for later decoding tools.
- Optionally render PICTURE resources to PNG by interpreting their drawing commands.
- Optionally render VIEW resources to PNG, one image per cel plus an animated PNG per loop.

## Non-goals

- No decompilation of LOGIC scripts.
- No conversion of SOUND resources to WAV/MIDI.
- No game-specific patching.
- No support required for SCI games.

## File Model

The tool assumes the AGI game files are present in one directory.

Example input directory:

```text
game/
  LOGDIR
  PICDIR
  VIEWDIR
  SNDDIR
  VOL.0
  VOL.1
  VOL.2
```

File names should be matched case-insensitively, because files from old DOS releases may appear as uppercase, lowercase, or mixed case depending on the filesystem/source.

Required directory files:

```text
LOGDIR
PICDIR
VIEWDIR
SNDDIR
```

Required volume files:

```text
VOL.n
```

Only volume files referenced by directory entries need to exist.

## Supported Resource Types

Use these canonical type names:

```text
logic
pic
view
sound
```

Map each type to its directory file:

```text
logic -> LOGDIR
pic   -> PICDIR
view  -> VIEWDIR
sound -> SNDDIR
```

Map each extracted resource to an extension:

```text
logic -> .logic
pic   -> .pic
view  -> .view
sound -> .sound
```

## AGI v2 Directory Entry Format

Each directory file is a sequence of 3-byte entries.

Each resource number is implied by its index in the directory file:

```text
entry 0 -> resource 0
entry 1 -> resource 1
entry 2 -> resource 2
...
```

Each 3-byte entry is packed like this:

```text
byte 0: high nibble = volume number
        low nibble  = offset bits 16-19

byte 1: offset bits 8-15
byte 2: offset bits 0-7
```

Parsing:

```js
const volume = entry[0] >> 4;
const offset = ((entry[0] & 0x0f) << 16) | (entry[1] << 8) | entry[2];
```

The missing-resource marker is:

```text
FF FF FF
```

Such entries must be skipped during bulk extraction.

## AGI v2 VOL Resource Header

At the offset from the directory entry, the corresponding `VOL.n` file contains a resource header.

For AGI v2:

```text
byte 0: 0x12
byte 1: 0x34
byte 2: volume number
byte 3: payload length low byte
byte 4: payload length high byte
```

Payload length is little-endian:

```js
const payloadLength = header[3] | (header[4] << 8);
```

Payload begins immediately after the 5-byte header:

```text
payloadOffset = resourceOffset + 5
```

The extracted output file should contain only the payload bytes, not the 5-byte VOL header.

## CLI Name

Recommended package binary name:

```text
agi-extract
```

## CLI Commands

### Extract One Resource

```bash
agi-extract one <type> <number> [options]
```

Example:

```bash
agi-extract one view 12 --input ./lsl1 --output ./out
```

This extracts:

```text
./out/view/view.012.view
```

With `--png`, a PICTURE is rendered instead of copied:

```bash
agi-extract one pic 3 --png --input ./lsl1 --output ./out
```

```text
./out/pic/pic.003.png
```

A VIEW renders to several files, one per cel plus an animation per loop:

```bash
agi-extract one view 0 --png --input ./lsl1 --output ./out
```

```text
./out/view/view.000.loop00.cel00.png
./out/view/view.000.loop00.cel01.png
./out/view/view.000.loop00.anim.png
```

Arguments:

```text
type    one of: logic, pic, view, sound
number  decimal resource number, usually 0-255
```

Options:

```text
-i, --input <dir>     input directory containing AGI files, default "."
-o, --output <dir>    output directory, default "./extracted"
--include-header      write VOL header + payload instead of payload only
--png                 render PICTURE and VIEW resources to PNG instead of raw data
--png-scale <n>       extra whole-number scale for --png output, default 1
--view-fps <n>        frame rate of rendered VIEW animations, default 10
--force               overwrite existing files
--json                emit machine-readable JSON result
```

### Extract All Resources of One Type

```bash
agi-extract type <type> [options]
```

Example:

```bash
agi-extract type pic --input ./lsl1 --output ./out
```

This extracts every present PIC resource:

```text
./out/pic/pic.000.pic
./out/pic/pic.001.pic
./out/pic/pic.002.pic
...
```

Options:

```text
-i, --input <dir>
-o, --output <dir>
--include-header
--png
--png-scale <n>
--view-fps <n>
--force
--json
```

### Extract Everything

```bash
agi-extract all [options]
```

Example:

```bash
agi-extract all --input ./lsl1 --output ./out
```

Output layout:

```text
out/
  logic/
    logic.000.logic
    logic.001.logic
  pic/
    pic.000.pic
  view/
    view.000.view
  sound/
    sound.000.sound
```

Options:

```text
-i, --input <dir>
-o, --output <dir>
--include-header
--png
--png-scale <n>
--view-fps <n>
--force
--json
```

### List Resources

Recommended supporting command:

```bash
agi-extract list [type] [options]
```

Examples:

```bash
agi-extract list --input ./lsl1
agi-extract list view --input ./lsl1
```

Human-readable output:

```text
TYPE   ID   VOL   OFFSET    SIZE
view   0    0     0x00123A  412
view   1    0     0x0013DF  381
pic    0    1     0x000040  1276
```

JSON output:

```json
[
  {
    "type": "view",
    "id": 0,
    "volume": 0,
    "offset": 4666,
    "payloadLength": 412
  }
]
```

## Output File Naming

Use deterministic zero-padded names:

```text
<type>.<resource-number-3-digits>.<extension>
```

Examples:

```text
logic.000.logic
pic.023.pic
view.012.view
sound.004.sound
```

The default output directory should group files by resource type:

```text
<output>/<type>/<type>.<id>.<extension>
```

A PICTURE rendered with `--png` uses the `.png` extension in place of `.pic`,
and is written to the same `pic/` directory:

```text
out/
  pic/
    pic.000.png
    pic.001.png
```

A VIEW rendered with `--png` produces several files, named by loop and cel. Both
numbers are zero-padded to two digits so frames sort in order:

```text
<output>/view/<type>.<id>.loop<LL>.cel<CC>.png
<output>/view/<type>.<id>.loop<LL>.anim.png
```

```text
out/
  view/
    view.000.loop00.cel00.png
    view.000.loop00.cel01.png
    view.000.loop00.anim.png
    view.000.loop01.cel00.png
```

## Extraction Behavior

For each requested resource:

1. Resolve input directory.
2. Locate the correct directory file case-insensitively.
3. Read its 3-byte entries.
4. Validate the requested resource number exists in the directory file.
5. Skip or reject `FF FF FF` missing-resource entries.
6. Decode volume number and offset.
7. Locate `VOL.<volume>` case-insensitively.
8. Seek to offset.
9. Read the 5-byte AGI v2 resource header.
10. Validate signature bytes `0x12 0x34`.
11. Validate header volume byte matches the expected volume.
12. Read payload length.
13. Validate payload does not run past end of VOL file.
14. Write payload bytes to output file.

When `--include-header` is passed, write bytes from `resourceOffset` through the end of payload, including the 5-byte header.

When `--png` is passed and the resource type is `pic`, interpret the payload as
described in *PICTURE Rendering* below and write the encoded PNG instead of the
payload bytes.

When `--png` is passed and the resource type is `view`, decode the payload as
described in *VIEW Rendering* below and write one PNG per cel, plus an animated
PNG for each loop holding more than one cel. A view therefore produces several
output files where every other resource produces one.

`--include-header` does not apply to a rendered picture or view, because the
output is an image rather than a slice of the VOL file.

## Validation Rules

The tool should fail with a non-zero exit code when:

- The input directory does not exist.
- The requested directory file is missing.
- The requested resource type is unknown.
- The requested resource number is not numeric.
- The requested resource entry is outside the directory file.
- The requested resource entry is marked missing.
- The referenced VOL file is missing.
- The VOL offset is outside the file.
- The 5-byte resource header cannot be read.
- The resource signature is not `0x12 0x34`.
- The header volume byte does not match the VOL file number.
- The declared payload length exceeds the VOL file bounds.
- The output file already exists and `--force` was not passed.
- A PICTURE cannot be rendered to PNG when `--png` was passed.
- A VIEW cannot be rendered when `--png` was passed, including when it holds no cels at all.

During bulk extraction, default behavior should be:

- skip missing directory entries
- continue after individual extraction failures
- print/report failures at the end
- return exit code `1` if any requested resource failed

Optional strict mode:

```text
--strict
```

In strict mode, bulk extraction stops on the first failure.

## JSON Result Format

For successful single extraction:

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

A PICTURE rendered with `--png` carries three extra fields. `payloadLength`
continues to report the size of the source vector data, not the size of the PNG:

```json
{
  "ok": true,
  "resources": [
    {
      "type": "pic",
      "id": 3,
      "volume": 0,
      "offset": 4096,
      "payloadLength": 900,
      "outputPath": "/absolute/path/out/pic/pic.003.png",
      "includedHeader": false,
      "format": "png",
      "width": 320,
      "height": 168
    }
  ],
  "errors": []
}
```

A VIEW rendered with `--png` produces several files, so it reports them all plus
a summary per loop. `outputPath` is the first frame written, and `description`
appears only when the view carries one:

```json
{
  "ok": true,
  "resources": [
    {
      "type": "view",
      "id": 0,
      "volume": 0,
      "offset": 25393,
      "payloadLength": 2883,
      "outputPath": "/absolute/path/out/view/view.000.loop00.cel00.png",
      "includedHeader": false,
      "format": "png",
      "files": [
        "/absolute/path/out/view/view.000.loop00.cel00.png",
        "/absolute/path/out/view/view.000.loop00.anim.png"
      ],
      "loops": [
        {
          "loop": 0,
          "cels": 8,
          "width": 14,
          "height": 33,
          "animationPath": "/absolute/path/out/view/view.000.loop00.anim.png"
        }
      ],
      "description": "Your wallet contains some wrinkled business cards..."
    }
  ],
  "errors": []
}
```

For partial bulk failure:

```json
{
  "ok": false,
  "resources": [
    {
      "type": "pic",
      "id": 0,
      "volume": 0,
      "offset": 4096,
      "payloadLength": 900,
      "outputPath": "/absolute/path/out/pic/pic.000.pic",
      "includedHeader": false
    }
  ],
  "errors": [
    {
      "type": "view",
      "id": 14,
      "code": "INVALID_VOL_SIGNATURE",
      "message": "Expected 0x12 0x34 at VOL.0 offset 1234."
    }
  ]
}
```

## Error Codes

Recommended stable error codes:

```text
INPUT_DIR_NOT_FOUND
DIR_FILE_NOT_FOUND
UNKNOWN_RESOURCE_TYPE
INVALID_RESOURCE_ID
RESOURCE_ID_OUT_OF_RANGE
RESOURCE_MISSING
VOL_FILE_NOT_FOUND
VOL_OFFSET_OUT_OF_RANGE
VOL_HEADER_TRUNCATED
INVALID_VOL_SIGNATURE
VOL_NUMBER_MISMATCH
PAYLOAD_OUT_OF_RANGE
OUTPUT_EXISTS
WRITE_FAILED
PIC_RENDER_FAILED
VIEW_RENDER_FAILED
```

## PICTURE Rendering

Only applies when `--png` is passed. A PICTURE resource is a stream of vector
drawing commands replayed onto two 160x168 screens: the *visual* screen the
player sees, and the *priority* screen the interpreter uses for depth and
control lines. The visual screen is what gets encoded as PNG.

The format and algorithms are specified by the AGI Specifications, chapter 7.

### Screens

```text
width           160 pixels
height          168 pixels
visual screen   starts filled with white (colour 15)
priority screen starts filled with red (colour 4)
```

The 16 EGA colours are used, with the 6-bit values of the specification scaled
to 8 bits: `0x00 0x15 0x2A 0x3F` map onto `0x00 0x55 0xAA 0xFF`.

### Drawing actions

```text
0xF0  change picture colour and enable picture draw   1 argument
0xF1  disable picture draw                            0 arguments
0xF2  change priority colour and enable priority draw 1 argument
0xF3  disable priority draw                           0 arguments
0xF4  draw a Y corner                                 x, y, then y1, x1, y2, ...
0xF5  draw an X corner                                x, y, then x1, y1, x2, ...
0xF6  absolute line                                   x, y, then x1, y1, x2, ...
0xF7  relative line                                   x, y, then packed SXXXSYYY
0xF8  fill                                            pairs of x, y
0xF9  change pen size and style                       1 argument
0xFA  plot with pen                                   x, y pairs, or texture, x, y
0xFB-0xFE  unused; skip the action and its arguments
0xFF  end of picture data
```

A relative line displacement byte packs a sign bit and a 3-bit magnitude per
axis, giving a range of -7 to +7:

```text
+---+-----------+---+-----------+
| S |   Xdisp   | S |   Ydisp   |
| 7 | 6 | 5 | 4 | 3 | 2 | 1 | 0 |
+---+---+---+---+---+---+---+---+
```

### Line drawing

The line routine must match Sierra's rounding exactly. A pixel out of place
opens a gap that a later flood fill escapes through, flooding the whole picture,
so an ordinary Bresenham line is not a valid substitute.

```js
function round(value, direction) {
  const frac = value - Math.floor(value);
  if (direction < 0) return frac <= 0.501 ? Math.floor(value) : Math.ceil(value);
  return frac < 0.499 ? Math.floor(value) : Math.ceil(value);
}
```

The line is then walked along its major axis, stepping the minor axis by a
fractional increment and rounding each coordinate in the direction of travel.

### Flood filling

Queue-based, four-connected, spreading across the background colour and stopping
at any pixel that is not that colour:

```text
picture draw enabled    spread across white on the visual screen
priority draw only      spread across red on the priority screen
both enabled            spread across white on the visual screen, so the
                        priority fill also stops at boundaries that exist
                        only on the visual screen
```

Filling white onto white with no priority screen to update is a no-op and can be
skipped. An implementation must not revisit pixels, so that a fill terminates
regardless of the colour it paints.

### Pens

A pen of size `n` covers a box `n + 1` wide and `2n + 1` tall, narrow
horizontally because AGI pixels are twice as wide as they are tall. The plotted
coordinate sits at the centre row and `ceil(n / 2)` in from the left edge.

```text
bits 0-2   size, 0 to 7
bit 4      0 = circle, 1 = rectangle
bit 5      0 = solid, 1 = splatter
```

Rectangles fill the whole box. Circles use the bitmaps from the CIRCLE SIZES
diagram of the specification, packed row-major, one bit per pixel, MSB first:

```text
size 0   [0x80]
size 1   [0xfc]
size 2   [0x5f, 0xf4]
size 3   [0x66, 0xff, 0xf6, 0x60]
size 4   [0x23, 0xbf, 0xff, 0xff, 0xee, 0x20]
size 5   [0x31, 0xe7, 0x9e, 0xff, 0xff, 0xde, 0x79, 0xe3, 0x00]
size 6   [0x38, 0xf9, 0xf3, 0xef, 0xff, 0xff, 0xff, 0xfe, 0xf9, 0xf3, 0xe3, 0x80]
size 7   [0x18, 0x3c, 0x7e, 0x7e, 0x7e, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7e, 0x7e,
          0x7e, 0x3c, 0x18]
```

A splatter pen takes a texture number as its first argument per point. Bits 1-7
give the texture, bit 0 is ignored, which yields 120 usable patterns. The texture
number indexes a table of starting bit positions into 32 bytes of texture data;
both tables are given in the specification.

Texture bits are consumed **only at positions that are part of the shape**, so a
circle uses the same bit sequence a rectangle would but skips the corners it does
not cover. The bit position wraps at 255 back to 0, not at 256.

### Output image

```text
default size    320x168, i.e. 2x horizontally to correct the pixel aspect
--png-scale n   multiplies both axes on top of that; n must be >= 1
scaling         whole-pixel replication, never interpolation
encoding        8-bit palette-indexed PNG with the 16 EGA colours
```

### Damaged data

A PICTURE whose command stream is truncated or malformed should render whatever
was drawn before the damage rather than failing, so a partially corrupt resource
still yields a usable image. `PIC_RENDER_FAILED` is reserved for a genuine
failure to produce a PNG.

## VIEW Rendering

Only applies when `--png` is passed. A VIEW holds the game's sprites: one or more
loops, each a sequence of cels (frames), stored as run-length encoded bitmaps.
Several loops can share one set of cels through mirroring.

The format is specified by the AGI Specifications, chapter 8.

### View header

```text
byte 0    unknown (1 or 2)
byte 1    unknown (1)
byte 2    number of loops
byte 3-4  position of the description, 0 if there is none
byte 5-6  position of loop 0, relative to the start of the resource
byte 7-8  position of loop 1, and so on
```

Two loop entries may point at the same position. That is how mirroring is stored.

### Loop header

```text
byte 0    number of cels in this loop
byte 1-2  position of cel 0, relative to the start of the LOOP
byte 3-4  position of cel 1, and so on
```

Cel positions are relative to the loop, not to the resource.

### Cel header and pixel data

```text
byte 0    width in AGI pixels
byte 1    height
byte 2    bit 7     mirror flag
          bits 6-4  the loop these pixels are drawn for
          bits 3-0  transparent colour
```

Pixels follow as run-length encoded lines. Each byte holds a colour in its high
nibble and a run length in its low nibble; `0x00` ends the line. A line may end
before the full width, and the remainder of the row is transparent — this is how
the format avoids storing trailing holes.

### Mirroring

A cel with the mirror flag set is stored the right way round for exactly one
loop, given by bits 6-4. When the same cel appears in any other loop it must be
flipped horizontally before drawing. This is what lets a game store a character
walking left and right as a single set of frames.

### Transparency

Every cel names a transparent colour, and pixels of that colour are holes rather
than paint. A cel's transparent colour varies from cel to cel, so rendering maps
all of them onto a single dedicated palette entry (index 16, past the 16 EGA
colours) and marks that entry fully transparent with a PNG `tRNS` chunk.

### Output images

```text
one PNG per cel        at that cel's own size
one APNG per loop      only when the loop holds more than one cel
default size           2x horizontally, correcting the pixel aspect as for pictures
--png-scale n          multiplies both axes on top of that
--view-fps n           animation frame rate, default 10
```

An animation needs one canvas for every frame, so it uses the largest cel in the
loop and anchors each frame at the bottom-left — the corner AGI positions a view
by — which keeps a walk cycle standing on one spot instead of drifting.

AGI stores no frame rate: cycling speed is decided by the game's LOGIC at run
time, so the rendered frame rate is a presentation choice, not data recovered
from the resource.

### Animated PNG structure

```text
IHDR, acTL, PLTE, tRNS, then per frame: fcTL, and IDAT for the first
frame or fdAT for every later one, then IEND
```

Frame and data chunks share one sequence counter that increments by one per
chunk. Every frame covers the whole canvas and uses blend operation *source*, so
transparent regions stay transparent rather than smearing earlier frames through
them. Viewers without APNG support fall back to the first frame.

### Damaged data

Loop or cel offsets that fall outside the payload are skipped, so a damaged view
still yields the frames that survived. `VIEW_RENDER_FAILED` is reported when
nothing at all could be rendered.

## Implementation Structure

Recommended source layout:

```text
src/
  cli.js
  agi/
    files.js
    directory.js
    volume.js
    volume-file.js
    pic.js
    view.js
    extract.js
  util/
    errors.js
    format.js
    png.js
test/
  helpers.js
  directory.test.js
  volume.test.js
  pic.test.js
  view.test.js
  extract.test.js
```

The VOL layer is two modules rather than one. `volume.js` holds the header
format and nothing else, so it can be imported by a browser bundle;
`volume-file.js` holds everything that touches the filesystem.

### `files.js`

Responsibilities:

- resolve input/output paths
- perform case-insensitive file lookup
- find `VOL.n` files

### `directory.js`

Responsibilities:

- parse 3-byte AGI v2 directory entries
- identify missing entries
- return resource location records

Return shape:

```js
{
  id: 12,
  present: true,
  volume: 0,
  offset: 123456
}
```

### `volume.js`

Responsibilities:

- parse and validate an AGI v2 VOL header already in a buffer
- no filesystem access, so the module is usable in a browser

### `volume-file.js`

Responsibilities:

- open VOL files and check offsets against their length
- read a resource, returning the payload buffer and metadata
- keep one handle per volume open across a bulk extraction

Return shape:

```js
{
  volume: 0,
  offset: 123456,
  headerLength: 5,
  payloadLength: 789,
  payload: Buffer
}
```

### `pic.js`

Responsibilities:

- interpret PICTURE drawing actions
- maintain the visual and priority screens
- implement Sierra's line, fill and pen routines

Return shape:

```js
{
  visual: Uint8Array,   // 160 * 168, one EGA colour index per pixel
  priority: Uint8Array  // 160 * 168, one priority value per pixel
}
```

### `view.js`

Responsibilities:

- parse the view, loop and cel headers
- decode run-length encoded cel pixels
- resolve mirroring and transparency

Return shape:

```js
{
  loops: [
    {
      loop: 0,
      cels: [
        { width, height, transparent, mirrored, sourceLoop, pixels: Uint8Array }
      ]
    }
  ],
  description: 'text or null'
}
```

### `png.js`

Responsibilities:

- encode an 8-bit palette-indexed PNG, with optional palette transparency
- encode an animated PNG from a sequence of frames
- scale a paletted image by whole-pixel replication

### `extract.js`

Responsibilities:

- coordinate directory parsing and VOL reading
- render PICTURE and VIEW resources to PNG when `--png` is passed
- create output directories
- write resource files
- collect results and errors

### `cli.js`

Responsibilities:

- parse CLI args
- dispatch commands
- format human-readable or JSON output
- set process exit code

## Suggested Dependencies

Use minimal dependencies:

```text
commander or yargs  CLI argument parsing
node:test           tests
node:fs/promises    file IO
node:path           path handling
```

No binary parsing dependency is necessary; Node `Buffer` is sufficient.

No image library is necessary either. `node:zlib` provides the deflate needed
for PNG encoding, and the remaining chunk framing and CRC-32 are short enough to
implement directly.

## Test Cases

### Directory parsing

- Parses volume number from high nibble.
- Parses 20-bit offset from low nibble + next two bytes.
- Marks `FF FF FF` as missing.
- Rejects directory files whose length is not divisible by 3, or warns depending on chosen policy.

### VOL parsing

- Accepts valid `12 34` signature.
- Rejects invalid signature.
- Rejects mismatched volume byte.
- Reads little-endian payload length.
- Rejects payload length past end of file.

### Extraction

- Extracts one known resource.
- Extracts all resources of one type.
- Extracts all supported resource types.
- Does not overwrite existing output without `--force`.
- Writes header when `--include-header` is used.
- Skips missing resources during bulk extraction.
- Returns non-zero exit code on partial failure.

### PICTURE rendering

- Both screens start white and red.
- Nothing is drawn until a colour enables a screen.
- Rounds line coordinates in the direction of travel.
- Draws absolute lines, relative lines, and X and Y corners.
- Fills a bounded region and stops at its boundary.
- Leaks through a one-pixel gap in a boundary, confirming the fill is not
  silently constrained.
- Fills the priority screen across red when only priority drawing is enabled.
- Stops a combined fill at a boundary that exists only on the visual screen.
- Plots solid circle and rectangle pens of the documented shape.
- Consumes splatter texture bits only inside the shape.
- Stops interpreting at the end marker, and survives a truncated stream.

### PNG encoding

- Encodes an indexed PNG that round-trips back to the same pixels.
- Writes a valid signature, IHDR, PLTE and CRC per chunk.
- Scales by whole-pixel replication.
- Renders at 320x168 by default, and `--png-scale n` multiplies both axes.
- Writes `pic.NNN.png` rather than `pic.NNN.pic`, leaving LOGIC and SOUND raw.

### VIEW decoding

- Decodes RLE chunks into colour runs.
- Maps the cel transparent colour onto the transparent index.
- Leaves the rest of a row transparent when a line ends early.
- Clips a run that overruns the row, and leaves missing rows transparent.
- Reads the transparency and mirroring header byte.
- Flips a mirrored cel for every loop except the one it is stored for.
- Reads cel offsets relative to the start of their loop.
- Reads the description, and reports null when there is none.
- Skips loop and cel offsets that fall outside the payload.

### VIEW rendering

- Writes one PNG per cel plus an animation per multi-cel loop.
- Writes no animation for a single-cel loop.
- Sizes each cel PNG from that cel, and the animation canvas from the largest.
- Anchors frames of differing sizes at the bottom left.
- Marks only the transparent palette entry in `tRNS`.
- Emits APNG chunks in order with consecutive sequence numbers.
- Puts the first frame in IDAT and later frames in fdAT.
- Applies `--view-fps` to the frame delay.

## Example Pseudocode

```js
function parseDirEntry(buffer, id) {
  const base = id * 3;
  const a = buffer[base];
  const b = buffer[base + 1];
  const c = buffer[base + 2];

  if (a === 0xff && b === 0xff && c === 0xff) {
    return { id, present: false };
  }

  return {
    id,
    present: true,
    volume: a >> 4,
    offset: ((a & 0x0f) << 16) | (b << 8) | c,
  };
}

function parseVolHeader(buffer, expectedVolume, offset) {
  if (buffer[offset] !== 0x12 || buffer[offset + 1] !== 0x34) {
    throw new Error("INVALID_VOL_SIGNATURE");
  }

  const volume = buffer[offset + 2];
  if (volume !== expectedVolume) {
    throw new Error("VOL_NUMBER_MISMATCH");
  }

  const payloadLength = buffer[offset + 3] | (buffer[offset + 4] << 8);
  return { volume, payloadLength, headerLength: 5 };
}
```

## Future Extensions

Possible later additions:

- AGI v3 support, where resource directory layout and VOL headers can differ.
- Decode LOGIC messages and bytecode.
- Write the PICTURE priority screen as a second PNG.
- Emit a single sprite-sheet image per VIEW loop, alongside the individual frames.
- Convert SOUND resources to a simple audio or tracker-like format.
- Emit a manifest JSON containing every extracted resource and source offset.
