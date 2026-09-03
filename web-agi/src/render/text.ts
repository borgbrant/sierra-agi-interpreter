/**
 * Text, in character cells.
 *
 * The display is a 40x25 grid of 8x8 characters and AGI treats it as one: the
 * status line is row 0, the picture occupies rows 1-21, and the prompt lives on
 * rows 22-24. Every text command addresses cells, never pixels, so this module
 * works in cells and converts on the way to the framebuffer.
 *
 * Message windows are the exception that proves it. A window is positioned in
 * cells and sized from its wrapped text, but it is drawn with a one-pixel
 * border that deliberately sits outside the grid, because that is what the
 * original does and text boxed exactly on cell boundaries looks wrong.
 */
import { CHAR_HEIGHT, CHAR_WIDTH, glyph } from './font.ts';
import { Display } from './display.ts';

/**
 * The character grid.
 *
 * AGI's own, not any driver's: every text command addresses a 40x25 grid,
 * whatever size the adapter drawing it happens to be. What one cell becomes in
 * pixels is a driver's decision, and travels as {@link CellMetrics}.
 */
export const COLUMNS = 40;
export const ROWS = 25;

/**
 * How a driver turns a character cell into pixels.
 *
 * Two facts, and the original needed both: the size of the cell, and the font
 * to put in it. Hercules is why -- its `HGC_FONT` is 3072 bytes, 256 glyphs of
 * twelve rows, against the eight the IBM font draws, and its cells are wider
 * than its glyphs because its screen is 720 pixels across for the same 40
 * columns. A glyph narrower than its cell is stretched to fill it, so the same
 * blitter serves both.
 */
export interface CellMetrics {
  /** Pixel size of one cell. */
  width: number;
  height: number;
  /** The rows of one character, high bit leftmost; `height` of them. */
  glyph(code: number): ArrayLike<number>;
}

/** The 8x8 IBM font in an 8x8 cell: what EGA, CGA and the PCjr draw. */
export const IBM_CELL: CellMetrics = { width: CHAR_WIDTH, height: CHAR_HEIGHT, glyph };

/** Row 0 is the status line, and the last three rows are the prompt area. */
export const STATUS_ROW = 0;
export const PROMPT_ROW = 23;

/**
 * How wide a message window's text may be.
 *
 * AGI wraps message text well short of the screen: a window that ran the full
 * 40 columns would cover the picture it is talking about.
 */
export const WINDOW_TEXT_WIDTH = 30;

/** Black on white, the colours a message window uses unless a script says otherwise. */
export const DEFAULT_TEXT_COLOUR = 0;
export const DEFAULT_BACKGROUND_COLOUR = 15;

/**
 * The red AGI outlines a message window in.
 *
 * Not the text colour. The original draws the box in its background colour and
 * then rules a single red line inside it, which is why a window has a white
 * margin on both sides of the line rather than a border flush with its edge.
 */
export const WINDOW_BORDER_COLOUR = 4;

/** How far the ruled line sits inside the window's outer edge. */
const BORDER_INSET = 2;

/**
 * Draw one character at a cell.
 *
 * A glyph wider or narrower than the cell is scaled to it, which is how an
 * 8-pixel font fills an 18-pixel Hercules cell without a second blitter.
 */
export function drawChar(
  display: Display,
  code: number,
  column: number,
  row: number,
  foreground: number,
  background: number,
  cell: CellMetrics = IBM_CELL,
): void {
  const bitmap = cell.glyph(code);
  const left = column * cell.width;
  const top = row * cell.height;

  for (let y = 0; y < cell.height; y++) {
    const screenY = top + y;
    if (screenY < 0 || screenY >= display.height) continue;

    const bits = bitmap[y] ?? 0;
    let at = screenY * display.width + left;

    for (let x = 0; x < cell.width; x++, at++) {
      const screenX = left + x;
      if (screenX < 0 || screenX >= display.width) continue;
      // Which bit of the eight-wide glyph this column of the cell shows.
      const bit = cell.width === GLYPH_BITS ? x : Math.floor((x * GLYPH_BITS) / cell.width);
      display.pixels[at] = bits & (0x80 >> bit) ? foreground : background;
    }
  }
}

/** How many bits wide a glyph row is; the PC's fonts are all byte-wide. */
const GLYPH_BITS = 8;

/**
 * Draw a line of text from a cell, left to right.
 *
 * Text that would run off the right edge is clipped rather than wrapped:
 * wrapping is a decision the caller has already made with {@link wrapText}.
 */
