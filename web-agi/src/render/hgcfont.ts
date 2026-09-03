/**
 * `HGC_FONT`: the Hercules driver's own font, read from the file.
 *
 * The engine carries an 8x8 font of its own because CGA and EGA drew text with
 * the PC's ROM font, which lived in the video BIOS rather than in any file.
 * Hercules is not like that. Its driver brought a font with it -- 3072 bytes,
 * shipped beside `HGC_GRAF.OVL` -- and it is a different font, not the same one
 * larger. Drawing the 8x8 one in its place reads as exactly what it is.
 *
 * ## The layout, which took four guesses
 *
 * 3072 bytes divides several ways and only one of them is a font. Each was
 * tried by rendering a capital A and looking at it:
 *
 * ```text
 * 256 glyphs of 12 rows, 1 byte    A came out blank
 * 192 glyphs of 16 rows, 1 byte    fragments, split across bytes
 * 96 glyphs of 16 rows, 2 bytes    an M where the A should be
 * 128 glyphs of 12 rows, 2 bytes   an A, with its rows out of order
 * ```
 *
 * So the glyph is **16 pixels wide**, big-endian, twelve rows of it, and 128 of
 * them -- the whole of ASCII. Sixteen wide is worth noticing on its own: the
 * font is natively that width with two-pixel strokes drawn in, not an 8-wide
 * font to be doubled. It is why Hercules' cell is 16 across.
 *
 * ## The rows are stored in swapped pairs
 *
 * Row 0 of a glyph is the second row in the file, row 1 is the first, and so on
 * down. Four bank interleavings were tried first, because that is how Hercules
 * lays out its screen; none of them worked, and `i ^ 1` does. Every glyph comes
 * out clean under it -- the zero has its diagonal, `g` and `j` have proper
 * descenders, and `_` is a full-width rule on the bottom two rows -- which is
 * what says the layout is right rather than merely plausible.
 *
 * Why they are stored that way is not recoverable from the file. A pair of rows
 * is four bytes, and something that wrote them as 32-bit words on a
 * little-endian machine would swap them exactly like this.
 */

/** One glyph is 16 pixels across. */
export const HGC_GLYPH_WIDTH = 16;

/** And twelve rows down, which is `HGC_FONT`'s 3072 bytes over 128 glyphs. */
export const HGC_GLYPH_HEIGHT = 12;

/** How many glyphs the file holds: the whole of ASCII. */
export const HGC_GLYPH_COUNT = 128;

/** Bytes per glyph: twelve rows of two. */
const GLYPH_BYTES = (HGC_GLYPH_WIDTH / 8) * HGC_GLYPH_HEIGHT;

/** How big the file is, and a wrong size is a wrong file. */
export const HGC_FONT_BYTES = HGC_GLYPH_COUNT * GLYPH_BYTES;

export class HgcFontError extends Error {
  override readonly name = 'HgcFontError';
}

/** A decoded font: twelve rows of sixteen bits per glyph. */
export interface HgcFont {
  /**
   * The rows of one character, high bit leftmost.
   *
   * A character outside the file comes back blank rather than as some other
   * letter, which is the same rule the engine's own font follows.
   */
  glyph(code: number): ArrayLike<number>;
}

/**
 * Decode the file.
 *
 * @param bytes the whole of `HGC_FONT`
 * @throws HgcFontError if it is not 3072 bytes
 */
export function decodeHgcFont(bytes: Uint8Array): HgcFont {
  if (bytes.length !== HGC_FONT_BYTES) {
    throw new HgcFontError(
      `HGC_FONT is ${bytes.length} bytes, and a Hercules font is ${HGC_FONT_BYTES}`,
    );
  }

  // Unpacked once, into one row per entry, so drawing a character is an
  // indexed read rather than two byte reads and a shift.
  const rows = new Uint16Array(HGC_GLYPH_COUNT * HGC_GLYPH_HEIGHT);

  for (let code = 0; code < HGC_GLYPH_COUNT; code++) {
    for (let row = 0; row < HGC_GLYPH_HEIGHT; row++) {
      // The swapped pair: row 0 is stored second, row 1 first, and so on.
      const at = code * GLYPH_BYTES + (row ^ 1) * 2;
      rows[code * HGC_GLYPH_HEIGHT + row] = (bytes[at]! << 8) | bytes[at + 1]!;
    }
  }

  const blank = new Uint16Array(HGC_GLYPH_HEIGHT);

  return {
    glyph(code: number): ArrayLike<number> {
      if (code < 0 || code >= HGC_GLYPH_COUNT) return blank;
      const at = code * HGC_GLYPH_HEIGHT;
      return rows.subarray(at, at + HGC_GLYPH_HEIGHT);
    },
  };
}
