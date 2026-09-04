/**
 * CGA in two colours: 640x200, and the mode the game's own menu item asks for.
 *
 * Not a fourth adapter and not a setting a player picks. The Options menu gains
 * **"Graphics Mode <Ctrl-R>" only on CGA** -- M11 measured that -- and choosing
 * it calls `toggle.monitor`, which flips the monitor variable between mono and
 * the chosen display. On the original that flipped the card: `CGA_GRAF.OVL`
 * sets 320x200 in four colours when its flag is 1 and writes the mode register
 * directly otherwise:
 *
 * ```text
 * out 3d8h, 1ah    bit 1 graphics, bit 3 enable, bit 4 high resolution
 * out 3d9h, 27h    the low nibble is the foreground colour: 7, light grey
 * ```
 *
 * So this is what `Ctrl-R` was for, and until M16 the engine answered it by
 * changing what the scripts were told and nothing about the picture.
 *
 * ## The geometry, which is arithmetic
 *
 * ```text
 * 640x200, one bit a pixel
 * the picture at 4x wide, 1x tall   640 x 168, where four colours give 320x168
 * the grid                          40 columns of 16, 25 rows of 8
 * the glyph                         the engine's 8x8 font, doubled across
 * the pixel                         half as wide as the four-colour mode's,
 *                                   because twice as many span the same tube
 * ```
 *
 * A nibble of the dither table is one AGI pixel here, exactly as it is in four
 * colours -- four pixels of one bit rather than two of two. That is why one
 * table serves both modes and why the tables are tables of nibbles; see
 * `render/cgatables.ts`.
 *
 * ## Two colours, sixteen patterns
 *
 * The table at `0x1ba8` is a permutation of all sixteen nibble values, so every
 * one of AGI's colours gets a pattern of its own and no two are identical --
 * which is more than either of the other two modes manages. What it cannot do
 * is keep them *ordered*: sixteen colours over five densities means eleven
 * pairs share a density, and a pattern is all that separates them. Nothing
 * disappears; plenty is merely wrong.
 */
import {
  CGA_MONO_PIXELS,
  CGA_TABLES,
  monoDensity,
  monoLit,
  type CgaTables,
} from '../cgatables.ts';
import { Display } from '../display.ts';
import { glyph } from '../font.ts';
import type { Frame } from '../frame.ts';
import { PICTURE_HEIGHT, PICTURE_WIDTH } from '../screens.ts';
import { TRANSPARENT, type Cel } from '../sprite.ts';
import { clearRows, drawText, drawWindow, type CellMetrics } from '../text.ts';
import { PICTURE_ROW } from '../../engine/layout.ts';
import type { DisplayDriver, DisplayMode } from './driver.ts';

/** The card's own high-resolution size. */
export const CGA_MONO_WIDTH = PICTURE_WIDTH * CGA_MONO_PIXELS;
export const CGA_MONO_HEIGHT = 200;

/**
 * Unlit, and the foreground the mode register asks for.
 *
 * `out 3d9h, 27h` puts 7 in the low nibble, and in 640x200 that nibble is the
 * foreground colour: CGA's light grey. Not white -- the intensity bit is not
 * set -- which is a detail worth keeping, because it is the one place a CGA
 * shows a colour this palette otherwise cannot reach.
 */
export const CGA_MONO_PALETTE_RGB = new Uint8Array([
  0, 0, 0, // 0  unlit
  170, 170, 170, // 1  light grey
]);

/** Forty columns across 640 pixels, and twenty-five rows down 200. */
export const CGA_MONO_CELL: CellMetrics = {
  width: CGA_MONO_WIDTH / 40,
  height: CGA_MONO_HEIGHT / 25,
  glyph,
};

/**
 * Whether a colour is drawn lit or unlit where it cannot be dithered.
 *
 * Text, for the reason every mode here has the same table: a glyph's stroke is
 * one or two pixels of its cell, and a dithered stroke is a stroke with holes
 * in it. Split at half the density, which is two of the four pixels.
 */
export function cgaMonoSolid(colour: number, tables: CgaTables = CGA_TABLES): number {
  return monoDensity(tables.mono[colour & 0x0f]!) * 2 >= CGA_MONO_PIXELS ? 1 : 0;
}

/**
 * Ink and ground in two colours, guaranteed to differ.
 *
 * With two colours a collision is the common case rather than a hazard, and the
 * bundled game sets `set.text.attribute(6, 0)` -- brown on black -- in five
 * places. Brown's density is 1/4 and black's 0/4, so both are unlit, and this
 * is what keeps those five lines on the screen.
 */
export function cgaMonoTextColours(
  foreground: number,
  background: number,
  tables: CgaTables = CGA_TABLES,
): [number, number] {
  const ground = cgaMonoSolid(background, tables);
  const ink = cgaMonoSolid(foreground, tables);
  return [ink === ground ? 1 - ground : ink, ground];
}