export function drawText(
  display: Display,
  text: string,
  column: number,
  row: number,
  foreground = DEFAULT_TEXT_COLOUR,
  background = DEFAULT_BACKGROUND_COLOUR,
  cell: CellMetrics = IBM_CELL,
): void {
  for (let i = 0; i < text.length; i++) {
    const at = column + i;
    if (at >= COLUMNS) break;
    drawChar(display, text.charCodeAt(i), at, row, foreground, background, cell);
  }
}

/** Paint whole character rows one colour. */
export function clearRows(
  display: Display,
  from: number,
  to: number,
  colour: number,
  cell: CellMetrics = IBM_CELL,
): void {
  const top = Math.min(from, to) * cell.height;
  const height = (Math.abs(to - from) + 1) * cell.height;
  display.fillRect(0, top, display.width, height, colour);
}

/**
 * Break text into lines that fit a width.
 *
 * Two things beyond ordinary wrapping matter here. Explicit newlines in a
 * message are the author's own line breaks and are always honoured, and a word
 * longer than the whole width is broken rather than left to overflow -- AGI
 * messages contain substituted values whose length is not known when the text
 * is written.
 *
 * @param text  the message, with `\n` where the author put line breaks
 * @param width how many characters fit on a line
 */
export function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];

  for (const paragraph of text.split('\n')) {
    if (paragraph === '') {
      lines.push('');
      continue;
    }

    let line = '';
    for (const word of paragraph.split(' ')) {
      let remaining = word;

      // A word too long for any line is cut rather than allowed to overflow.
      while (remaining.length > width) {
        if (line !== '') {
          lines.push(line);
          line = '';
        }
        lines.push(remaining.slice(0, width));
        remaining = remaining.slice(width);
      }

      if (line === '') {
        line = remaining;
      } else if (line.length + 1 + remaining.length <= width) {
        line += ` ${remaining}`;
      } else {
        lines.push(line);
        line = remaining;
      }
    }

    lines.push(line);
  }

  return lines;
}

const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(Math.max(low, high), value));

/** A message window: where it sits, and what it says. */
export interface TextWindow {
  /** Wrapped lines, already at their final width. */
  lines: readonly string[];
  /** Top-left cell of the text. */
  column: number;
  row: number;
  foreground: number;
  background: number;
  /** The colour of the line ruled round the window. */
  border: number;
}

/**
 * Lay a message out as a window, centred unless a position is given.
 *
 * The window is sized from the text rather than fixed, and then nudged back
 * onto the screen if the text is wide or the requested position is near an
 * edge -- a window half off the screen loses the half that mattered.
 */
export function layOutWindow(
  text: string,
  options: {
    width?: number | undefined;
    column?: number | undefined;
    row?: number | undefined;
    foreground?: number | undefined;
    background?: number | undefined;
    border?: number | undefined;
  } = {},
): TextWindow {
  const width = options.width ?? WINDOW_TEXT_WIDTH;
  const lines = wrapText(text, width);
  const textWidth = Math.max(1, ...lines.map((line) => line.length));
  const textHeight = lines.length;

  const column = clamp(options.column ?? Math.floor((COLUMNS - textWidth) / 2), 0, COLUMNS - textWidth);
  const row = clamp(options.row ?? Math.floor((ROWS - textHeight) / 2), 1, Math.max(1, ROWS - textHeight - 1));

  return {
    lines,
    column,
    row,
    foreground: options.foreground ?? DEFAULT_TEXT_COLOUR,
    background: options.background ?? DEFAULT_BACKGROUND_COLOUR,
    border: options.border ?? WINDOW_BORDER_COLOUR,
  };
}

/**
 * Draw a laid-out window.
 *
 * Three layers, outwards in: the whole box in the window's background colour,
 * a single-pixel line ruled a little way inside it, and the text. The line is
 * inside the box rather than around it, so there is background on both sides of
 * it -- a white margin, then red, then the padding the text sits in. That is
 * what the original looks like, and it is why this reaches for pixels rather
 * than staying in cells.
 */
export function drawWindow(
  display: Display,
  window: TextWindow,
  cell: CellMetrics = IBM_CELL,
): void {
  const textWidth = Math.max(1, ...window.lines.map((line) => line.length));
  // The padding is a cell on every side, so it follows the driver's cell
  // rather than staying at EGA's eight pixels.
  const padX = cell.width;
  const padY = cell.height;
  const left = window.column * cell.width - padX;
  const top = window.row * cell.height - padY;
  const width = textWidth * cell.width + padX * 2;
  const height = window.lines.length * cell.height + padY * 2;

  display.fillRect(left, top, width, height, window.background);
  strokeRect(
    display,
    left + BORDER_INSET,
    top + BORDER_INSET,
    width - BORDER_INSET * 2,
    height - BORDER_INSET * 2,
    window.border,
  );

  window.lines.forEach((line, index) => {
    drawText(
      display,
      line,
      window.column,
      window.row + index,
      window.foreground,
      window.background,
      cell,
    );
  });
}

