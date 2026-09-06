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
 *
 * What the calls do not say is what the BIOS makes of `bl`, and one bit of that
 * -- intensity -- is the difference between these four colours and four much
 * brighter ones. Measured rather than argued: a COM file making the game's own
 * two calls under DOSBox-X on `machine=cga`, reading the BIOS's copy of the
 * register back from `0040:0066`, gives **0x01**. Background 1, intensity off,
 * palette 0. The same program with the two calls removed gives **0x30** -- mode
 * 4's default, palette 1 at high intensity on black, the cyan-and-magenta
 * screen most CGA software shows -- so both calls are overrides Sierra spent
 * instructions on.
 *
 * Worth knowing when this looks wrong beside an emulator: ScummVM's AGI draws
 * CGA as black/light cyan/light magenta/white through a dither table of its
 * own, not the one in `AGIDATA.OVL`. It differs here in both palette and
 * pattern, on purpose.
 */
export const CGA_PALETTE_RGB = new Uint8Array([
  0, 0, 170, // 0  blue      the background register, set to 1
  0, 170, 0, // 1  green     palette 0, low intensity
  170, 0, 0, // 2  red
  170, 85, 0, // 3  brown
]);

/**
 * The two CGA colours each of AGI's sixteen is drawn as, on each of two rows.
 *
 * **Two patterns a colour, chosen by scanline** -- not one. Each entry of the
 * three-byte table at `0x1b78` holds a nibble for even display rows and a
 * nibble for odd ones, and a run of one colour is therefore a checkerboard
 * rather than a stripe. `[even, odd]`, each a pair of CGA colours with the left
 * pixel first.
 *
 * This is measured, and it is the correction M20 exists for. Running the real
 * 2.917 interpreter under DOSBox-X on `machine=cga`, switching it into the
 * four-colour mode and reading its screen back against the game's own picture 1
 * reproduces **99.0%** of 25,620 pixels from the rule below. The 16-byte table
 * at `0x1bb8`, which M16 read as the four-colour picture table and this driver
 * used until now, reproduces **16.4%**. Whatever `0x1bb8` is for, it is not
 * this; see `render/cgatables.ts`.
 */
export const CGA_DITHER: readonly (readonly [
  readonly [number, number],
  readonly [number, number],
])[] = CGA_TABLES.fill.map(([odd, even]) => [colourPixels(even), colourPixels(odd)]);

/**
 * The same table again, under the name the fill layers used to have.
 *
 * Kept as an alias because the two uses were once believed to be different
 * tables. They are one table: a filled band and a drawn picture dither
 * identically, which is why {@link CGA_COST} no longer distinguishes them.
 */
export const CGA_FILL = CGA_DITHER;

/**
 * Which colours end up looking the same, and what that costs.
 *
 * Kept beside the table rather than left to be rediscovered, and the counts are
 * boundary pixels in the bundled game that vanish because of them.
 * `cga.test.ts` recomputes the list from the table and the game's pictures, so
 * the two cannot drift apart.
 *
 * There is exactly one, and M20 is why it is now one rather than three. Two
 * patterns a colour instead of one is twice the vocabulary: dark grey, light
 * red and light magenta, yellow and white each got their own appearance back,
 * and only **black and blue** are still both the background. They meet in
 * 27,614 places -- the game's night skies and its shadows -- which is 9.9% of
 * every boundary the game draws, against the 11% the one-pattern reading cost.
 */
export const CGA_COLLISIONS: readonly { colours: readonly number[]; lostEdges: number }[] = [
  { colours: [0, 1], lostEdges: 27614 }, // both are the background, on both rows
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
  lostEdges: 27614,
  /** Distinct appearances the sixteen colours reach: fifteen of a possible 16. */
  appearances: 15,
} as const;

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
   * The two patterns this driver draws each colour with: `[even row, odd row]`.
   *
   * Held per driver rather than read from the module, for the reason Hercules
   * holds its own: whether `AGIDATA.OVL` was bundled is not known until it has
   * been read, and the renderer builds a driver when the mode changes, so the
   * tables arrive with it. Absent, the bytes LSL1's copy holds are used.
   */
  readonly pairs: readonly (readonly [readonly [number, number], readonly [number, number]])[];

  /** @param tables `AGIDATA.OVL`'s CGA tables, when the game came with them */
  constructor(tables: CgaTables = CGA_TABLES) {
    this.pairs = tables.fill.map(([odd, even]) => [colourPixels(even), colourPixels(odd)]);
  }

  /** The pattern a colour takes on one display row. Even rows take the second
   * nibble of the three-byte entry and odd rows the first -- measured, see the
   * note on {@link CGA_DITHER}. */
  #pattern(colour: number, row: number): readonly [number, number] {
    return this.pairs[colour & 0x0f]![row & 1]!;
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
          this.#drawCel(layer.cel, layer.row * IBM_CELL.height + layer.top);
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
   * A band of rows filled with a colour's pattern.
   *
   * The same two patterns the picture uses, alternating by row: a filled band
   * and a drawn region of one colour are the same texture, which is what the
   * capture in `test/captures/kq1-cga-castle.png` shows.
   */
  #fillRows(from: number, to: number, colour: number): void {
    for (let y = Math.max(0, from); y < to; y++) {
      const [left, right] = this.#pattern(colour, y);
      let at = y * this.display.width;
      for (let x = 0; x < this.display.width; x += PIXEL_ASPECT) {
        this.display.pixels[at++] = left;
        this.display.pixels[at++] = right;
      }
    }
  }

  /**
   * The picture, dithered.
   *
   * Two patterns a colour, chosen by display row, so a run of one colour is a
   * checkerboard. M16 read this as vertical stripes from the absence of a row
   * mask in `CGA_GRAF.OVL`; M20 measured the running interpreter and found the
   * row phase is there. See the note on {@link CGA_DITHER} for the numbers.
   */
  #drawScreen(screen: ArrayLike<number>, top: number): void {
    for (let y = 0; y < PICTURE_HEIGHT; y++) {
      const destRow = top + y;
      if (destRow < 0 || destRow >= this.display.height) continue;

      let at = destRow * this.display.width;
      const source = y * PICTURE_WIDTH;

      for (let x = 0; x < PICTURE_WIDTH; x++) {
        const [left, right] = this.#pattern(screen[source + x]!, destRow);
        this.display.pixels[at++] = left;
        this.display.pixels[at++] = right;
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

        const pattern = this.#pattern(colour, destRow);
        const at = destRow * this.display.width + left + x * PIXEL_ASPECT;
        this.display.pixels[at] = pattern[0];
        this.display.pixels[at + 1] = pattern[1];
      }
    }
  }
}
