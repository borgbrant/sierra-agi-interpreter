/**
 * A driver's framebuffer: palette indices, at whatever size the driver works
 * in.
 *
 * This is deliberately *not* "the display". It is the buffer a display driver
 * composes into, and the size and palette are the driver's: EGA's is 320x200
 * with sixteen colours, Hercules' is 720x348 with two. The defaults here are
 * EGA's, because EGA is the only driver as this is written and because the
 * engine's own tests are written against it.
 *
 * Composition happens with no canvas involved, so everything the engine draws
 * can be checked without a browser. Turning the buffer into pixels is the only
 * step that needs one.
 *
 * At EGA's size the buffer is a 40x25 grid of 8x8 characters:
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

/** How many colours the EGA palette holds. */
export const PALETTE_SIZE = PALETTE_RGB.length / 3;

export class Display {
  /** One palette index per pixel, row-major. */
  readonly pixels: Uint8Array;

  readonly width: number;
  readonly height: number;

  /** The colours the indices mean, as r,g,b triples. */
  readonly palette: Uint8Array;

  constructor(width = DISPLAY_WIDTH, height = DISPLAY_HEIGHT, palette = PALETTE_RGB) {
    this.width = width;
    this.height = height;
    this.palette = palette;
    this.pixels = new Uint8Array(width * height);
  }

  /** How many pixels the buffer holds. */
  get size(): number {
    return this.pixels.length;
  }

  fill(colour: number): void {
    this.pixels.fill(colour);
  }

  /** Paint one display row range a single colour. */
  fillRows(top: number, height: number, colour: number): void {
    const from = Math.max(0, top) * this.width;
    const to = Math.min(this.height, top + height) * this.width;
    if (to > from) this.pixels.fill(colour, from, to);
  }

  /** Paint a rectangle, clipped to the buffer. */
  fillRect(x: number, y: number, width: number, height: number, colour: number): void {
    const left = Math.max(0, x);
    const top = Math.max(0, y);
    const right = Math.min(this.width, x + width);
    const bottom = Math.min(this.height, y + height);

    for (let row = top; row < bottom; row++) {
      this.pixels.fill(colour, row * this.width + left, row * this.width + right);
    }
  }

  /**
   * Draw a 160x168 screen into the picture area, stretching it horizontally.
   *
   * @param screen  visual or priority buffer, 160x168
   * @param top     display row to start at
   * @param aspect  how many display pixels wide one AGI pixel is
   * @param scaleY  how many display rows tall one AGI row is
   */
  drawScreen(screen: Bytes, top = PICTURE_TOP, aspect = PIXEL_ASPECT, scaleY = 1): void {
    for (let y = 0; y < PICTURE_HEIGHT; y++) {
      for (let repeat = 0; repeat < scaleY; repeat++) {
        const destRow = top + y * scaleY + repeat;
        if (destRow < 0 || destRow >= this.height) continue;

        let dest = destRow * this.width;
        const source = y * PICTURE_WIDTH;
        for (let x = 0; x < PICTURE_WIDTH; x++) {
          const colour = screen[source + x]!;
          for (let n = 0; n < aspect; n++) this.pixels[dest++] = colour;
        }
      }
    }
  }

  /**
   * Expand to RGBA for a canvas.
   *
   * @param into optional buffer to reuse, avoiding an allocation per frame
   */
  toRgba(into?: Uint8ClampedArray): Uint8ClampedArray {
    const size = this.pixels.length;
    const rgba = into ?? new Uint8ClampedArray(size * 4);
    const colours = this.palette.length / 3;

    for (let i = 0, at = 0; i < size; i++) {
      // Wrapped rather than clamped: the games write colour numbers modulo the
      // palette they were drawn for, and a two-colour driver has to survive
      // being handed a fifteen.
      const colour = (this.pixels[i]! % colours) * 3;
      rgba[at++] = this.palette[colour]!;
      rgba[at++] = this.palette[colour + 1]!;
      rgba[at++] = this.palette[colour + 2]!;
      rgba[at++] = 255;
    }

    return rgba;
  }
}
