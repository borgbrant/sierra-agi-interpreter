/**
 * CGA: four colours, and the sixteen the game draws in reached by dithering.
 *
 * The mode where the seam earns its keep, because nothing above it changes and
 * everything below it does. The picture is still 160x168 and the text is still
 * a 40x25 grid of 8x8 cells; what differs is that a colour is no longer one
 * pixel of one colour.
 *
 * ## The dither, and why it is free
 *
 * An AGI pixel is twice as wide as it is tall, so the EGA driver spends its
 * 320-pixel width duplicating each of the picture's 160 pixels. CGA spends the
 * same two pixels on *colour* instead: a pair drawn from four colours, which
 * blends at the size the canvas presents it. Nothing is given up to make room
 * for it, which is why this is the mode AGI could offer without redrawing a
 * single picture.
 *
 * ## The table is the interpreter's, and so is the palette
 *
 * Both are read out of `AGIDATA.OVL` -- see `render/cgatables.ts` for the three
 * tables, the code in `CGA_GRAF.OVL` that indexes them, and why each belongs to
 * the mode it belongs to. Nothing here is derived any more except the one table
 * the original keeps somewhere this project has not found: the solid colour
 * text is drawn in.
 *
 * M12 derived the mapping instead, because the overlays were thought to be
 * unavailable, and it scored all four hardware palettes against the colours
 * this game draws. That work is worth keeping in mind for what it got right and
 * for how it went wrong:
 *
 * ```text
 * palette                        colour error  boundaries lost   M12 ranked
 * 1 low   black/cyan/magenta/grey       113.2M            4.3%      first
 * 1 high  black/lcyan/lmagenta/white    117.4M           13.8%      second
 * 0 high  black/lgreen/lred/yellow      129.7M           13.1%      third
 * 0 low   black/green/red/brown         203.2M           19.7%      last
 * ```
 *
 * The original selects **palette 0 at low intensity** -- the one that scored
 * last of four, by a factor of two on colour error -- and then sets the
 * background register to colour 1, so the darkest of its four colours is blue
 * rather than black. A metric that ranks the answer last is not a broken
 * metric; it is a metric answering a different question. Sierra were not
 * minimising colour error against an EGA reference. They were choosing four
 * colours that keep sixteen *distinguishable*, on a screen where a wrong hue
 * costs less than a shape that disappears.
 *
 * ## What the mapping costs, and where it is spent
 *
 * Two colours from four is ten distinct blends, not sixteen, so some of the
 * sixteen must share an appearance. The original's table spends that on three
 * groups, and the first is the expensive one: **black, blue and dark grey all
 * become the background**, which is every dark thing in the game flattening
 * into one. `CGA_COLLISIONS` records what each group costs in boundary pixels
 * of the game's own pictures, and `cga.test.ts` recomputes it.
 *
 * ## Stripes, not a checkerboard
 *
 * M12 swapped the pair on alternate rows so that a region read as a
 * checkerboard, on the argument that two one-pixel stripes are the same colour
 * on average and a visibly worse texture. `CGA_GRAF.OVL` has no row phase
 * anywhere -- `HGC_GRAF.OVL` masks the row with `and dx, 3` and this one has no
 * such instruction -- so the original is vertical stripes, identical on every
 * row. The argument was right and the card did the other thing, and in a
 * simulation of a card that settles it.
 *
 * ## Fills are dithered too, from a table of their own
 *
 * The original's fill routine reads a third table, and in four colours it fills
 * with *two* alternating patterns where the picture uses one. So the background
 * behind text is a dither rather than a flat colour, and it reaches fifteen
 * distinct appearances where the picture reaches thirteen. Text itself stays
 * solid: a glyph stroke is one or two pixels of an eight-pixel cell, and a
 * dithered stroke is a stroke with holes in it.
 */
import { CGA_TABLES, colourPixels, type CgaTables } from '../cgatables.ts';
import { Display, DISPLAY_WIDTH, DISPLAY_HEIGHT, PIXEL_ASPECT } from '../display.ts';
import type { Frame } from '../frame.ts';
import { PICTURE_HEIGHT, PICTURE_WIDTH } from '../screens.ts';
import { TRANSPARENT, type Cel } from '../sprite.ts';
import { clearRows, drawText, drawWindow, IBM_CELL } from '../text.ts';
import { PICTURE_ROW } from '../../engine/layout.ts';
import type { DisplayDriver, DisplayMode } from './driver.ts';

