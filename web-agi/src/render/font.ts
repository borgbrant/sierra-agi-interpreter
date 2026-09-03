/**
 * The 8x8 text font.
 *
 * AGI drew text with the IBM PC's ROM font, which lived in the video BIOS
 * rather than in the game, so there is nothing to decode out of the resources:
 * the bitmap has to be carried by the engine. This is that font, for the
 * printable ASCII range.
 *
 * The bundled game's text uses nothing outside 0x20-0x7E (checked against every
 * message in all 46 LOGIC resources and every inventory item name), so the
 * table stops there. A character outside the range draws as a blank rather than
 * as a wrong glyph, and {@link hasGlyph} says which is which.
 *
 * One glyph is eight bytes, top row first, and the high bit of each byte is the
 * leftmost pixel.
 */

/** Size of one character cell, in pixels. */
export const CHAR_WIDTH = 8;
export const CHAR_HEIGHT = 8;

/** First and last character the font covers. */
export const FIRST_GLYPH = 0x20;
export const LAST_GLYPH = 0x7e;

/**
 * The glyphs, one hex string of eight bytes each, from {@link FIRST_GLYPH}.
 *
 * Written out rather than generated so that a wrong pixel is a visible diff.
 * `font.test.ts` renders every glyph and checks the ones whose shape can be
 * stated as a rule -- a blank space, a full-width underscore, symmetry.
 */
const GLYPHS = [
  '0000000000000000', // (space)
  '3078783030003000', // !
  '6c6c6c0000000000', // "
  '6c6cfe6cfe6c6c00', // #
  '307cc0780cf83000', // $
  '00c6cc183066c600', // %
  '386c3876dccc7600', // &
  '6060c00000000000', // '
  '1830606060301800', // (
  '6030181818306000', // )
  '00663cff3c660000', // *
  '003030fc30300000', // +
  '0000000000303060', // ,
  '000000fc00000000', // -
  '0000000000303000', // .
  '060c1830c0800000', // /
  '7cc6cedef6e67c00', // 0
  '307030303030fc00', // 1
  '78cc0c3860ccfc00', // 2
  '78cc0c380ccc7800', // 3
  '1c3c6cccfe0c1e00', // 4
  'fcc0f80c0ccc7800', // 5
  '3860c0f8cccc7800', // 6
  'fccc0c1830303000', // 7
  '78cccc78cccc7800', // 8
  '78cccc7c0c187000', // 9
  '0030300000303000', // :
  '0030300000303060', // ;
  '183060c060301800', // <
  '0000fc0000fc0000', // =
  '6030180c18306000', // >
  '78cc0c1830003000', // ?
  '7cc6dededec07800', // @
  '3078ccccfccccc00', // A
  'fc66667c6666fc00', // B
  '3c66c0c0c0663c00', // C
  'f86c6666666cf800', // D
  'fe6268786862fe00', // E
  'fe6268786860f000', // F
  '3c66c0c0ce663e00', // G
  'ccccccfccccccc00', // H
  '7830303030307800', // I
  '1e0c0c0ccccc7800', // J
  'e6666c786c66e600', // K
  'f06060606266fe00', // L
  'c6eefefed6c6c600', // M
  'c6e6f6decec6c600', // N
  '386cc6c6c66c3800', // O
  'fc66667c6060f000', // P
  '78ccccccdc781c00', // Q
  'fc66667c6c66e600', // R
  '78cce0701ccc7800', // S
  'fcb4303030307800', // T
  'ccccccccccccfc00', // U
  'cccccccccc783000', // V
  'c6c6c6d6feeec600', // W
  'c6c66c38386cc600', // X
  'cccccc7830307800', // Y
  'fec68c183266fe00', // Z
  '7860606060607800', // [
  'c06030180c060200', // \
  '7818181818187800', // ]
  '10386cc600000000', // ^
  '00000000000000ff', // _
  '3030180000000000', // `
  '0000780c7ccc7600', // a
  'e060607c6666dc00', // b
  '000078ccc0cc7800', // c
  '1c0c0c7ccccc7600', // d
  '000078ccfcc07800', // e
  '386c60f06060f000', // f
  '000076cccc7c0cf8', // g
  'e0606c766666e600', // h
  '3000703030307800', // i
  '0c000c0c0ccccc78', // j
  'e060666c786ce600', // k
  '7030303030307800', // l
  '0000ccfefed6c600', // m
  '0000f8cccccccc00', // n
  '000078cccccc7800', // o
  '0000dc66667c60f0', // p
  '000076cccc7c0c1e', // q
  '0000dc766660f000', // r
  '00007cc0780cf800', // s
  '10307c3030341800', // t
  '0000cccccccc7600', // u
  '0000cccccc783000', // v
  '0000c6d6fefe6c00', // w
  '0000c66c386cc600', // x
  '0000cccccc7c0cf8', // y
  '0000fc983064fc00', // z
  '1c3030e030301c00', // {
  '1818180018181800', // |
  'e030301c3030e000', // }
  '76dc000000000000', // ~
] as const;

/**
 * The font as flat bytes: 8 per glyph, starting at {@link FIRST_GLYPH}.
 */
export const FONT: Uint8Array = (() => {
  const bytes = new Uint8Array(GLYPHS.length * CHAR_HEIGHT);
  GLYPHS.forEach((hex, index) => {
    const clean = hex.replace(/\s+/g, '');
    for (let row = 0; row < CHAR_HEIGHT; row++) {
      bytes[index * CHAR_HEIGHT + row] = parseInt(clean.slice(row * 2, row * 2 + 2), 16);
    }
  });
  return bytes;
})();

/** Whether the font has a glyph for a character code. */
export function hasGlyph(code: number): boolean {
  return code >= FIRST_GLYPH && code <= LAST_GLYPH;
}

/**
 * The eight rows of one character.
 *
 * A character the font does not cover comes back blank: a missing glyph should
 * leave a gap, never some other letter.
 *
 * @param code character code
 */
export function glyph(code: number): Uint8Array {
  if (!hasGlyph(code)) return BLANK;
  const at = (code - FIRST_GLYPH) * CHAR_HEIGHT;
  return FONT.subarray(at, at + CHAR_HEIGHT);
}

const BLANK = new Uint8Array(CHAR_HEIGHT);
