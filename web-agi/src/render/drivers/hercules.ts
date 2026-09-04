/**
 * Hercules: 720x348, two colours, its own cell, and a screen with no room at
 * the bottom.
 *
 * The mode the seam of M10 was designed against, and the only one that moves
 * size, cell shape and layout at once. It is also the only one this project has
 * ever had a photograph of: a screenshot of the real thing, which turned a
 * milestone the plan expected to judge purely by eye into one with a reference
 * to check against.
 *
 * ## The geometry, and how exactly it fits
 *
 * Every number below follows from two facts -- Hercules is 720x348, and
 * `HGC_FONT` is 3072 bytes, which is 256 glyphs of twelve rows. Nothing here is
 * a preference:
 *
 * ```text
 * the picture at 4x wide, 2x tall    640 x 336
 * unlit either side                  (720 - 640) / 2 = 40 pixels
 * the grid across the picture        40 columns of 16, not of 18
 * AGI's rows 1 to 24 are the         336 over 24 rows is a 14-row cell
 *   picture, exactly
 * ```
 *
 * The photographs settle all four. The picture is 640 of 720 wide -- 88.9% --
 * and they show unlit margins of about that fraction either side. It reaches
 * the **bottom** of the screen, with no dead band beneath it. Its text is
 * conspicuously letter-spaced. And the status bar is exactly as wide as the
 * scene, with the game's bottom band starting at the scene's left edge rather
 * than the screen's -- so the grid is laid across the picture's 640 pixels
 * rather than across all 720, which is what makes the cell 16 wide and not 18.
 *
 * The row height follows from the last of those. If the picture is 336 rows and
 * AGI's rows 1 to 24 are the picture, each row is 14 -- and then row 24 ends at
 * the bottom of the screen, so the three rows AGI keeps for its prompt are the
 * screen's last three. That is where the photographs put the game's bottom
 * band: flush with the bottom edge, not floating a few rows above it.
 *
 * 640x336 is 1.905:1, the same proportion EGA shows the picture at with
 * 320x168, so this driver asks for square pixels like EGA even though its
 * buffer is nothing like EGA's. Twenty-five 14-row cells is 350, two past a
 * 348-row card, so the last two pixels of row 24 fall off the bottom.
 *
 * The game's rows 22 to 24 therefore have scene behind them, which is why
 * `clear.lines` had to be looked at: the game paints those rows black before
 * printing on them, and an engine that made them *transparent* instead put the
 * band on the scene. See `engine/commands/text.ts` -- and `show.pic`, which is
 * what takes the band away again.
 *
 * ## Why the command line is a box
 *
 * Because there is no row to put it on: the picture reaches the bottom of the
 * screen, so the three rows AGI keeps for its prompt have scene behind them.
 * The photographs show what the original did instead -- `ENTER COMMAND` centred
 * over the scene with the typed line beneath in inverse video.
 *
 * The game's own bottom band shares those rows and gets there by painting them
 * black first. The interpreter's command line does not paint; it draws a box.
 *
 * That box is the *interpreter's*, not the game's. Checked rather than assumed:
 * no message in any of the 46 LOGIC resources contains the words "enter
 * command", so no script can be printing it.
 *
 * It is not drawn from here, and not from the frame either. Because it covers
 * the scene it has to stop the scene: it is an `Interaction`, opened by the
 * keystroke that would otherwise have gone onto an input row, and the cycle
 * parks on it until the line is handed over. See `CommandLine` in
 * `engine/interaction.ts`, which is also where the reason it carries no `]`
 * is written down.
 *
 * ## The dither, which is the interpreter's own
 *
 * The table is 128 bytes at offset `0x1bea` of `AGIDATA.OVL`, and every one of
 * AGI's sixteen colours has a pattern in it: ten distinct densities from 0/64
 * to 64/64 over an 8x8 cell of device pixels. See `render/hgcdither.ts`
 * for how `HGC_GRAF.OVL` indexes it and how the layout was read off that code.
 *
 * Two wrong tables came before it, and both are worth knowing about because
 * both looked careful. M13 derived densities from luminance and handed out
 * three weaves by rule. M15 measured densities off the captures instead and
 * concluded that thirteen colours were solid -- which is what a capture says if
 * you threshold its pixels, because a one-pixel checkerboard is smoothed into a
 * flat half-tone before it ever reaches the PNG. Light grey then reads as solid
 * amber and cyan as solid black. The captures do corroborate the file's table,
 * but through brightness rather than through bits.
 *
 * ## Both of its files are optional, and both are read when they are there
 *
 * `HGC_FONT` and the dither table in `AGIDATA.OVL` belong to the interpreter
 * rather than to the game, so a copy of LSL1 need not include them and the
 * build copies them only when it finds them. Absent, the font falls back to
 * the engine's own 8x8 IBM font stretched into the 16x14 cell -- which reads as
 * exactly what it is -- and the table falls back to the bytes LSL1's own copy
 * holds. Present, both are the original's.
 */