/**
 * The four colours the original selects: palette 0 at low intensity, on a blue
 * background.
 *
 * Read off the mode-setting code rather than chosen. `CGA_GRAF.OVL` makes two
 * BIOS calls when it puts the card in the four-colour mode:
 *
 * ```text
 * int 10h ah=0Bh bx=0001h    background/border register to colour 1
 * int 10h ah=0Bh bx=0100h    palette 0
 * ```
 *
 * In 320x200 the background register *is* colour 0 of the palette, so colour 0
 * is CGA's blue and 1 to 3 are palette 0's green, red and brown. Nothing in the
 * game is drawn in black on a CGA: the darkest thing on the screen is blue.
 */
export const CGA_PALETTE_RGB = new Uint8Array([
  0, 0, 170, // 0  blue      the background register, set to 1
  0, 170, 0, // 1  green     palette 0, low intensity
  170, 0, 0, // 2  red
  170, 85, 0, // 3  brown
]);

/**
 * The two CGA colours each of AGI's sixteen is drawn as, left pixel first.
 *
 * The four-colour picture table of `AGIDATA.OVL`, unpacked: one nibble a
 * colour, its high two bits the left pixel and its low two the right. The
 * comment on each line is what the pair blends to under the palette above, so
 * a wrong entry is a visible diff rather than a number to take on trust.
 *
 * Three of them are solid -- red, light green and yellow land on a single CGA
 * colour each -- and three groups collide. The order within a pair matters to
 * nothing but the phase of the stripe, and the original still chose one.
 */
export const CGA_DITHER: readonly (readonly [number, number])[] =
  CGA_TABLES.colour.map((nibble) => colourPixels(nibble));

/**
 * The pattern a fill uses, which is not the pattern the picture uses.
 *
 * Two nibbles a colour: the left AGI pixel's and the right's. The original's
 * fill routine combines them into one byte, so a filled region alternates
 * between two patterns across its width and reaches distinctions the picture
 * cannot -- green fills as 1,0 then 1,1, which is three quarters green, where
 * the picture draws it 3,0.
 */
export const CGA_FILL: readonly (readonly [[number, number], [number, number]])[] =
  CGA_TABLES.fill.map(([left, right]) => [colourPixels(left), colourPixels(right)]);

/**
 * Which colours end up looking the same, and what that costs.
 *
 * Kept beside the table rather than left to be rediscovered, and the counts are
 * boundary pixels in the bundled game that vanish because of them.
 * `cga.test.ts` recomputes the list from the table and the game's pictures, so
 * the two cannot drift apart.
 *
 * The first group is nine tenths of the whole cost. **Black, blue and dark grey
 * are all the background**, and black meets blue in 27,614 places -- the game's
 * night skies, its shadows, and every dark thing drawn against another dark
 * thing. M12's derived table lost 11,335 boundary pixels in total; the
 * original's loses 30,549, which is 11% of every boundary in the game against
 * M12's 4%.
 *
 * That is the price of fidelity here and it is not a small one. It is also not
 * this project's to negotiate: the original flattened those three into one, and
 * a player on a CGA in 1987 saw them flattened.
 */
export const CGA_COLLISIONS: readonly { colours: readonly number[]; lostEdges: number }[] = [
  { colours: [0, 1, 8], lostEdges: 27619 }, // all three are the background
  { colours: [12, 13], lostEdges: 654 }, // light red = light magenta
  { colours: [14, 15], lostEdges: 2276 }, // yellow = white, both solid brown
];

/**
 * What the table costs in the bundled game, as measured.
 *
 * Recorded so a change to the table can be judged rather than guessed at:
 * `cga.test.ts` recomputes both from the game's own pictures and fails if
 * either drifts.
 */
