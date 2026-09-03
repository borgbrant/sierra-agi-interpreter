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
 * Two colours from four is ten distinct blends, not sixteen -- (a,b) and (b,a)
 * are the same colour, whatever order they are drawn in. So **six of the
 * sixteen must share an appearance with another**, and the question this
 * milestone actually answers is which six, and what that costs.
 *
 * ## How the table was arrived at, and what a metric could not settle
 *
 * The mapping cannot be read out of the original driver: `CGA_GRAF.OVL` is not
 * bundled, because the repository ships only the game's resource files. So it
 * was derived, and measured against every picture in the game -- 43 pictures,
 * 1,155,840 pixels, and the 277,937 places where two colours meet.
 *
 * The measurement first, because it says how little slack there is:
 *
 * ```text
 * every one of the 16 colours is drawn        none is free to collide
 * 110 of the 120 colour pairs are drawn       so almost every collision
 *   adjacent somewhere in the game            costs a real boundary
 * the 10 that never touch all involve         which is the only colour with
 *   colour 8, dark grey                       any slack at all
 * ```
 *
 * The table is **nearest match, with one entry moved after looking at the
 * result** -- and the honest part of this comment is the second clause. Three
 * mappings were built and rendered:
 *
 * ```text
 * nearest match          4.08% of boundaries lost, once light green is moved
 * least error            4.25% lost. Light green and light cyan collapse, and
 *                        the green pennant in the opening disappears into the
 *                        sky
 * fewest collisions      3.26% lost, and the worst of the three to look at:
 *   (no blend used by    yellow is forced off the bright blend and lands on
 *   more than two)       light cyan's, so the notepad the opening is *about*
 *                        vanishes into the sky
 * ```
 *
 * The second and third are what a boundary count recommends, and both hide a
 * whole object. That is the finding worth carrying into M13: **a boundary count
 * undervalues the outline of a large region.** An object's edge is its
 * perimeter, a few hundred pixels, while the object is its area; a metric
 * summing edges will happily trade away the one boundary that makes a shape a
 * shape. The 489 pixels where yellow meets light cyan are the outline of the
 * notepad.
 *
 * So the entry that moved is light green, from the blend it shares with light
 * cyan to its second-nearest -- which costs 3.9% of the black-to-white range,
 * and hands back the pennant. Everything else is nearest match. Black and white
 * are checked rather than chosen: nearest match already puts them on the
 * darkest and brightest blends, which is what keeps the range from inverting.
 *
 * ## Which palette, and a surprise
 *
 * CGA's 320x200 mode offers two palettes in two intensities. All four were
 * scored against the colours this game actually draws, weighted by how many
 * pixels of each it draws, and **palette 1 at low intensity wins on both
 * counts at once** -- least colour error and fewest boundaries lost, by a wide
 * margin:
 *
 * ```text
 * palette                        colour error  boundaries lost
 * 1 low   black/cyan/magenta/grey       113.2M            4.3%
 * 1 high  black/lcyan/lmagenta/white    117.4M           13.8%
 * 0 high  black/lgreen/lred/yellow      129.7M           13.1%
 * 0 low   black/green/red/brown         203.2M           19.7%
 * ```
 *
 * The bright cyan-and-magenta of palette 1 high is the one anybody who has seen
 * a Sierra CGA screenshot would reach for, and it is measurably the wrong
 * choice for a *dithered* renderer: with every non-black entry bright, dark red
 * lands nearer to black than to anything else, and colour 4 collapses into
 * colour 0 -- the second most common boundary in the game, 29,800 pixels of it,
 * gone. Low intensity has dark and mid tones among its blends, and half of
 * AGI's palette is its dark half.
 */
import { Display, DISPLAY_WIDTH, DISPLAY_HEIGHT, PIXEL_ASPECT } from '../display.ts';
import type { Frame } from '../frame.ts';
import { PICTURE_HEIGHT, PICTURE_WIDTH } from '../screens.ts';
import { TRANSPARENT, type Cel } from '../sprite.ts';
import { clearRows, drawText, drawWindow, IBM_CELL } from '../text.ts';
import { PICTURE_ROW } from '../../engine/layout.ts';
import type { DisplayDriver, DisplayMode } from './driver.ts';

