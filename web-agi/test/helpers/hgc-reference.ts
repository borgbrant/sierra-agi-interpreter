/**
 * What the captures of the original say about the dither table, recorded so the
 * tests can hold it.
 *
 * Produced by `node scripts/check-hgc-dither.mjs --fixture`. The table itself is
 * not in here: it is 128 bytes of `AGIDATA.OVL` and lives in
 * `src/render/hgcdither.ts`, checked against the bundled file by a test. What is
 * in here is the corroboration -- the captures' own brightness, which is the
 * only thing they can be asked for.
 *
 * ## Brightness, not bits
 *
 * Half of the table's patterns alternate on a one-pixel pitch, and a capture
 * smooths those into a flat half-tone before it is saved. Thresholding one
 * therefore reports light grey's checkerboard as solid amber and cyan's
 * alternating rows as solid black -- which is how this project once concluded
 * that the original barely dithered. The mean luminance of a colour's regions
 * survives that smoothing, and it is what these numbers are.
 *
 * The captures are not in the repository -- they are large, and not this
 * project's to redistribute -- so the tests that use them skip when
 * `screenshots-from-original/` is absent.
 */

/** Where the captures live, relative to the package. */
export const CAPTURE_DIR = 'screenshots-from-original';

/**
 * The three captures whose room is identified beyond doubt.
 *
 * `room` and `cycles` are how to reproduce the screen: boot, enter the room, run
 * that many cycles. What is compared against is the frame the engine composes,
 * not a PICTURE resource -- a room draws over its picture, and those pixels are
 * not the colour the PICTURE holds underneath them.
 *
 * Four of the seven captures are not here. Three are the title screen behind
 * the age quiz and the intro's info box, which are not a room's composed
 * picture at all. The fourth is `lsl1-hercules-inputbox-command`: room 12 with
 * the interpreter's command box over the middle of it, which identifies at 58%
 * because most of what differs is the box.
 */
export const CAPTURES = [
  {
    file: 'lsl1-hercules-backyard-dithering.png',
    room: 12,
    cycles: 60,
    geometry: { originX: 4, originY: -1.035938, scale: 5.035938 },
  },
  {
    file: 'lsl1-hercules-bar.png',
    room: 15,
    cycles: 20,
    geometry: { originX: 3, originY: 0.967187, scale: 5.032813 },
  },
  {
    file: 'lsl11-hercules-toilet.png',
    room: 13,
    cycles: 20,
    geometry: { originX: 0, originY: 2.9625, scale: 5.0375 },
  },
] as const;

/**
 * How bright each colour's regions came out, pooled over those three captures.
 *
 * Mean luminance, 0 to 255, over the inner part of every AGI pixel whose four
 * neighbours share its colour. Fifteen of the sixteen appear; dark grey appears
 * in none of the three rooms.
 *
 * Read it beside the table's densities and the correspondence is the check:
 * black at 0/64 is 0.3, cyan and red at 16/64 are 38.6 and 40.2, light grey at
 * 32/64 is 80.4, light cyan at 56/64 is 135.4. Even the colours with a handful
 * of pixels land where the table says -- green at 8/64 is 22.1 over 34 pixels,
 * yellow at 60/64 is 143.9 over nine.
 *
 * White is the one that does not: 114.7 where the fit predicts 143. Its 214
 * pixels are thin highlights with outlines and sprites against them, and the
 * footprint sampled carries some of that. It is left in the fit rather than
 * trimmed out of it, which is why the recorded R^2 is 0.95 and not higher.
 */
export const BRIGHTNESS = [
  { colour: 0, pixels: 25284, luma: 0.34 },
  { colour: 1, pixels: 937, luma: 10.75 },
  { colour: 2, pixels: 34, luma: 22.13 },
  { colour: 3, pixels: 2586, luma: 38.56 },
  { colour: 4, pixels: 3430, luma: 40.19 },
  { colour: 5, pixels: 8, luma: 20.38 },
  { colour: 6, pixels: 332, luma: 44.18 },
  { colour: 7, pixels: 2270, luma: 80.42 },
  { colour: 8, pixels: 0, luma: null },
  { colour: 9, pixels: 687, luma: 136.68 },
  { colour: 10, pixels: 41, luma: 98.76 },
  { colour: 11, pixels: 4204, luma: 135.37 },
  { colour: 12, pixels: 3949, luma: 119.39 },
  { colour: 13, pixels: 1, luma: 112.05 },
  { colour: 14, pixels: 9, luma: 143.86 },
  { colour: 15, pixels: 214, luma: 114.71 },
] as const;

/**
 * The straight line through those points: `luma = 6.09 + 137.08 x density`.
 *
 * The residual curves the way a display gamma curves -- the darker colours a
 * little under the line, the brighter ones a little over -- which is what says
 * the relationship is a real one rather than a coincidence of two orderings.
 */
export const FIT = { intercept: 6.09, slope: 137.08, r2: 0.9494 };

/** How many AGI pixels a colour needs before a test will use its brightness. */
export const ENOUGH = 50;
