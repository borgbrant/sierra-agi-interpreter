/**
 * EGA: sixteen colours, 320x200, the 8x8 IBM font.
 *
 * The mode the engine has always drawn, now on the far side of the seam. It is
 * also the reference the other three are judged against -- nobody here can
 * compare a CGA palette or a Hercules dither with the real hardware, but this
 * one is known to be right, so it is the one the golden tests hold still.
 *
 * The picture is the game's 160x168 doubled horizontally: AGI pixels are twice
 * as wide as they are tall, and the doubling is the correction. Everything else
 * is cells.
 */
import {
  Display,
  DISPLAY_HEIGHT,
  DISPLAY_WIDTH,
  PALETTE_RGB,
  PICTURE_TOP,
  PIXEL_ASPECT,
} from '../display.ts';
import type { Frame } from '../frame.ts';
import { TRANSPARENT, type Cel } from '../sprite.ts';
import { clearRows, drawText, drawWindow, IBM_CELL } from '../text.ts';
import type { DisplayDriver, DisplayMode } from './driver.ts';

/**
 * EGA's buffer is presented with square pixels.
 *
 * Not because the adapter's were, but because the correction has already
 * happened: the picture is 160 wide and this buffer is 320, so the doubling
 * that {@link Display.drawScreen} does is what makes an AGI pixel square
 * again. A driver whose buffer is not already corrected -- Hercules, at
 * 720x348 -- reports something other than 1, and the canvas acts on it.
 */
const EGA_PIXEL_ASPECT = 1;

export class EgaDriver implements DisplayDriver {
  readonly mode: DisplayMode;
  readonly display = new Display(DISPLAY_WIDTH, DISPLAY_HEIGHT, PALETTE_RGB);
  readonly pixelAspect = EGA_PIXEL_ASPECT;
  readonly monochrome = false;

  /**
   * @param mode which adapter this driver is answering for
   *
   * The PCjr's 160x200 mode is the sixteen-colour palette AGI was drawn for,
   * so its pixels are these pixels and only the answer the scripts get differs
   * -- which is why one class serves two modes rather than one of them being a
   * copy of the other.
   */
  constructor(mode: DisplayMode = 'ega') {
    this.mode = mode;
  }

  draw(frame: Frame): void {
    for (const layer of frame.layers) {
      switch (layer.kind) {
        case 'fill':
          this.display.fill(layer.colour);
          break;

        case 'picture':
          this.display.drawScreen(layer.screen, PICTURE_TOP, PIXEL_ASPECT);
          break;

        case 'cells':
          layer.cells.draw(this.display, IBM_CELL);
          break;

        case 'text':
          drawText(
            this.display,
            layer.text,
            layer.column,
            layer.row,
            layer.foreground,
            layer.background,
            IBM_CELL,
          );
          break;

        case 'rows':
          clearRows(this.display, layer.from, layer.to, layer.colour, IBM_CELL);
          break;

        case 'window':
          drawWindow(this.display, layer.window, IBM_CELL);
          break;

        case 'cel':
          this.#drawCel(layer.cel, layer.top);
          break;
      }
    }
  }

  toRgba(into?: Uint8ClampedArray): Uint8ClampedArray {
    return this.display.toRgba(into);
  }

  /**
   * A lone cel, centred in the picture area.
   *
   * At the picture's own aspect, so an item's close-up is the same shape as the
   * sprite the player saw in the room. Transparent pixels are skipped, which is
   * what makes a close-up a picture of a thing rather than of a rectangle.
   */
  #drawCel(cel: Cel, top: number): void {
    const left = Math.floor((this.display.width - cel.width * PIXEL_ASPECT) / 2);
    const y0 = PICTURE_TOP + top;

    for (let y = 0; y < cel.height; y++) {
      for (let x = 0; x < cel.width; x++) {
        const colour = cel.pixels[y * cel.width + x]!;
        if (colour === TRANSPARENT) continue;
        this.display.fillRect(left + x * PIXEL_ASPECT, y0 + y, PIXEL_ASPECT, 1, colour);
      }
    }
  }
}