/**
 * CGA palette 1, low intensity: black, cyan, magenta, light grey.
 *
 * The hardware's own -- in 320x200 four-colour mode, colour 0 is the border
 * register and colours 1 to 3 are the selected palette, which for palette 1 is
 * CGA's 3, 5 and 7.
 */
export const CGA_PALETTE_RGB = new Uint8Array([
  0, 0, 0, // 0  black
  0, 170, 170, // 1  cyan
  170, 0, 170, // 2  magenta
  170, 170, 170, // 3  light grey
]);

/**
 * The two CGA colours each of AGI's sixteen is drawn as.
 *
 * Nearest match against the blend of each pair, with light green moved to its
 * second-nearest; the header says why. The comment on each line is what the
 * pair blends to, so a wrong entry is a visible diff rather than a number to
 * take on trust.
 */
export const CGA_DITHER: readonly (readonly [number, number])[] = [
  [0, 0], //  0  black          0,0,0        -> 0,0,0
  [0, 2], //  1  blue           0,0,170      -> 85,0,85
  [0, 1], //  2  green          0,170,0      -> 0,85,85
  [1, 1], //  3  cyan           0,170,170    -> 0,170,170
  [0, 2], //  4  red            170,0,0      -> 85,0,85
  [2, 2], //  5  magenta        170,0,170    -> 170,0,170
  [0, 3], //  6  brown          170,85,0     -> 85,85,85
  [3, 3], //  7  light grey     170,170,170  -> 170,170,170
  [0, 3], //  8  dark grey      85,85,85     -> 85,85,85
  [1, 2], //  9  light blue     85,85,255    -> 85,85,170
  // Its nearest blend is light cyan's, 1+3, and sharing it costs the opening
  // its green pennant. This is 3.9% of the range further off and its own.
  [1, 1], // 10  light green    85,255,85    -> 0,170,170
  [1, 3], // 11  light cyan     85,255,255   -> 85,170,170
  [2, 3], // 12  light red      255,85,85    -> 170,85,170
  [2, 3], // 13  light magenta  255,85,255   -> 170,85,170
  [3, 3], // 14  yellow         255,255,85   -> 170,170,170
  [3, 3], // 15  white          255,255,255  -> 170,170,170
];

/**
 * Which colours end up looking the same, and what that costs.
 *
 * Kept beside the table rather than left to be rediscovered: these five groups
 * are the whole of what CGA gives up, and the counts are boundary pixels in the
 * bundled game that vanish because of them. `cga.test.ts` recomputes the list
 * from the table and the game's pictures, so the two cannot drift apart.
 *
 * The last of the five is the one that cannot be avoided. Colour 7 is
 * *exactly* 170,170,170, which is the brightest blend there is, and white has
 * nowhere brighter to go -- so light grey, yellow and white share it, and 8,328
 * boundary pixels go with them. Three quarters of everything CGA loses is that
 * one group, and no rearrangement recovers it: a palette whose brightest colour
 * is light grey cannot show a highlight on light grey.
 */
export const CGA_COLLISIONS: readonly { colours: readonly number[]; lostEdges: number }[] = [
  { colours: [1, 4], lostEdges: 2216 }, // blue = red: no blue or red to draw either in
  { colours: [3, 10], lostEdges: 137 }, // cyan = light green: the cheapest of the six
  { colours: [6, 8], lostEdges: 0 }, // brown = dark grey: never once adjacent
  { colours: [12, 13], lostEdges: 654 }, // light red = light magenta
  { colours: [7, 14, 15], lostEdges: 8328 }, // light grey = yellow = white
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
  lostEdges: 11335,
  /** Distinct appearances the sixteen colours reach, of the ten available. */
  appearances: 10,
} as const;

