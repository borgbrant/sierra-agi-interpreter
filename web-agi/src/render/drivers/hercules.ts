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
 * ## The dither, and the mapping that had to be thrown away
 *
 * Four pixels wide by two tall is eight pixels, and two colours give **nine**
 * densities for sixteen colours. Worse than the count suggests: six of AGI's
 * colours sit between luminance 51 and 104, so they crowd onto two of the nine.
 *
 * The first attempt was a pattern per colour -- density for lightness,
 * arrangement for the rest, which is what the photograph appears to show.
 * Rendering a swatch of all sixteen side by side is what settled it: green,
 * brown, dark grey and light blue came out as one grey, told apart only by
 * which pixel of eight was lit, and the eye does not read that at all.
 *
 * So the threshold varies with *where* a pixel is as well as which colour it
 * is: an ordered dither of sixty-four thresholds over a repeating matrix. A
 * region of one colour then averages to a grey of sixty-four rather than one
 * of nine, and every one of the sixteen gets a level of its own -- which is the
 * property M12 taught this project to want. A colour *identical* to its
 * background is an object that has vanished, and that is worse than a colour
 * merely being wrong.
 *
 * Every pixel still shows only its own colour's value. A dither spanning two
 * AGI pixels would have bought more levels still and given that up, and it is
 * not a trade worth making: the boundary between two colours is the thing a
 * mono renderer has least of to spare.
 *
 * ## The font is the one thing that cannot be derived
 *
 * `HGC_FONT` is not bundled. The repository ships the game's resource files,
 * and the font is an interpreter file -- so the shapes the original drew are
 * not available at any price, and there is no measurement that recovers them.
 * What this draws is the engine's own 8x8 IBM font in Hercules' 18x12 cell:
 * scaled to sixteen pixels wide, leaving two of letter spacing, and
 * top-aligned in the twelve rows. The letter spacing is a real feature of the
 * screenshot; the shapes are the IBM font's rather than Hercules'.
 */
import { Display } from '../display.ts';
import type { Frame } from '../frame.ts';
import { PICTURE_HEIGHT, PICTURE_WIDTH } from '../screens.ts';
import { TRANSPARENT, type Cel } from '../sprite.ts';
import { clearRows, drawText, drawWindow, type CellMetrics } from '../text.ts';
import { glyph } from '../font.ts';
import { HGC_GLYPH_WIDTH, type HgcFont } from '../hgcfont.ts';
import { PICTURE_ROW } from '../../engine/layout.ts';
import type { DisplayDriver, DisplayMode } from './driver.ts';

/** The adapter's own resolution. */
export const HERCULES_WIDTH = 720;
export const HERCULES_HEIGHT = 348;

/** What one AGI pixel becomes: four across, two down. */
export const DITHER_WIDTH = 4;
export const DITHER_HEIGHT = 2;

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
export const PICTURE_LEFT = (HERCULES_WIDTH - PICTURE_WIDTH * DITHER_WIDTH) / 2;

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
export const HERCULES_CELL_WIDTH = (PICTURE_WIDTH * DITHER_WIDTH) / 40;
export const HERCULES_CELL_HEIGHT = (PICTURE_HEIGHT * DITHER_HEIGHT) / 24;

/** The cell as drawn without `HGC_FONT`: the engine's own font, stretched. */
export const HERCULES_FALLBACK_CELL: CellMetrics = {
  width: HERCULES_CELL_WIDTH,
  height: HERCULES_CELL_HEIGHT,
  originX: PICTURE_LEFT,
  glyph,
};

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
 * The dither cell: eight pixels across, four down, over two AGI pixels each way.
 *
 * Four pixels wide by two tall is what one AGI pixel becomes, and on its own
 * that is eight pixels -- nine densities for sixteen colours, with six of AGI's
 * colours crowding onto two of them. Rendering a swatch of all sixteen side by
 * side is what settled that: green, brown, dark grey and light blue came out as
 * one grey.
 *
 * So the pattern repeats over a *block* of two AGI pixels each way instead: 32
 * pixels, 33 densities, and every pixel still shows only its own colour's
 * value. Nothing is blended with a neighbour -- a dither that averaged across
 * two AGI pixels would have bought the levels by giving up the boundary
 * between two colours, and on a two-colour display that boundary is the thing
 * there is least of to spare.
 */
export const PATTERN_WIDTH = 8;
export const PATTERN_HEIGHT = 4;

/** How many pixels one pattern holds, and so how many greys there are. */
export const HGC_LEVELS = PATTERN_WIDTH * PATTERN_HEIGHT;
export const HGC_PATTERN: readonly (readonly number[])[] = [
  [0b00000000, 0b00000000, 0b00000000, 0b00000000], //  0  black          luma   0   0/32  dispersed
  [0b10000000, 0b00000010, 0b00000000, 0b00000000], //  1  blue           luma  19   2/32  diagonal
  [0b11111111, 0b00000000, 0b11101010, 0b00000000], //  2  green          luma 100  13/32  horizontal
  [0b11111111, 0b00000000, 0b11111111, 0b00000000], //  3  cyan           luma 119  16/32  horizontal
  [0b11101110, 0b00000000, 0b00000000, 0b00000000], //  4  red            luma  51   6/32  horizontal
  [0b10101010, 0b01000000, 0b10101010, 0b00000000], //  5  magenta        luma  70   9/32  dispersed
  [0b10101010, 0b01010101, 0b10101010, 0b00010100], //  6  brown          luma 101  14/32  dispersed
  [0b11111111, 0b11101010, 0b11111111, 0b00000000], //  7  light grey     luma 170  21/32  horizontal
  [0b11100000, 0b10000011, 0b00001110, 0b00110000], //  8  dark grey      luma  85  11/32  diagonal
  [0b11110000, 0b11000011, 0b00001111, 0b00111000], //  9  light blue     luma 104  15/32  diagonal
  [0b11111111, 0b01010101, 0b11111110, 0b01010101], // 10  light green    luma 185  23/32  dispersed
  [0b11111110, 0b11111011, 0b11001111, 0b00111111], // 11  light cyan     luma 204  26/32  diagonal
  [0b11101010, 0b01010101, 0b10101010, 0b01010101], // 12  light red      luma 136  17/32  dispersed
  [0b11111000, 0b11100011, 0b10001111, 0b00111100], // 13  light magenta  luma 155  19/32  diagonal
  [0b11111111, 0b11111111, 0b11111111, 0b11101110], // 14  yellow         luma 236  30/32  horizontal
  [0b11111111, 0b11111111, 0b11111111, 0b11111111], // 15  white          luma 255  32/32  dispersed
];