import { Display } from '../display.ts';
import type { Frame } from '../frame.ts';
import { PICTURE_HEIGHT, PICTURE_WIDTH } from '../screens.ts';
import { TRANSPARENT, type Cel } from '../sprite.ts';
import { clearRows, drawText, drawWindow, type CellMetrics } from '../text.ts';
import { glyph } from '../font.ts';
import { HGC_GLYPH_WIDTH, type HgcFont } from '../hgcfont.ts';
import {
  ditherDensity,
  ditherLit,
  HGC_CELL_HEIGHT,
  HGC_CELL_WIDTH,
  HGC_DITHER,
  HGC_LEVELS,
  type HgcDither,
} from '../hgcdither.ts';
import { PICTURE_ROW } from '../../engine/layout.ts';
import type { DisplayDriver, DisplayMode } from './driver.ts';

/** The adapter's own resolution. */
export const HERCULES_WIDTH = 720;
export const HERCULES_HEIGHT = 348;

/** What one AGI pixel becomes: four across, two down. */
export const HGC_PIXEL_WIDTH = 4;
export const HGC_PIXEL_HEIGHT = 2;

/**
 * Unlit, and amber.
 *
 * The phosphor belonged to the monitor rather than to the card, and amber and
 * green were both common -- but every photograph of this game on a Hercules is
 * amber, so amber it is. `#FFB000` is the value amber CRTs are conventionally
 * emulated at.
 */
export const HERCULES_PALETTE_RGB = new Uint8Array([
  0, 0, 0, // 0  unlit
  255, 176, 0, // 1  lit
]);

/**
 * Where the picture's left edge is, and with it the whole character grid.
 *
 * 160 pixels four times over is 640, and the screen is 720, so the scene is
 * centred with forty pixels unlit either side. The **text goes with it**: the
 * photographs show the status bar exactly as wide as the picture, and the
 * game's bottom band starting at the scene's left edge rather than the
 * screen's. So the 40 columns are laid across the picture's 640 rather than
 * across all 720, which makes the cell 16 wide.
 */
export const PICTURE_LEFT = (HERCULES_WIDTH - PICTURE_WIDTH * HGC_PIXEL_WIDTH) / 2;

/**
 * Hercules' character cell: 16 wide by 14 tall, holding a 16 by 12 glyph.
 *
 * All four numbers are arithmetic rather than taste, and two of them are the
 * font file's own:
 *
 * ```text
 * 16 wide     640 of picture across 40 columns
 * 14 tall     AGI's rows 1 to 24 are the picture, and 336 over 24 is 14
 * 16 wide     HGC_FONT's glyphs, natively -- two bytes a row
 * 12 tall     3072 bytes over 128 glyphs of two-byte rows
 * ```
 *
 * The cell being exactly as wide as the glyph is the confirmation worth
 * having: 640 pixels of picture over 40 columns was derived from photographs,
 * and `HGC_FONT` turns out to hold 16-wide glyphs. Two independent numbers, and
 * they agree.
 *
 * The last two rows of the cell are the leading, and the letter spacing is the
 * font's own -- it draws its characters inside its 16 columns and leaves the
 * air itself, exactly as the photographs show.
 *
 * Without the file the cell falls back to the engine's own 8x8 font, stretched
 * across the width and sitting in the top eight rows. That reads as the wrong
 * font because it *is* the wrong font, and the shell says so.
 *
 * The second row is the one that puts the game's bottom band where the
 * photographs have it. Rows 1 to 24 of the grid are exactly the 336 rows of
 * picture, so row 24 ends at the bottom of the screen and rows 22 to 24 are the
 * last three -- the band sits on the screen's bottom edge rather than floating
 * a few rows above it.
 */
export const HERCULES_CELL_WIDTH = (PICTURE_WIDTH * HGC_PIXEL_WIDTH) / 40;
export const HERCULES_CELL_HEIGHT = (PICTURE_HEIGHT * HGC_PIXEL_HEIGHT) / 24;

