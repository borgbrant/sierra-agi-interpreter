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
 * What is *not* here is the picture. AGI's picture window is fixed at rows
 * 1-21 and `configure.screen` does not move it, so {@link PICTURE_ROW} is a
 * constant -- but one constant, in one place, rather than the same number
 * written into the renderer, the display and the driver.
 */

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
 * The row the picture starts at.
 *
 * Below the one-cell status line, and fixed: the picture window is 160x168
 * whatever the game asks for, and every row of it is accounted for by the
 * grid's rows 1 to 21.
 */
export const PICTURE_ROW = 1;

/** A fresh copy, so a machine cannot write into the default. */
export function defaultLayout(): ScreenLayout {
  return { ...DEFAULT_LAYOUT };
}
