/**
 * AGI v2 VIEW decoder.
 *
 * A VIEW holds one or more loops, each a sequence of cels (frames), stored as
 * run-length encoded bitmaps. Several loops can share the same cel data through
 * mirroring, which is how a game stores a character walking left and right
 * without paying for both animations.
 *
 * Follows the AGI Specifications, chapter 8 (Peter Kelly, Claudio Matsuoka).
 */

import { EGA_PALETTE } from './pic.js';

/**
 * Palette index used for transparent pixels. The 16 EGA colours occupy 0-15, so
 * transparency gets its own slot rather than borrowing a colour: a cel's
 * transparent colour varies from cel to cel, and collapsing it here keeps every
 * rendered frame on one palette.
 */
export const TRANSPARENT = 16;

/** The EGA palette plus the transparent slot. */
export const VIEW_PALETTE = Object.freeze([...EGA_PALETTE, [0x00, 0x00, 0x00]]);

/**
 * @typedef {object} Cel
 * @property {number} width
 * @property {number} height
 * @property {number} transparent  transparent colour index from the cel header
 * @property {boolean} mirrored    whether this cel is shared with another loop
 * @property {number} sourceLoop   the loop the stored pixels are drawn for
 * @property {Uint8Array} pixels   width * height indices, TRANSPARENT for holes
 */

/**
 * @typedef {object} Loop
 * @property {number} loop  loop number
 * @property {Cel[]} cels
 */

/**
 * @typedef {object} View
 * @property {Loop[]} loops
 * @property {string | null} description
 */

/**
 * Decode bytes as latin1: every byte becomes the code point of the same value.
 *
 * Done by hand rather than through `Buffer` or `TextDecoder` so the decoder runs
 * unchanged in a browser. `TextDecoder('latin1')` would not do — that label
 * means windows-1252, which remaps 0x80-0x9F.
 *
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function latin1(bytes) {
  let out = '';
  // Chunked so a long run cannot overflow the argument limit.
  for (let i = 0; i < bytes.length; i += 8192) {
    out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return out;
}

/**
 * Decode one cel, including its run-length encoded pixels.
 *
 * Each line is a series of bytes whose high nibble is a colour and low nibble a
 * run length, terminated by 0x00. A line may stop early: the rest of it is
 * transparent, which is how the format avoids storing trailing holes.
 *
 * @param {Uint8Array} data
 * @param {number} offset
 * @returns {Cel}
 */
export function decodeCel(data, offset) {
  const width = data[offset];
  const height = data[offset + 1];
  const flags = data[offset + 2];

  const transparent = flags & 0x0f;
  const mirrored = (flags & 0x80) !== 0;
  const sourceLoop = (flags >> 4) & 0x07;

  const pixels = new Uint8Array(width * height).fill(TRANSPARENT);

  let i = offset + 3;
  for (let y = 0; y < height && i < data.length; y++) {
    let x = 0;
    while (i < data.length) {
      const chunk = data[i++];
      if (chunk === 0) break; // end of line

      const colour = chunk >> 4;
      const run = chunk & 0x0f;
      const value = colour === transparent ? TRANSPARENT : colour;

      for (let n = 0; n < run && x < width; n++, x++) {
        pixels[y * width + x] = value;
      }
    }
  }

  return { width, height, transparent, mirrored, sourceLoop, pixels };
}

/**
 * Mirror a cel's pixels horizontally.
 *
 * @param {Cel} cel
 * @returns {Uint8Array}
 */
export function flipHorizontally(cel) {
  const { width, height, pixels } = cel;
  const out = new Uint8Array(pixels.length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      out[y * width + x] = pixels[y * width + (width - 1 - x)];
    }
  }

  return out;
}

/**
 * The pixels to draw for a cel when it appears in a given loop.
 *
 * Mirrored cels are stored the right way round for exactly one loop; every
 * other loop sharing them draws the flipped version.
 *
 * @param {Cel} cel
 * @param {number} loopIndex
 * @returns {Uint8Array}
 */
export function celPixelsForLoop(cel, loopIndex) {
  return cel.mirrored && cel.sourceLoop !== loopIndex ? flipHorizontally(cel) : cel.pixels;
}

/**
 * Decode a VIEW resource.
 *
 * Loop and cel offsets that fall outside the payload are skipped rather than
 * thrown on, so a damaged view still yields the frames that survived.
 *
 * @param {Buffer | Uint8Array} data raw VIEW payload, without the VOL header
 * @returns {View}
 */
export function decodeView(data) {
  const loops = [];

  if (data.length < 5) return { loops, description: null };

  const loopCount = data[2];
  const descriptionOffset = data[3] | (data[4] << 8);

  for (let index = 0; index < loopCount; index++) {
    const entry = 5 + index * 2;
    if (entry + 1 >= data.length) break;

    const loopOffset = data[entry] | (data[entry + 1] << 8);
    if (loopOffset >= data.length) {
      loops.push({ loop: index, cels: [] });
      continue;
    }

    const celCount = data[loopOffset];
    const cels = [];

    for (let c = 0; c < celCount; c++) {
      const pointer = loopOffset + 1 + c * 2;
      if (pointer + 1 >= data.length) break;

      // Cel positions are relative to the start of the loop, not the resource.
      const celOffset = loopOffset + (data[pointer] | (data[pointer + 1] << 8));
      if (celOffset + 3 > data.length) break;

      cels.push(decodeCel(data, celOffset));
    }

    loops.push({ loop: index, cels });
  }

  let description = null;
  if (descriptionOffset > 0 && descriptionOffset < data.length) {
    let end = descriptionOffset;
    while (end < data.length && data[end] !== 0) end++;
    description = latin1(data.subarray(descriptionOffset, end));
  }

  return { loops, description };
}

/**
 * Compose a cel onto a canvas of the given size, anchored bottom-left.
 *
 * AGI positions a view by the bottom-left corner of its cel, so aligning frames
 * of differing sizes that way keeps an animation standing on one spot instead
 * of bobbing around.
 *
 * @param {Uint8Array} pixels cel pixels
 * @param {number} celWidth
 * @param {number} celHeight
 * @param {number} canvasWidth
 * @param {number} canvasHeight
 * @returns {Uint8Array}
 */
export function composeOnCanvas(pixels, celWidth, celHeight, canvasWidth, canvasHeight) {
  if (celWidth === canvasWidth && celHeight === canvasHeight) return pixels;

  const canvas = new Uint8Array(canvasWidth * canvasHeight).fill(TRANSPARENT);
  const top = canvasHeight - celHeight;

  for (let y = 0; y < celHeight; y++) {
    canvas.set(pixels.subarray(y * celWidth, (y + 1) * celWidth), (top + y) * canvasWidth);
  }

  return canvas;
}