/** The cell as drawn without `HGC_FONT`: the engine's own font, stretched. */
export const HERCULES_FALLBACK_CELL: CellMetrics = {
  width: HERCULES_CELL_WIDTH,
  height: HERCULES_CELL_HEIGHT,
  originX: PICTURE_LEFT,
  glyph,
};

/** The default Hercules cell, kept under the original test-facing name. */
export const HERCULES_CELL = HERCULES_FALLBACK_CELL;

/** The cell as drawn with the font file: one glyph bit per pixel. */
export function herculesCell(font: HgcFont | undefined): CellMetrics {
  if (!font) return HERCULES_FALLBACK_CELL;
  return {
    width: HERCULES_CELL_WIDTH,
    height: HERCULES_CELL_HEIGHT,
    originX: PICTURE_LEFT,
    glyphBits: HGC_GLYPH_WIDTH,
    glyph: (code) => font.glyph(code),
  };
}

/**
 * The dither, and where it finally came from.
 *
 * `render/hgcdither.ts` has the whole story: the table is 128 bytes at offset
 * `0x1bea` of `AGIDATA.OVL`, indexed by the blit in `HGC_GRAF.OVL` as
 * `colour * 8 + (row and 3) * 2`, and every one of AGI's sixteen colours has a
 * pattern. Ten distinct densities from 0/64 to 64/64, and no threshold
 * anywhere in it.
 *
 * This driver had two wrong tables before that file was opened. M13 derived
 * densities from luminance and handed out three weaves by rule. M15 measured
 * densities off the captures and concluded thirteen colours were solid, which
 * is what a capture says if you threshold its pixels: a one-pixel checkerboard
 * is smoothed into a flat half-tone before it reaches the PNG, so light grey
 * reads as solid amber and cyan as solid black. Reading the captures' *
 * brightness* instead agrees with the file's table at R^2 = 0.95.
 *
 * The pattern is anchored to the picture's own origin, not the screen's, which
 * is what the original's arithmetic does: its row phase is the AGI row and its
 * columns start where the picture starts.
 */
export const PATTERN_WIDTH = HGC_CELL_WIDTH;
export const PATTERN_HEIGHT = HGC_CELL_HEIGHT;

/** How many pixels one cell holds, and so the denominator of its density. */
export { HGC_LEVELS } from '../hgcdither.ts';

/** Whether the pixel at a place is lit, for a colour. */
function lit(table: HgcDither, colour: number, x: number, y: number): number {
  return ditherLit(table, colour, x, y);
}

/**
 * Whether a colour is drawn lit or unlit where it cannot be dithered.
 *
 * Text, for the reason CGA has the same table: a glyph's stroke is a pixel or
 * two of its cell, and a dithered stroke is a stroke with holes in it. Split at
 * half the density, so light grey's checkerboard becomes ink and brown's
 * diagonal becomes ground -- which is what the captures' status bar and inverse
 * input field are.
 */
export function herculesSolid(colour: number, table: HgcDither = HGC_DITHER): number {
  return ditherDensity(table, colour) * 2 >= HGC_LEVELS ? 1 : 0;
}

/**
 * Ink and ground in two colours, guaranteed to differ.
 *
 * With two colours a collision is not a hazard but the common case: eight of
 * the sixteen are lit and eight are not, so any two from the same half would
 * be invisible against each other. The bundled game sets
 * `set.text.attribute(6, 0)` -- brown on black, both unlit -- in five places,
 * and this is what keeps those five lines on the screen.
 */
export function herculesTextColours(
  foreground: number,
  background: number,
  table: HgcDither = HGC_DITHER,
): [number, number] {
  const ground = herculesSolid(background, table);
  const ink = herculesSolid(foreground, table);
  return [ink === ground ? 1 - ground : ink, ground];
}

export class HerculesDriver implements DisplayDriver {
  readonly mode: DisplayMode = 'hercules';

  /**
   * The character cell, which is the font's as well as the geometry's.
   *
   * Held per driver rather than as a constant because whether `HGC_FONT` was
   * bundled is not known until it has been read, and a driver built before
   * then would have to be rebuilt. The renderer builds one when the mode
   * changes, so the font arrives with it.
   */
  readonly cell: CellMetrics;
  readonly display = new Display(HERCULES_WIDTH, HERCULES_HEIGHT, HERCULES_PALETTE_RGB);

  /**
   * Square, like EGA's, and for the same reason: the correction has already
   * happened. Four across by two down is the same two-to-one EGA stretches by,
   * so 640x336 is the picture's own 1.905:1 -- the same shape EGA draws at
   * 320x168, with four times the pixels.
   */
  readonly pixelAspect = 1;

