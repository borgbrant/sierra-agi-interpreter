/**
 * The 320x200 display the player sees, as palette indices.
 *
 * Composition happens here, into a plain byte buffer with no canvas involved,
 * so everything the engine draws can be checked without a browser. Turning the
 * buffer into pixels is the only step that needs one.
 *
 * The screen is a 40x25 grid of 8x8 characters:
 *
 *   row 0        status line
 *   rows 1-21    picture area, 168 pixels tall
 *   rows 22-24   prompt and input line
 */
import { EGA_PALETTE } from 'agi-extract/pic';

import { CHAR_HEIGHT } from './font.ts';
import { PICTURE_HEIGHT, PICTURE_WIDTH, type Bytes } from './screens.ts';

export const DISPLAY_WIDTH = 320;
export const DISPLAY_HEIGHT = 200;

/** First display row belonging to the picture, below the one-cell status line. */
export const PICTURE_TOP = CHAR_HEIGHT;

/**
 * How many display pixels wide one AGI pixel is. The games were drawn for a
 * 160-pixel-wide screen shown on a 320-pixel one.
 */
export const PIXEL_ASPECT = 2;

const SIZE = DISPLAY_WIDTH * DISPLAY_HEIGHT;

/**
 * The 16 EGA colours, flattened to r,g,b bytes.
 *
 * Flat rather than nested so expanding a frame is a straight indexed read with
 * no per-pixel array lookup.
 */
export const PALETTE_RGB: Uint8Array = (() => {
  const source = EGA_PALETTE as ReadonlyArray<ReadonlyArray<number>>;
  const flat = new Uint8Array(source.length * 3);
  source.forEach((colour, i) => {
    flat[i * 3] = colour[0] ?? 0;
    flat[i * 3 + 1] = colour[1] ?? 0;
    flat[i * 3 + 2] = colour[2] ?? 0;
  });
  return flat;
})();

/** How many colours the palette holds. */
export const PALETTE_SIZE = PALETTE_RGB.length / 3;

export class Display {
  /** One palette index per pixel, row-major. */
  readonly pixels: Uint8Array;

  constructor() {
    this.pixels = new Uint8Array(SIZE);
  }

  fill(colour: number): void {
    this.pixels.fill(colour);
  }

  /** Paint one display row range a single colour. */
  fillRows(top: number, height: number, colour: number): void {
    const from = Math.max(0, top) * DISPLAY_WIDTH;
    const to = Math.min(DISPLAY_HEIGHT, top + height) * DISPLAY_WIDTH;
    if (to > from) this.pixels.fill(colour, from, to);
  }

  /** Paint a rectangle, clipped to the display. */
  fillRect(x: number, y: number, width: number, height: number, colour: number): void {
    const left = Math.max(0, x);
    const top = Math.max(0, y);
    const right = Math.min(DISPLAY_WIDTH, x + width);
    const bottom = Math.min(DISPLAY_HEIGHT, y + height);

    for (let row = top; row < bottom; row++) {
      this.pixels.fill(colour, row * DISPLAY_WIDTH + left, row * DISPLAY_WIDTH + right);
    }
  }

  /**
   * Draw a 160x168 screen into the picture area, doubling it horizontally.
   *
   * @param screen  visual or priority buffer, 160x168
   * @param top     display row to start at
   */
  drawScreen(screen: Bytes, top = PICTURE_TOP): void {
    for (let y = 0; y < PICTURE_HEIGHT; y++) {
      const destRow = top + y;
      if (destRow < 0 || destRow >= DISPLAY_HEIGHT) continue;

      let dest = destRow * DISPLAY_WIDTH;
      const source = y * PICTURE_WIDTH;
      for (let x = 0; x < PICTURE_WIDTH; x++) {
        const colour = screen[source + x]!;
        for (let n = 0; n < PIXEL_ASPECT; n++) this.pixels[dest++] = colour;
      }
    }
  }

  /**
   * Expand to RGBA for a canvas.
   *
   * @param into optional buffer to reuse, avoiding an allocation per frame
   */
  toRgba(into?: Uint8ClampedArray): Uint8ClampedArray {
    const rgba = into ?? new Uint8ClampedArray(SIZE * 4);

    for (let i = 0, at = 0; i < SIZE; i++) {
      const colour = (this.pixels[i]! & 0x0f) * 3;
      rgba[at++] = PALETTE_RGB[colour]!;
      rgba[at++] = PALETTE_RGB[colour + 1]!;
      rgba[at++] = PALETTE_RGB[colour + 2]!;
      rgba[at++] = 255;
    }

    return rgba;
  }
}