/** Whether the pixel at a place is lit, for a colour. */
function lit(colour: number, x: number, y: number): number {
  const rows = HGC_PATTERN[colour & 0x0f]!;
  const bits = rows[y % PATTERN_HEIGHT]!;
  return (bits >> (PATTERN_WIDTH - 1 - (x % PATTERN_WIDTH))) & 1;
}

/**
 * Whether a colour is drawn lit or unlit where it cannot be dithered.
 *
 * Text, for the reason CGA has the same table: a glyph's stroke is a pixel or
 * two of its cell, and a dithered stroke is a stroke with holes in it. Split by
 * luminance at the midpoint, so a dark colour is ink on a light ground and a
 * light one is ink on a dark ground -- which is what the screenshot's status
 * bar and inverse input field both are.
 */
export function herculesSolid(colour: number): number {
  return LUMA[colour & 0x0f]! > 128 ? 1 : 0;
}

/** The luminance of each of AGI's sixteen, as the pattern densities used. */
const LUMA: readonly number[] = [
  0, 19, 100, 119, 51, 70, 101, 170, 85, 104, 185, 204, 136, 155, 236, 255,
];

/**
 * Ink and ground in two colours, guaranteed to differ.
 *
 * With two colours a collision is not a hazard but the common case: eight of
 * the sixteen are lit and eight are not, so any two from the same half would
 * be invisible against each other. The bundled game sets
 * `set.text.attribute(6, 0)` -- brown on black, both unlit -- in five places,
 * and this is what keeps those five lines on the screen.
 */
export function herculesTextColours(foreground: number, background: number): [number, number] {
  const ground = herculesSolid(background);
  const ink = herculesSolid(foreground);
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
  readonly pictureHeight = PICTURE_HEIGHT * DITHER_HEIGHT;

  /** @param font `HGC_FONT`, decoded, when the game came with it */
  constructor(font?: HgcFont) {
    this.cell = herculesCell(font);
  }

  draw(frame: Frame): void {
    for (const layer of frame.layers) {
      switch (layer.kind) {
        case 'fill':
          this.display.fill(herculesSolid(layer.colour));
          break;

        case 'rows':
          clearRows(
            this.display,
            layer.from,
            layer.to,
            herculesSolid(layer.colour),
            this.cell,
          );
          break;

        case 'picture':
          this.#drawScreen(layer.screen, layer.row * this.cell.height);
          break;

        case 'cel':
          this.#drawCel(layer.cel, PICTURE_ROW * this.cell.height + layer.top * DITHER_HEIGHT);
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
   * The picture: every AGI pixel as its four-by-two pattern.
   *
   * Centred horizontally, because 160 pixels four times over is 640 and the
   * screen is 720. The eighty pixels that are left stay unlit, which is what
   * the screenshot shows either side of the scene.
   */
  #drawScreen(screen: ArrayLike<number>, top: number): void {
    for (let y = 0; y < PICTURE_HEIGHT; y++) {
      for (let sub = 0; sub < DITHER_HEIGHT; sub++) {
        const destRow = top + y * DITHER_HEIGHT + sub;
        if (destRow < 0 || destRow >= this.display.height) continue;

        let at = destRow * this.display.width + this.pictureLeft;
        for (let x = 0; x < PICTURE_WIDTH; x++) {
          const colour = screen[y * PICTURE_WIDTH + x]!;
          for (let n = 0; n < DITHER_WIDTH; n++, at++) {
            this.display.pixels[at] = lit(colour, x * DITHER_WIDTH + n, destRow);
          }
        }
      }
    }
  }

  /** An item's close-up, dithered the same way and centred. */
  #drawCel(cel: Cel, top: number): void {
    const left = Math.floor((this.display.width - cel.width * DITHER_WIDTH) / 2);

    for (let y = 0; y < cel.height; y++) {
      for (let sub = 0; sub < DITHER_HEIGHT; sub++) {
        const destRow = top + y * DITHER_HEIGHT + sub;
        if (destRow < 0 || destRow >= this.display.height) continue;

        for (let x = 0; x < cel.width; x++) {
          const colour = cel.pixels[y * cel.width + x]!;
          if (colour === TRANSPARENT) continue;

          let at = destRow * this.display.width + left + x * DITHER_WIDTH;
          for (let n = 0; n < DITHER_WIDTH; n++, at++) {
            this.display.pixels[at] = lit(colour, x * DITHER_WIDTH + n, destRow);
          }
        }
      }
    }
  }
}