  readonly monochrome = true;

  /** Where the picture sits, once it is centred in a wider screen. */
  readonly pictureLeft = PICTURE_LEFT;

  /** How tall the picture is in device rows. */
  readonly pictureHeight = PICTURE_HEIGHT * HGC_PIXEL_HEIGHT;

  /**
   * The dither table, which is the interpreter's rather than this project's.
   *
   * Held per driver for the same reason the cell is: whether `AGIDATA.OVL` was
   * bundled is not known until it has been read, and the renderer builds a
   * driver when the mode changes, so the table arrives with it. Absent, the
   * bytes LSL1's own copy holds are used.
   *
   * @param font   `HGC_FONT`, decoded, when the game came with it
   * @param dither `AGIDATA.OVL`'s table, when the game came with it
   */
  readonly dither: HgcDither;

  constructor(font?: HgcFont, dither: HgcDither = HGC_DITHER) {
    this.cell = herculesCell(font);
    this.dither = dither;
  }

  draw(frame: Frame): void {
    for (const layer of frame.layers) {
      switch (layer.kind) {
        case 'fill':
          this.display.fill(herculesSolid(layer.colour, this.dither));
          break;

        case 'rows':
          clearRows(
            this.display,
            layer.from,
            layer.to,
            herculesSolid(layer.colour, this.dither),
            this.cell,
          );
          break;

        case 'picture':
          this.#drawScreen(layer.screen, layer.row * this.cell.height);
          break;

        case 'cel':
          this.#drawCel(layer.cel, PICTURE_ROW * this.cell.height + layer.top * HGC_PIXEL_HEIGHT);
          break;

        case 'cells':
          layer.cells.draw(this.display, this.cell, herculesTextColours);
          break;

        case 'text': {
          const [ink, ground] = herculesTextColours(layer.foreground, layer.background);
          drawText(
            this.display,
            layer.text,
            layer.column,
            layer.row,
            ink,
            ground,
            this.cell,
          );
          break;
        }

        case 'window': {
          const [ink, ground] = herculesTextColours(
            layer.window.foreground,
            layer.window.background,
          );
          // The rule round the box is red on EGA and has nowhere to go here, so
          // it takes the ink's colour: a line, rather than a colour.
          drawWindow(
            this.display,
            { ...layer.window, foreground: ink, background: ground, border: ink },
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
   * The picture: every AGI pixel as four device pixels across and two down,
   * lit or unlit.
   *
   * Centred horizontally, because 160 pixels four times over is 640 and the
   * screen is 720. The eighty pixels that are left stay unlit, which is what
   * the captures show either side of the scene. All eight pixels of an AGI
   * pixel take the same value -- since M15 there is no pattern for the place
   * within it to index.
   */
  #drawScreen(screen: ArrayLike<number>, top: number): void {
    for (let y = 0; y < PICTURE_HEIGHT; y++) {
      for (let sub = 0; sub < HGC_PIXEL_HEIGHT; sub++) {
        const destRow = top + y * HGC_PIXEL_HEIGHT + sub;
        if (destRow < 0 || destRow >= this.display.height) continue;

        let at = destRow * this.display.width + this.pictureLeft;
        for (let x = 0; x < PICTURE_WIDTH; x++) {
          const colour = screen[y * PICTURE_WIDTH + x]!;
          for (let n = 0; n < HGC_PIXEL_WIDTH; n++, at++) {
            this.display.pixels[at] = lit(this.dither, colour, x * HGC_PIXEL_WIDTH + n, destRow);
          }
        }
      }
    }
  }

  /** An item's close-up, through the same patterns and centred. */
  #drawCel(cel: Cel, top: number): void {
    const left = Math.floor((this.display.width - cel.width * HGC_PIXEL_WIDTH) / 2);

    for (let y = 0; y < cel.height; y++) {
      for (let sub = 0; sub < HGC_PIXEL_HEIGHT; sub++) {
        const destRow = top + y * HGC_PIXEL_HEIGHT + sub;
        if (destRow < 0 || destRow >= this.display.height) continue;

        for (let x = 0; x < cel.width; x++) {
          const colour = cel.pixels[y * cel.width + x]!;
          if (colour === TRANSPARENT) continue;

          let at = destRow * this.display.width + left + x * HGC_PIXEL_WIDTH;
          for (let n = 0; n < HGC_PIXEL_WIDTH; n++, at++) {
            this.display.pixels[at] = lit(this.dither, colour, x * HGC_PIXEL_WIDTH + n, destRow);
          }
        }
      }
    }
  }
}