/**
 * The single colour each of the sixteen becomes where it cannot be dithered.
 *
 * Text, not pictures. A character cell is eight pixels wide and a glyph's
 * stroke is one or two of them, so a dithered stroke is a stroke with holes in
 * it: the letter stops being a letter. Text is drawn solid, ink and ground
 * both, and this is the table that says in what.
 *
 * One rule beyond nearest match, and the measurement is why: **only colour 0
 * may become black.** Taken as pure nearest match, red, brown and dark grey all
 * land on black -- and the bundled game sets `set.text.attribute(6, 0)`, brown
 * on black, in five places. Black ink on a black ground is not a colour
 * approximation, it is text that is not there.
 */
export const CGA_SOLID: readonly number[] = [
  0, //  0  black          -> black
  2, //  1  blue           -> magenta
  1, //  2  green          -> cyan
  1, //  3  cyan           -> cyan
  2, //  4  red            -> magenta
  2, //  5  magenta        -> magenta
  2, //  6  brown          -> magenta
  3, //  7  light grey     -> light grey
  1, //  8  dark grey      -> cyan
  1, //  9  light blue     -> cyan
  1, // 10  light green    -> cyan
  1, // 11  light cyan     -> cyan
  2, // 12  light red      -> magenta
  2, // 13  light magenta  -> magenta
  3, // 14  yellow         -> light grey
  3, // 15  white          -> light grey
];

/**
 * How far apart two of the four colours are, under the weighting the tables
 * were derived with. Used only to break a collision between ink and ground.
 */
const CONTRAST: readonly (readonly number[])[] = [
  [0, 450, 380, 510],
  [450, 0, 416, 240],
  [380, 416, 0, 340],
  [510, 240, 340, 0],
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
  readonly pixelAspect = 1;
  readonly monochrome = false;

  draw(frame: Frame): void {
    for (const layer of frame.layers) {
      switch (layer.kind) {
        // Furniture, not picture: a solid colour behind text stays solid.
        case 'fill':
          this.display.fill(CGA_SOLID[layer.colour & 0x0f]!);
          break;

        case 'rows':
          clearRows(this.display, layer.from, layer.to, CGA_SOLID[layer.colour & 0x0f]!, IBM_CELL);
          break;

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
   * The picture, dithered.
   *
   * The pair is swapped on alternate rows, so a run of one colour reads as a
   * checkerboard rather than as vertical stripes. Two stripes one pixel wide
   * are the same colour on average and a visibly worse texture, and the flip
   * costs one exclusive-or.
   */
  #drawScreen(screen: ArrayLike<number>, top: number): void {
    for (let y = 0; y < PICTURE_HEIGHT; y++) {
      const destRow = top + y;
      if (destRow < 0 || destRow >= this.display.height) continue;

      const phase = destRow & 1;
      let at = destRow * this.display.width;
      const source = y * PICTURE_WIDTH;

      for (let x = 0; x < PICTURE_WIDTH; x++) {
        const pair = CGA_DITHER[screen[source + x]! & 0x0f]!;
        this.display.pixels[at++] = pair[phase]!;
        this.display.pixels[at++] = pair[phase ^ 1]!;
      }
    }
  }

  /** An item's close-up, dithered the same way and centred like EGA's. */
  #drawCel(cel: Cel, top: number): void {
    const left = Math.floor((this.display.width - cel.width * PIXEL_ASPECT) / 2);

    for (let y = 0; y < cel.height; y++) {
      const destRow = top + y;
      if (destRow < 0 || destRow >= this.display.height) continue;
      const phase = destRow & 1;

      for (let x = 0; x < cel.width; x++) {
        const colour = cel.pixels[y * cel.width + x]!;
        if (colour === TRANSPARENT) continue;

        const pair = CGA_DITHER[colour & 0x0f]!;
        const at = destRow * this.display.width + left + x * PIXEL_ASPECT;
        this.display.pixels[at] = pair[phase]!;
        this.display.pixels[at + 1] = pair[phase ^ 1]!;
      }
    }
  }
}
