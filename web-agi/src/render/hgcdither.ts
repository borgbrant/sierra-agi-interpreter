/**
 * The Hercules dither table, read out of the original interpreter's own data.
 *
 * Not derived, not recovered from a photograph: this is the table Sierra's
 * `HGC_GRAF.OVL` indexes, 128 bytes of it, sitting at offset `0x1bea` in
 * `AGIDATA.OVL`. Two milestones guessed at it before anyone looked in the file
 * -- M13 derived densities from luminance, M15 measured them off screenshots
 * and got most of them wrong because a capture's fine dither is smoothed into
 * a flat grey before it is ever thresholded.
 *
 * ## How the driver reads it
 *
 * The blit in `HGC_GRAF.OVL` is short enough to quote. It takes two picture
 * pixels at a time, and when they are the same colour:
 *
 * ```text
 * lodsw                      ax = two pixels of the visual screen
 * and  ax, 0f0fh             a colour in each byte
 * cmp  al, ah                the same colour?
 * shl  al, 1  (x3)           al = colour * 8
 * mov  bx, dx                dx = (row and 3) * 2
 * add  bl, al                bx = colour * 8 + (row and 3) * 2
 * mov  al, ss:[bx+1beah]     the byte for this device row
 * stosb
 * mov  al, ss:[bx+1bebh]     and the byte for the row below
 * mov  es:[di+50h], al       50h = 80 bytes = one 640-pixel row
 * ```
 *
 * Every number in the layout follows from that:
 *
 * ```text
 * 8 bytes per colour        colour * 8
 * 4 row phases              (row and 3), two bytes each
 * 8 device rows per cell    four AGI rows, two device rows apiece
 * 8 device columns          one byte spans two AGI pixels of four pixels each
 * ```
 *
 * So a colour's eight bytes *are* the eight device rows of an 8x8 cell, most
 * significant bit leftmost. The pairs-of-pixels case confirms the horizontal
 * halves: for two different colours the left pixel keeps the byte's high nibble
 * (`and al, 0f0h`) and the right pixel the low nibble (`and ah, 0fh`), so an
 * even-numbered AGI pixel takes the top four bits and an odd one the bottom
 * four.
 *
 * ## What is in it
 *
 * Ten distinct densities over the sixteen colours, and every colour has a
 * pattern -- there is no threshold anywhere in it:
 *
 * ```text
 *  0 black          00 00 00 00 00 00 00 00    0/64
 *  1 blue           88 00 00 00 22 00 00 00    4/64  sparse dots
 *  2 green          80 10 02 20 01 08 40 04    8/64  scattered
 *  3 cyan           aa 00 aa 00 aa 00 aa 00   16/64  alternate pixels, every
 *                                                    other row
 *  4 red            22 88 22 88 22 88 22 88   16/64  two-pixel grid
 *  5 magenta        88 00 88 00 88 00 88 00    8/64
 *  6 brown          11 22 44 88 11 22 44 88   16/64  45 degree diagonal
 *  7 light grey     55 aa 55 aa 55 aa 55 aa   32/64  a checkerboard
 *  8 dark grey      22 00 88 00 22 00 88 00    8/64
 *  9 light blue     d7 ff 7d ff d7 ff 7d ff   56/64
 * 10 light green    dd 55 77 aa dd 55 77 aa   40/64
 * 11 light cyan     7f ef fd df fe f7 bf fb   56/64  a dispersed hole
 * 12 light red      aa ff aa ff aa ff aa ff   48/64
 * 13 light magenta  77 bb dd ee 77 bb dd ee   48/64  the diagonal, inverted
 * 14 yellow         77 ff ff ff dd ff ff ff   60/64
 * 15 white          ff ff ff ff ff ff ff ff   64/64
 * ```
 *
 * The captures agree with it, once they are read the right way. Thresholding
 * their pixels does not work -- a one-pixel checkerboard is smoothed into a
 * flat half-tone in the capture, so light grey reads as solid amber and cyan as
 * solid black. Their *brightness* does work: the mean luminance of each
 * colour's regions against this table's densities fits a straight line at
 * R^2 = 0.95, in the correct order throughout, with the residual curving the
 * way a display gamma curves. See `test/helpers/hgc-reference.ts`.
 *
 * ## Why it is a file and not a constant
 *
 * The same reason `HGC_FONT` is: it belongs to the interpreter that shipped
 * beside the game, not to the game. A copy of LSL1 without `AGIDATA.OVL` still
 * plays, and another AGI version's table could differ, so the bytes below are
 * this game's -- used when the file is absent, replaced by it when it is there.
 */

/** The table's place in `AGIDATA.OVL`, and its size. */
export const HGC_DITHER_OFFSET = 0x1bea;
export const HGC_DITHER_BYTES = 128;

