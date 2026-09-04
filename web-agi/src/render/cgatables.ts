/**
 * The CGA tables, read out of the original interpreter's own data.
 *
 * Three of them, in `AGIDATA.OVL` a few bytes below the Hercules table
 * `hgcdither.ts` reads. `CGA_GRAF.OVL` is 1024 bytes of 8086 and it uses all
 * three; what follows is how it uses them, because the layout is not guessable
 * from the bytes alone and this project has twice paid for guessing.
 *
 * ## One nibble per AGI pixel, in both modes
 *
 * AGI keeps its visual screen one byte to a pixel. The driver's entry 4 copies
 * that screen to the card, and it does so by packing *pairs* of bytes into one:
 *
 * ```text
 * lodsw                two pixels of the screen
 * and  ax, 0f0fh       a nibble from each
 * shl  al, 1  (x4)
 * or   al, ah          one byte: the left pixel's nibble, then the right's
 * stosb
 * ...
 * add  dx, 2000h       and the walk is CGA's two interleaved banks,
 * add  di, 3fb0h       80 bytes to a row
 * ```
 *
 * Eighty bytes a row is 320 pixels at four to a byte, or 640 at eight -- so a
 * nibble is one AGI pixel in *either* mode: two CGA pixels of two bits in
 * 320x200, four pixels of one bit in 640x200. Every table below is therefore a
 * table of nibbles, and the pixel order is the card's: the most significant
 * bits are the leftmost pixel.
 *
 * The colours are turned into those nibbles before that copy, by a routine that
 * translates a screen in place with `xlat` against one of two tables:
 *
 * ```text
 * lea  bx, [1ba8h]        the two-colour table
 * cmp  [10c6h], 1
 * jnz  ...                 -> and that is the one used unless the flag is 1
 * lea  bx, [1bc8h]        the four-colour table, copied there at init
 * xlat
 * ```
 *
 * ## The same flag chooses the video mode
 *
 * Which is what makes the assignment of table to mode a reading rather than a
 * preference:
 *
 * ```text
 * flag != 0   int 10h ah=0Bh bx=0001h   the background register to colour 1
 *             int 10h ah=0Bh bx=0100h   palette 0   -> 320x200, four colours
 * flag == 0   out 3d8h, 1ah             bit 4: high resolution
 *             out 3d9h, 27h             -> 640x200, two colours
 * ```
 *
 * And the tables say the same thing about themselves. `0x1ba8` is a
 * **permutation of all sixteen nibble values** -- sixteen colours, sixteen
 * distinct four-pixel patterns, densities 0/4 through 4/4 -- which is a
 * two-colour dither and nothing else. `0x1bb8` read as pairs of two-bit pixels
 * decodes *semantically*: AGI's red becomes solid CGA red, light green solid
 * green, yellow solid brown, blue the background. Read the other way round
 * neither is sensible, and `0x1ba8` would make red green-and-background.
 *
 * ## Fills have a table of their own, and it is richer
 *
 * Entry 6 fills a region, and it builds its byte from a third table -- sixteen
 * entries of *three* bytes at `0x1b78`:
 *
 * ```text
 * call the helper       al = table[colour*3 + 0]        when the flag is not 1
 *                       ax = table[colour*3 + 1..2]     when it is
 * shl  dh, 1  (x4)
 * or   dl, dh           one byte: two nibbles
 * ```
 *
 * In the two-colour mode the helper returns one nibble and doubles it, and that
 * nibble is *the same value* `0x1ba8` holds -- which is what ties the three
 * tables together and says the reading is right. In the four-colour mode it
 * returns two different nibbles, so a fill alternates pattern between
 * neighbouring AGI pixels where the picture does not. That gives fills fifteen
 * distinct appearances where the picture has thirteen, and it is the original's
 * own inconsistency rather than this engine's.
 *
 * ## What is not in any of them
 *
 * A row phase. `HGC_GRAF.OVL` masks the row with `and dx, 3` and indexes an 8x8
 * cell with it; `CGA_GRAF.OVL` has no such instruction anywhere. So the
 * original's CGA dither is **vertical stripes, identical on every row**, where
 * M12 drew a checkerboard on the argument that two one-pixel stripes are the
 * same colour on average and a worse texture. That argument stands and the card
 * still did the other thing.
 */

/** Where the three tables sit in `AGIDATA.OVL`, and how big they are. */
export const CGA_TABLES_AT = {
  /** Sixteen entries of three bytes: the fill patterns. */
  fill: 0x1b78,
  /** Sixteen nibbles, doubled into bytes: the 640x200 two-colour picture. */
  mono: 0x1ba8,
  /** Sixteen nibbles, doubled: the 320x200 four-colour picture. */
  colour: 0x1bb8,
} as const;

export const CGA_FILL_STRIDE = 3;
export const CGA_TABLE_ENTRIES = 16;

/** How many CGA pixels one AGI pixel becomes, per mode. */
export const CGA_COLOUR_PIXELS = 2;
export const CGA_MONO_PIXELS = 4;

export class CgaTableError extends Error {
  override readonly name = 'CgaTableError';
}

/**
 * The three tables, decoded.
 *
 * `colour` and `mono` are a nibble per AGI colour. `fill` is two nibbles per
 * colour for the four-colour mode -- the left AGI pixel's and the right's --
 * and `monoFill` the single nibble the two-colour mode fills with.
 */
export interface CgaTables {
  readonly colour: readonly number[];
  readonly mono: readonly number[];
  readonly fill: readonly (readonly [number, number])[];
  readonly monoFill: readonly number[];
}

/**
 * The tables as they stand in LSL1's `AGIDATA.OVL`.
 *
 * Used when the file is not bundled, replaced by it when it is -- the rule
 * every interpreter file here follows. The comments are what each nibble means
 * once decoded, so that a wrong entry is a visible diff rather than a byte to
 * take on trust.
 */