export const CGA_COST = {
  /** Boundary pixels that vanish, of the 277,937 the game draws. */
  lostEdges: 30549,
  /** Distinct appearances the sixteen colours reach when drawn. */
  appearances: 12,
  /** And when filled, which uses the other table and reaches more. */
  fillAppearances: 15,
} as const;

/**
 * The single colour each of the sixteen becomes where it cannot be dithered.
 *
 * Text, not pictures. A character cell is eight pixels wide and a glyph's
 * stroke is one or two of them, so a dithered stroke is a stroke with holes in
 * it: the letter stops being a letter.
 *
 * This is the one table in this file that is still derived, and the reason is
 * that it is not in the overlay. `CGA_GRAF.OVL`'s six routines are a mode set,
 * a screen blit, a fill, a clear, a masked pixel write and an in-place colour
 * translation; text is drawn by the interpreter above it, in whatever colour it
 * hands down. So this is nearest match among the four, weighted 0.30/0.59/0.11
 * -- and where two colours land on the same one, `cgaTextColours` breaks the
 * tie so that ink never sits on its own ground.
 */
export const CGA_SOLID: readonly number[] = [
  0, //  0  black          -> blue, which is as dark as this palette goes
  0, //  1  blue           -> blue, exactly
  1, //  2  green          -> green, exactly
  1, //  3  cyan           -> green
  2, //  4  red            -> red, exactly
  2, //  5  magenta        -> red
  3, //  6  brown          -> brown, exactly
  3, //  7  light grey     -> brown
  3, //  8  dark grey      -> brown
  0, //  9  light blue     -> blue
  1, // 10  light green    -> green
  1, // 11  light cyan     -> green
  3, // 12  light red      -> brown
  3, // 13  light magenta  -> brown
  3, // 14  yellow         -> brown
  3, // 15  white          -> brown, the brightest there is
];

/**
 * How far apart two of the four colours are, under the weighting
 * {@link CGA_SOLID} was derived with. Used only to break a collision between
 * ink and ground.
 */
const CONTRAST: readonly (readonly number[])[] = [
  [0, 142, 109, 127],
  [142, 0, 160, 114],
  [109, 160, 0, 65],
  [127, 114, 65, 0],
];

/**
 * Ink and ground, in CGA's four colours, guaranteed to differ.
 *
 * Every attribute pair the bundled game sets survives {@link CGA_SOLID} on its
 * own -- the closest is brown on light grey, and they stay two different
 * colours. This is here for the game that is not this one: with four colours a
 * collision is a hazard rather than a hypothetical, and cyan text on a light
 * cyan ground would otherwise be invisible instead of merely wrong.
 */
export function cgaTextColours(foreground: number, background: number): [number, number] {
  const ground = CGA_SOLID[background & 0x0f]!;
  const ink = CGA_SOLID[foreground & 0x0f]!;
  if (ink !== ground) return [ink, ground];

  // Whichever of the four stands out most against the ground it has to sit on.
  const row = CONTRAST[ground]!;
  let best = 0;
  for (let i = 1; i < 4; i++) if (row[i]! > row[best]!) best = i;
  return [best, ground];
}

export class CgaDriver implements DisplayDriver {
  readonly mode: DisplayMode = 'cga';
  readonly display = new Display(DISPLAY_WIDTH, DISPLAY_HEIGHT, CGA_PALETTE_RGB);
  readonly pixelAspect: number = 1;
  readonly monochrome: boolean = false;

  /**
   * The pairs and the fill patterns this driver draws with.
   *
   * Held per driver rather than read from the module, for the reason Hercules
   * holds its own: whether `AGIDATA.OVL` was bundled is not known until it has
   * been read, and the renderer builds a driver when the mode changes, so the
   * tables arrive with it. Absent, the bytes LSL1's copy holds are used.
   */
  readonly pairs: readonly (readonly [number, number])[];
  readonly fills: readonly (readonly [[number, number], [number, number]])[];

  /** @param tables `AGIDATA.OVL`'s CGA tables, when the game came with them */
  constructor(tables: CgaTables = CGA_TABLES) {
    this.pairs = tables.colour.map((nibble) => colourPixels(nibble));
    this.fills = tables.fill.map(([left, right]) => [colourPixels(left), colourPixels(right)]);
  }