/** One cell: eight device rows of eight device pixels. */
export const HGC_CELL_WIDTH = 8;
export const HGC_CELL_HEIGHT = 8;

/** How many pixels a cell holds, and so the denominator of every density. */
export const HGC_LEVELS = HGC_CELL_WIDTH * HGC_CELL_HEIGHT;

export class HgcDitherError extends Error {
  override readonly name = 'HgcDitherError';
}

/** A colour's pattern: eight rows of eight bits, top row first. */
export type HgcDither = readonly (readonly number[])[];

/**
 * The table as it stands in LSL1's `AGIDATA.OVL`.
 *
 * Written out as rows rather than as the file's bytes because that is what it
 * means -- the eight bytes of a colour are the eight device rows of its cell,
 * and reading them as anything else was the mistake that cost this project two
 * milestones.
 */
export const HGC_DITHER: HgcDither = [
  [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00], //  0  black           0/64
  [0x88, 0x00, 0x00, 0x00, 0x22, 0x00, 0x00, 0x00], //  1  blue            4/64
  [0x80, 0x10, 0x02, 0x20, 0x01, 0x08, 0x40, 0x04], //  2  green           8/64
  [0xaa, 0x00, 0xaa, 0x00, 0xaa, 0x00, 0xaa, 0x00], //  3  cyan           16/64
  [0x22, 0x88, 0x22, 0x88, 0x22, 0x88, 0x22, 0x88], //  4  red            16/64
  [0x88, 0x00, 0x88, 0x00, 0x88, 0x00, 0x88, 0x00], //  5  magenta         8/64
  [0x11, 0x22, 0x44, 0x88, 0x11, 0x22, 0x44, 0x88], //  6  brown          16/64
  [0x55, 0xaa, 0x55, 0xaa, 0x55, 0xaa, 0x55, 0xaa], //  7  light grey     32/64
  [0x22, 0x00, 0x88, 0x00, 0x22, 0x00, 0x88, 0x00], //  8  dark grey       8/64
  [0xd7, 0xff, 0x7d, 0xff, 0xd7, 0xff, 0x7d, 0xff], //  9  light blue     56/64
  [0xdd, 0x55, 0x77, 0xaa, 0xdd, 0x55, 0x77, 0xaa], // 10  light green    40/64
  [0x7f, 0xef, 0xfd, 0xdf, 0xfe, 0xf7, 0xbf, 0xfb], // 11  light cyan     56/64
  [0xaa, 0xff, 0xaa, 0xff, 0xaa, 0xff, 0xaa, 0xff], // 12  light red      48/64
  [0x77, 0xbb, 0xdd, 0xee, 0x77, 0xbb, 0xdd, 0xee], // 13  light magenta  48/64
  [0x77, 0xff, 0xff, 0xff, 0xdd, 0xff, 0xff, 0xff], // 14  yellow         60/64
  [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff], // 15  white          64/64
];

/**
 * The table out of an `AGIDATA.OVL`.
 *
 * The file is 7680 bytes of interpreter data and this reads 128 of them. There
 * is nothing in the file that identifies the table, so the only check possible
 * is that the file is long enough to hold it -- which is why the shipped
 * default exists, and why a table that reads back absurd would be a wrong
 * `AGIDATA.OVL` rather than a wrong offset.
 */
export function decodeHgcDither(bytes: Uint8Array<ArrayBufferLike>): HgcDither {
  const end = HGC_DITHER_OFFSET + HGC_DITHER_BYTES;
  if (bytes.length < end) {
    throw new HgcDitherError(
      `AGIDATA.OVL is ${bytes.length} bytes; the dither table ends at ${end}`,
    );
  }

  const table: number[][] = [];
  for (let colour = 0; colour < 16; colour++) {
    const at = HGC_DITHER_OFFSET + colour * HGC_CELL_HEIGHT;
    table.push([...bytes.subarray(at, at + HGC_CELL_HEIGHT)]);
  }
  return table;
}

/** How many of a colour's sixty-four pixels are lit. */
export function ditherDensity(table: HgcDither, colour: number): number {
  return table[colour & 0x0f]!.reduce(
    (count, row) => count + row.toString(2).split('1').length - 1,
    0,
  );
}

/**
 * Whether the pixel at a place is lit.
 *
 * `x` and `y` are device pixels measured from the picture's own origin, which
 * is what makes the pattern land where the original's did: the cell is anchored
 * to the picture rather than to the screen, and the picture starts at the
 * scene's left edge.
 */
export function ditherLit(table: HgcDither, colour: number, x: number, y: number): number {
  const row = table[colour & 0x0f]![y % HGC_CELL_HEIGHT]!;
  return (row >> (HGC_CELL_WIDTH - 1 - (x % HGC_CELL_WIDTH))) & 1;
}