export const CGA_TABLES: CgaTables = {
  // 0x1bb8: the four-colour picture. Two CGA pixels, high bits leftmost.
  colour: [
    0x0, //  0  black          0,0    the background
    0x0, //  1  blue           0,0    the background as well
    0xc, //  2  green          3,0
    0x1, //  3  cyan           0,1
    0xa, //  4  red            2,2    solid
    0x2, //  5  magenta        0,2
    0x9, //  6  brown          2,1
    0xd, //  7  light grey     3,1
    0x0, //  8  dark grey      0,0    the background, a third time
    0x3, //  9  light blue     0,3
    0x5, // 10  light green    1,1    solid
    0x7, // 11  light cyan     1,3
    0xe, // 12  light red      3,2
    0xe, // 13  light magenta  3,2    light red's
    0xf, // 14  yellow         3,3    solid
    0xf, // 15  white          3,3    yellow's
  ],

  // 0x1ba8: the two-colour picture. Four pixels, most significant leftmost.
  // Every one of the sixteen nibble values, used exactly once.
  mono: [
    0x0, //  0  black          ....   0/4
    0x2, //  1  blue           ..#.   1/4
    0x1, //  2  green          ...#   1/4
    0x3, //  3  cyan           ..##   2/4
    0x4, //  4  red            .#..   1/4
    0x6, //  5  magenta        .##.   2/4
    0x8, //  6  brown          #...   1/4
    0x5, //  7  light grey     .#.#   2/4
    0xa, //  8  dark grey      #.#.   2/4
    0x7, //  9  light blue     .###   3/4
    0x9, // 10  light green    #..#   2/4
    0xb, // 11  light cyan     #.##   3/4
    0xe, // 12  light red      ###.   3/4
    0xc, // 13  light magenta  ##..   2/4
    0xd, // 14  yellow         ##.#   3/4
    0xf, // 15  white          ####   4/4
  ],

  // 0x1b78 bytes 1 and 2: the four-colour fill, a nibble for each of two
  // neighbouring AGI pixels.
  fill: [
    [0x0, 0x0], //  0  black
    [0x0, 0x0], //  1  blue
    [0x4, 0x5], //  2  green
    [0x1, 0x0], //  3  cyan
    [0xa, 0xa], //  4  red
    [0x3, 0xc], //  5  magenta
    [0xb, 0xe], //  6  brown
    [0x3, 0x4], //  7  light grey
    [0x4, 0x3], //  8  dark grey
    [0xd, 0x0], //  9  light blue
    [0x1, 0x4], // 10  light green
    [0x5, 0x5], // 11  light cyan
    [0xe, 0xe], // 12  light red
    [0x2, 0x8], // 13  light magenta
    [0xd, 0x7], // 14  yellow
    [0xf, 0xf], // 15  white
  ],

  // 0x1b78 byte 0: the two-colour fill, which is the two-colour picture's own
  // nibble. The two tables agreeing here is the check on both.
  monoFill: [0x0, 0x2, 0x1, 0x3, 0x4, 0x6, 0x8, 0x5, 0xa, 0x7, 0x9, 0xb, 0xe, 0xc, 0xd, 0xf],
};

/**
 * The tables out of an `AGIDATA.OVL`.
 *
 * Nothing in the file identifies them, so the only structural check available
 * is that it is long enough to hold them. What does check the reading is that
 * the two-colour picture table and the two-colour fill column come back equal;
 * they are 48 bytes apart in the file and there is no reason for them to agree
 * unless both have been read right. A file where they disagree is refused.
 */
export function decodeCgaTables(bytes: Uint8Array<ArrayBufferLike>): CgaTables {
  const end = CGA_TABLES_AT.colour + CGA_TABLE_ENTRIES;
  if (bytes.length < end) {
    throw new CgaTableError(`AGIDATA.OVL is ${bytes.length} bytes; the tables end at ${end}`);
  }

  const nibbles = (at: number) =>
    [...bytes.subarray(at, at + CGA_TABLE_ENTRIES)].map((byte) => byte & 0x0f);

  const colour = nibbles(CGA_TABLES_AT.colour);
  const mono = nibbles(CGA_TABLES_AT.mono);

  const fill: [number, number][] = [];
  const monoFill: number[] = [];
  for (let entry = 0; entry < CGA_TABLE_ENTRIES; entry++) {
    const at = CGA_TABLES_AT.fill + entry * CGA_FILL_STRIDE;
    monoFill.push(bytes[at]! & 0x0f);
    fill.push([bytes[at + 1]! & 0x0f, bytes[at + 2]! & 0x0f]);
  }

  for (let entry = 0; entry < CGA_TABLE_ENTRIES; entry++) {
    if (monoFill[entry] !== mono[entry]) {
      throw new CgaTableError(
        `the two-colour tables disagree at colour ${entry}: `
        + `${monoFill[entry]} filling against ${mono[entry]} drawing`,
      );
    }
  }

  return { colour, mono, fill, monoFill };
}

/** The two CGA colours an AGI colour is drawn as, left pixel first. */
export function colourPixels(nibble: number): [number, number] {
  return [(nibble >> 2) & 3, nibble & 3];
}

/** Whether the nth of an AGI pixel's four two-colour pixels is lit. */
export function monoLit(nibble: number, pixel: number): number {
  return (nibble >> (CGA_MONO_PIXELS - 1 - pixel)) & 1;
}

/** How many of an AGI colour's four two-colour pixels are lit. */
export function monoDensity(nibble: number): number {
  let count = 0;
  for (let pixel = 0; pixel < CGA_MONO_PIXELS; pixel++) count += monoLit(nibble, pixel);
  return count;
}