/** A one-pixel rectangle outline, as four thin fills. */
function strokeRect(
  display: Display,
  x: number,
  y: number,
  width: number,
  height: number,
  colour: number,
): void {
  display.fillRect(x, y, width, 1, colour);
  display.fillRect(x, y + height - 1, width, 1, colour);
  display.fillRect(x, y, 1, height, colour);
  display.fillRect(x + width - 1, y, 1, height, colour);
}

/**
 * The text plane: what has been written into character cells.
 *
 * AGI's text is not painted onto the picture, it lives in its own grid of
 * cells that the picture shows through wherever nothing has been written. That
 * distinction is what lets `clear.lines` take a caption away and reveal the
 * scene underneath, and it is why this is a layer rather than a set of draw
 * calls into the framebuffer.
 *
 * A cell holds a character code of 0 to mean "nothing here". Clearing to a
 * colour is not the same as emptying: it writes spaces in that colour, because
 * `clear.lines(22, 24, 0)` is how a game blacks out the input area rather than
 * how it makes it transparent.
 */
export class TextLayer {
  readonly chars = new Uint8Array(COLUMNS * ROWS);
  readonly foreground = new Uint8Array(COLUMNS * ROWS);
  readonly background = new Uint8Array(COLUMNS * ROWS);

  static index(column: number, row: number): number {
    return row * COLUMNS + column;
  }

  /** Write a string starting at a cell, clipped at the right edge. */
  write(text: string, column: number, row: number, foreground: number, background: number): void {
    if (row < 0 || row >= ROWS) return;

    for (let i = 0; i < text.length; i++) {
      const at = column + i;
      if (at < 0) continue;
      if (at >= COLUMNS) break;

      const cell = TextLayer.index(at, row);
      this.chars[cell] = text.charCodeAt(i);
      this.foreground[cell] = foreground;
      this.background[cell] = background;
    }
  }

  /** Fill whole rows with spaces of one colour. */
  fillRows(from: number, to: number, colour: number): void {
    this.fillCells(0, from, COLUMNS - 1, to, colour);
  }

  /** Fill a rectangle of cells with spaces of one colour. */
  fillCells(
    fromColumn: number,
    fromRow: number,
    toColumn: number,
    toRow: number,
    colour: number,
  ): void {
    const left = Math.max(0, Math.min(fromColumn, toColumn));
    const right = Math.min(COLUMNS - 1, Math.max(fromColumn, toColumn));
    const top = Math.max(0, Math.min(fromRow, toRow));
    const bottom = Math.min(ROWS - 1, Math.max(fromRow, toRow));

    for (let row = top; row <= bottom; row++) {
      for (let column = left; column <= right; column++) {
        const cell = TextLayer.index(column, row);
        this.chars[cell] = 0x20;
        this.foreground[cell] = colour;
        this.background[cell] = colour;
      }
    }
  }

  /** Empty a rectangle of cells, so the picture shows through again. */
  erase(fromColumn: number, fromRow: number, toColumn: number, toRow: number): void {
    const left = Math.max(0, Math.min(fromColumn, toColumn));
    const right = Math.min(COLUMNS - 1, Math.max(fromColumn, toColumn));
    const top = Math.max(0, Math.min(fromRow, toRow));
    const bottom = Math.min(ROWS - 1, Math.max(fromRow, toRow));

    for (let row = top; row <= bottom; row++) {
      this.chars.fill(0, TextLayer.index(left, row), TextLayer.index(right, row) + 1);
    }
  }

  /** Whether nothing has been written on a row. */
  rowIsEmpty(row: number): boolean {
    if (row < 0 || row >= ROWS) return true;
    const start = TextLayer.index(0, row);
    return this.chars.subarray(start, start + COLUMNS).every((code) => code === 0);
  }

  clear(): void {
    this.chars.fill(0);
  }

  /** Draw every written cell onto a driver's framebuffer. */
  draw(display: Display, metrics: CellMetrics = IBM_CELL): void {
    for (let row = 0; row < ROWS; row++) {
      for (let column = 0; column < COLUMNS; column++) {
        const cell = TextLayer.index(column, row);
        const code = this.chars[cell]!;
        if (code === 0) continue;
        drawChar(
          display,
          code,
          column,
          row,
          this.foreground[cell]!,
          this.background[cell]!,
          metrics,
        );
      }
    }
  }
}