export class CgaMonoDriver implements DisplayDriver {
  /**
   * Still CGA to everything above the seam.
   *
   * The mode is what the shell chose and what the scripts are told about; this
   * driver is the *card's* mode, which the game changes under both of them. A
   * fourth `DisplayMode` would put a display in the shell's select that no
   * player ever picked.
   */
  readonly mode: DisplayMode = 'cga';

  readonly display = new Display(CGA_MONO_WIDTH, CGA_MONO_HEIGHT, CGA_MONO_PALETTE_RGB);

  /**
   * Half the four-colour mode's, which presents at the same size.
   *
   * The canvas sizes to the largest whole multiple that fits and applies the
   * aspect across: 640 at 0.5 and 320 at 1 come out the same width, which is
   * what the same tube showing twice the pixels means.
   */
  readonly pixelAspect: number = 0.5;

  readonly monochrome: boolean = true;

  readonly cell = CGA_MONO_CELL;

  #tables: CgaTables;

  /** @param tables `AGIDATA.OVL`'s tables, when the game came with them */
  constructor(tables: CgaTables = CGA_TABLES) {
    this.#tables = tables;
  }

  draw(frame: Frame): void {
    for (const layer of frame.layers) {
      switch (layer.kind) {
        case 'fill':
          this.#fillRows(0, this.display.height, layer.colour);
          break;

        case 'rows': {
          const from = layer.from * this.cell.height;
          const to = Math.min((layer.to + 1) * this.cell.height, this.display.height);
          this.#fillRows(from, to, layer.colour);
          break;
        }

        case 'picture':
          this.#drawScreen(layer.screen, layer.row * this.cell.height);
          break;

        case 'cel':
          this.#drawCel(layer.cel, PICTURE_ROW * this.cell.height + layer.top);
          break;

        case 'cells':
          layer.cells.draw(this.display, this.cell, (ink, ground) =>
            cgaMonoTextColours(ink, ground, this.#tables));
          break;

        case 'text': {
          const [ink, ground] = cgaMonoTextColours(
            layer.foreground,
            layer.background,
            this.#tables,
          );
          drawText(this.display, layer.text, layer.column, layer.row, ink, ground, this.cell);
          break;
        }

        case 'window': {
          const [ink, ground] = cgaMonoTextColours(
            layer.window.foreground,
            layer.window.background,
            this.#tables,
          );
          const [rule] = cgaMonoTextColours(
            layer.window.border,
            layer.window.background,
            this.#tables,
          );
          drawWindow(
            this.display,
            { ...layer.window, foreground: ink, background: ground, border: rule },
            this.cell,
          );
          break;
        }
      }
    }
  }

  toRgba(into?: Uint8ClampedArray): Uint8ClampedArray {
    return this.display.toRgba(into);
  }

  /**
   * A band of rows in a colour's fill pattern.
   *
   * The two-colour fill column of the table, which is the same nibble the
   * picture draws with -- the two tables agreeing there is what checks both.
   * So a fill and a picture region of one colour are the same texture here,
   * unlike the four-colour mode where they are not.
   */
  #fillRows(from: number, to: number, colour: number): void {
    const nibble = this.#tables.mono[colour & 0x0f]!;

    for (let y = Math.max(0, from); y < to; y++) {
      let at = y * this.display.width;
      for (let x = 0; x < this.display.width; x++, at++) {
        this.display.pixels[at] = monoLit(nibble, x % CGA_MONO_PIXELS);
      }
    }
  }

  /**
   * The picture: every AGI pixel as four pixels of one bit.
   *
   * No row phase, because `CGA_GRAF.OVL` has none. A region of one colour is
   * the same four pixels on every row of it.
   */
  #drawScreen(screen: ArrayLike<number>, top: number): void {
    for (let y = 0; y < PICTURE_HEIGHT; y++) {
      const destRow = top + y;
      if (destRow < 0 || destRow >= this.display.height) continue;

      let at = destRow * this.display.width;
      const source = y * PICTURE_WIDTH;

      for (let x = 0; x < PICTURE_WIDTH; x++) {
        const nibble = this.#tables.mono[screen[source + x]! & 0x0f]!;
        for (let pixel = 0; pixel < CGA_MONO_PIXELS; pixel++, at++) {
          this.display.pixels[at] = monoLit(nibble, pixel);
        }
      }
    }
  }

  /** An item's close-up, through the same patterns and centred. */
  #drawCel(cel: Cel, top: number): void {
    const left = Math.floor((this.display.width - cel.width * CGA_MONO_PIXELS) / 2);

    for (let y = 0; y < cel.height; y++) {
      const destRow = top + y;
      if (destRow < 0 || destRow >= this.display.height) continue;

      for (let x = 0; x < cel.width; x++) {
        const colour = cel.pixels[y * cel.width + x]!;
        if (colour === TRANSPARENT) continue;

        const nibble = this.#tables.mono[colour & 0x0f]!;
        let at = destRow * this.display.width + left + x * CGA_MONO_PIXELS;
        for (let pixel = 0; pixel < CGA_MONO_PIXELS; pixel++, at++) {
          this.display.pixels[at] = monoLit(nibble, pixel);
        }
      }
    }
  }
}