  draw(frame: Frame): void {
    for (const layer of frame.layers) {
      switch (layer.kind) {
        // Furniture rather than picture, and dithered all the same: the
        // original's fill routine reads a table of its own, and in four
        // colours it alternates two patterns across the width.
        case 'fill':
          this.#fillRows(0, this.display.height, layer.colour);
          break;

        case 'rows': {
          const from = layer.from * IBM_CELL.height;
          const to = Math.min((layer.to + 1) * IBM_CELL.height, this.display.height);
          this.#fillRows(from, to, layer.colour);
          break;
        }

        case 'picture':
          this.#drawScreen(layer.screen, layer.row * IBM_CELL.height);
          break;

        case 'cel':
          this.#drawCel(layer.cel, PICTURE_ROW * IBM_CELL.height + layer.top);
          break;

        case 'cells':
          layer.cells.draw(this.display, IBM_CELL, cgaTextColours);
          break;

        case 'text': {
          const [ink, ground] = cgaTextColours(layer.foreground, layer.background);
          drawText(this.display, layer.text, layer.column, layer.row, ink, ground, IBM_CELL);
          break;
        }

        case 'window': {
          const [ink, ground] = cgaTextColours(layer.window.foreground, layer.window.background);
          const [rule] = cgaTextColours(layer.window.border, layer.window.background);
          drawWindow(
            this.display,
            { ...layer.window, foreground: ink, background: ground, border: rule },
            IBM_CELL,
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
   * A band of rows filled with a colour's fill pattern.
   *
   * The pattern alternates between neighbouring AGI pixels, which is what the
   * original's fill routine does: it builds one byte out of two nibbles and
   * stores it across the row, so the two patterns land on even and odd AGI
   * pixels. Four device pixels of period, and no variation down the rows.
   */
  #fillRows(from: number, to: number, colour: number): void {
    const [left, right] = this.fills[colour & 0x0f]!;

    for (let y = Math.max(0, from); y < to; y++) {
      let at = y * this.display.width;
      for (let x = 0; x < this.display.width; x += PIXEL_ASPECT * 2) {
        this.display.pixels[at++] = left[0]!;
        this.display.pixels[at++] = left[1]!;
        this.display.pixels[at++] = right[0]!;
        this.display.pixels[at++] = right[1]!;
      }
    }
  }

  /**
   * The picture, dithered.
   *
   * The pair is drawn the same way on every row, because `CGA_GRAF.OVL` has no
   * row phase: a run of one colour is vertical stripes one pixel wide. M12 drew
   * a checkerboard here instead, on the argument that two stripes are the same
   * colour on average and a worse texture. The argument was sound; the card did
   * this.
   */
  #drawScreen(screen: ArrayLike<number>, top: number): void {
    for (let y = 0; y < PICTURE_HEIGHT; y++) {
      const destRow = top + y;
      if (destRow < 0 || destRow >= this.display.height) continue;

      let at = destRow * this.display.width;
      const source = y * PICTURE_WIDTH;

      for (let x = 0; x < PICTURE_WIDTH; x++) {
        const pair = this.pairs[screen[source + x]! & 0x0f]!;
        this.display.pixels[at++] = pair[0]!;
        this.display.pixels[at++] = pair[1]!;
      }
    }
  }

  /** An item's close-up, dithered the same way and centred like EGA's. */
  #drawCel(cel: Cel, top: number): void {
    const left = Math.floor((this.display.width - cel.width * PIXEL_ASPECT) / 2);

    for (let y = 0; y < cel.height; y++) {
      const destRow = top + y;
      if (destRow < 0 || destRow >= this.display.height) continue;

      for (let x = 0; x < cel.width; x++) {
        const colour = cel.pixels[y * cel.width + x]!;
        if (colour === TRANSPARENT) continue;

        const pair = this.pairs[colour & 0x0f]!;
        const at = destRow * this.display.width + left + x * PIXEL_ASPECT;
        this.display.pixels[at] = pair[0]!;
        this.display.pixels[at + 1] = pair[1]!;
      }
    }
  }
}
