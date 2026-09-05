/**
 * Where the screen's furniture sits.
 *
 * Three rows, and a game may move all of them: `configure.screen` is how the
 * original was told where to put the status line, where the input line goes,
 * and how far up the screen text may be printed. The engine treated the
 * command as a no-op and kept the three as constants in three different
 * modules, which worked only because the bundled game asks for exactly the
 * numbers that were assumed.
 *
 * That it *does* ask is the measurement worth keeping. Logic 51 calls
 * `configure.screen(1, 23, 0)` once, at start-up, unconditionally -- not from
 * the mono branch, which is what the plan expected. So making the command real
 * changes nothing about this game today, and what it removes is an assumption
 * rather than a defect. The next game to load is where the difference shows.
 *
 * The picture moves with them, which M11 assumed it did not. `minPrintRow` is
 * the top of the play window, and the picture is drawn there: the game asking
 * for 1 is asking for a status line above it, and a game asking for 0 is asking
 * for the picture at the very top of the screen. See {@link pictureRow}.
 */
import { PICTURE_HEIGHT } from '../render/screens.ts';


/** The rows a script may move. */
export interface ScreenLayout {
  /**
   * The first row text may be printed on.
   *
   * A floor rather than a position: a message window is nudged down to it if
   * the script asked for something higher, which is what keeps a window from
   * covering the status line.
   */
  minPrintRow: number;

  /** The row the input line sits on. */
  inputRow: number;

  /** The row the status line is drawn on. */
  statusRow: number;
}

/**
 * What the interpreter starts with, and what this game asks for anyway.
 *
 * Status line at the top, input line three rows from the bottom, and nothing
 * printed above row 1.
 */
export const DEFAULT_LAYOUT: ScreenLayout = {
  minPrintRow: 1,
  inputRow: 23,
  statusRow: 0,
};

/**
 * The row the picture starts at in the interpreter's own layout.
 *
 * A default rather than the answer: use {@link pictureRow} for a running game.
 * Kept for the display drivers' tests, which draw a frame without a machine.
 */
export const DEFAULT_PICTURE_ROW = 1;

/**
 * How many character rows the picture covers.
 *
 * 168 lines in 8-line cells. The number matters wherever the picture's *area*
 * does rather than its pixels -- `show.pic` clearing the text under it, for
 * one.
 */
export const PICTURE_ROWS = PICTURE_HEIGHT / 8;

/**
 * The row the picture starts at, for a layout.
 *
 * The play window's top, which is what `configure.screen`'s first argument
 * sets. M11 made that command real and left this out, on the reading that
 * AGI's picture window is fixed at rows 1-21 -- true of the bundled game,
 * which asks for 1 and never moves it, and false in general.
 *
 * King's Quest I is where it shows. Its title screen calls
 * `configure.screen(0, 21, 0)` and its game proper calls
 * `configure.screen(1, 22, 0)`, and the second number is the check: the input
 * row is 21 when the picture starts at 0 and 22 when it starts at 1, which is
 * the row immediately below a 168-line picture in both cases. A fixed picture
 * row put that title screen's scroll 8 pixels below the credits the same
 * script draws into it, and the top row of them cut a black band across the
 * banner.
 *
 * @param layout what the game asked for
 */
export function pictureRow(layout: ScreenLayout): number {
  return layout.minPrintRow;
}

/** A fresh copy, so a machine cannot write into the default. */
export function defaultLayout(): ScreenLayout {
  return { ...DEFAULT_LAYOUT };
}
