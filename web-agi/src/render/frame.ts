/**
 * What crosses the seam: a description of a frame, not its pixels.
 *
 * The engine has four things to show and no opinion about how they become
 * pixels: the two 160x168 screens, the grid of character cells with their
 * colours, a window over them, and -- once, for an item's close-up -- a single
 * VIEW cel. A frame is those things in the order they are drawn, and a display
 * driver is what turns the list into a picture.
 *
 * The list is ordered rather than layered by kind, because AGI's order is not
 * a hierarchy: a window sits over the text layer, but a script that writes on
 * the input row expects its text over the command line, and the interaction the
 * game is waiting for is over everything. Keeping the order the caller chose is
 * what lets {@link ../engine/present.ts} stay the one place that decides it.
 *
 * Everything here is in the engine's own units -- character cells, and the
 * picture's 160x168 pixels. No entry mentions a display pixel, which is the
 * property that makes a second driver possible.
 */
import type { Bytes } from './screens.ts';
import type { Cel } from './sprite.ts';
import type { TextLayer, TextWindow } from './text.ts';

/** One thing to draw, in the engine's units. */
export type FrameLayer =
  /** The whole display in one colour, as text mode and a text screen want. */
  | { kind: 'fill'; colour: number }
  /** A 160x168 screen, into the picture area. */
  | { kind: 'picture'; screen: Bytes }
  /** The text plane: every cell that has been written, transparent elsewhere. */
  | { kind: 'cells'; cells: TextLayer }
  /** A run of characters from a cell, clipped at the right edge. */
  | {
      kind: 'text';
      text: string;
      column: number;
      row: number;
      foreground: number;
      background: number;
    }
  /** Whole character rows in one colour, as the menu bar wants. */
  | { kind: 'rows'; from: number; to: number; colour: number }
  /** A message window, positioned in cells and sized from its text. */
  | { kind: 'window'; window: TextWindow }
  /**
   * A VIEW cel on its own, centred in the picture area.
   *
   * `show.obj`'s close-up, and the one place the engine asks for a cel outside
   * the picture. How a cel becomes pixels is the driver's business -- the
   * original shipped `HGC_OBJS.OVL` beside `IBM_OBJS.OVL` for exactly this --
   * so the position is given in the picture's own rows, not in display pixels.
   */
  | { kind: 'cel'; cel: Cel; top: number };

/**
 * A frame under construction.
 *
 * A builder rather than an array literal because the callers are spread across
 * the interactions, and each of them adds one or two entries to a frame it did
 * not start. The methods chain, and every one of them speaks cells or picture
 * pixels.
 */
export class Frame {
  readonly layers: FrameLayer[] = [];

  /** Paint the whole display one colour. */
  fill(colour: number): this {
    this.layers.push({ kind: 'fill', colour });
    return this;
  }

  /** Show a 160x168 screen in the picture area. */
  picture(screen: Bytes): this {
    this.layers.push({ kind: 'picture', screen });
    return this;
  }

  /** Draw every written cell of the text plane. */
  cells(cells: TextLayer): this {
    this.layers.push({ kind: 'cells', cells });
    return this;
  }

  /** Write a line of text from a cell. */
  text(
    text: string,
    column: number,
    row: number,
    foreground: number,
    background: number,
  ): this {
    this.layers.push({ kind: 'text', text, column, row, foreground, background });
    return this;
  }

  /** Paint whole character rows one colour. */
  rows(from: number, to: number, colour: number): this {
    this.layers.push({ kind: 'rows', from, to, colour });
    return this;
  }

  /** Put a laid-out window over what is there. */
  window(window: TextWindow): this {
    this.layers.push({ kind: 'window', window });
    return this;
  }

  /**
   * Centre a cel in the picture area.
   *
   * @param top how far down the picture area its top row sits, in picture rows
   */
  cel(cel: Cel, top: number): this {
    this.layers.push({ kind: 'cel', cel, top });
    return this;
  }
}
