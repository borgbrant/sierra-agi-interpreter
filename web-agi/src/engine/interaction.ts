/**
 * Things the game stops and waits for.
 *
 * A message window, a question, a menu: in the original these block inside the
 * command that opened them. The interpreter draws the window, spins waiting for
 * a key, then carries on from the next instruction. An engine that runs inside
 * a browser frame cannot block, and the plan is explicit that the loop models
 * waiting as a state rather than by blocking -- otherwise input stops being
 * processed exactly when input is what the game is waiting for.
 *
 * So a command that needs to wait returns one of these instead. The machine
 * yields it, the cycle parks, and the script resumes at the instruction after
 * the one that waited. The blocking is real, in the sense that matters: the
 * script does not run on without its answer.
 *
 * Each interaction knows three things -- how to draw itself, what to do with a
 * key, and what to write back when it ends -- which keeps the cycle from
 * needing to know what kind of thing it is waiting for.
 */
import type { Frame } from '../render/frame.ts';
import {
  COLUMNS,
  DEFAULT_BACKGROUND_COLOUR,
  DEFAULT_TEXT_COLOUR,
  layOutWindow,
  ROWS,
  WINDOW_BORDER_COLOUR,
  WINDOW_TEXT_WIDTH,
  type TextWindow,
} from '../render/text.ts';
import type { Machine } from './machine.ts';
import { VAR } from './state.ts';

/** A key, as an interaction needs to see it. */
export interface Key {
  /** Character code, or 0 for a key with no character. */
  char: number;
  /** The browser's name for the key, so arrows and Enter can be told apart. */
  name: string;
  /** The physical key, which is what distinguishes the numeric keypad. */
  code: string;
  /**
   * Whether Alt was held.
   *
   * Alt+letter is its own kind of key rather than a modified character: the PC
   * reports it with no character at all and only the letter's scan code, and
   * that is how the games bind it.
   */
  alt?: boolean;
}

/**
 * A box with a title and a field to type into.
 *
 * The shape a mono display asks for anything in, and photographs of the real
 * thing show it twice over -- once for the command line and once for the
 * game's "How old are you?". Three lines, and the middle one is the point:
 *
 * ```text
 *   +--------------------------------------+
 *   |            ENTER COMMAND             |   the title, centred
 *   |                                      |   a blank line
 *   | [talk girl_                         ]|   the field, inverse video
 *   +--------------------------------------+
 * ```
 *
 * The field is a second layer over the window's own third line rather than
 * part of it, because a window is one pair of colours throughout -- and on a
 * two-colour display swapping ink and ground is the only way left to show that
 * a field is a field. The blank line between is what keeps the two from
 * reading as one paragraph.
 *
 * @param title  centred on the first line
 * @param field  what has been typed, with its cursor
 */
function promptBox(frame: Frame, title: string, field: string): void {
  const indent = Math.max(0, Math.floor((PROMPT_BOX_WIDTH - title.length) / 2));
  const line = field.slice(0, PROMPT_BOX_WIDTH).padEnd(PROMPT_BOX_WIDTH);

  const window: TextWindow = {
    // Built rather than laid out. This is a box of a fixed shape and not a
    // wrapped message, and `layOutWindow` sizes a window from its text -- a
    // line of nothing but spaces wraps away to nothing, leaving a box no wider
    // than its own title.
    lines: [
      `${' '.repeat(indent)}${title}`.padEnd(PROMPT_BOX_WIDTH),
      ' '.repeat(PROMPT_BOX_WIDTH),
      line,
    ],
    column: Math.floor((COLUMNS - PROMPT_BOX_WIDTH) / 2),
    row: PROMPT_BOX_ROW,
    foreground: DEFAULT_TEXT_COLOUR,
    background: DEFAULT_BACKGROUND_COLOUR,
    border: WINDOW_BORDER_COLOUR,
  };

  frame.window(window);
  frame.text(line, window.column, window.row + 2, window.background, window.foreground);
}

/** How wide the box is, in cells. Nearly the screen, as the original's is. */
const PROMPT_BOX_WIDTH = 36;

/**
 * The row the box's title sits on.
 *
 * Half way down AGI's 25-row grid, which is where the photograph puts it: the
 * title on row 12 of Hercules' 29 and the field on 14. Centring in the grid
 * rather than in the screen is what makes those two agree, because the grid is
 * shorter than a mono screen -- 25 twelve-row cells is 300 of 348 pixels.
 */
const PROMPT_BOX_ROW = Math.floor(ROWS / 2);

/** Something the game is waiting for. */
export abstract class Interaction {
  /**
   * Add itself to the frame, over whatever is already in it.
   *
   * Cells and windows rather than pixels: an interaction is drawn by the
   * running display driver like everything else, so a message box on a
   * Hercules screen is a Hercules message box without this knowing.
   */
  abstract draw(frame: Frame, machine: Machine): void;

  /**
   * Take a key.
   *
   * @returns true when the interaction is over
   */
  abstract key(machine: Machine, key: Key): boolean;

  /**
   * Write the result back into the game state.
   *
   * Called exactly once, when the interaction ends, however it ended.
   */
  finish(_machine: Machine): void {}

  /**
   * Let time pass.
   *
   * @returns true when the interaction has closed itself
   */
  tick(_elapsedMs: number): boolean {
    return false;
  }
}

/**
 * The game standing still until a key is pressed, with nothing of its own on
 * screen.
 *
 * The scripts' own way of waiting, and the one kind of wait no command asks
 * for. A help or puzzle screen writes itself into the character cells and then
 * spins on `if (!have.key()) goto self` -- which works in the original because
 * the interpreter reads the keyboard from inside that loop, and cannot work
 * here, where a key can only arrive between cycles. So the machine recognises
 * the spin and parks on this instead; see `Machine.run`.
 *
 * It draws nothing: what the player should be looking at is whatever the script
 * has already put on the screen.
 */
export class KeyPress extends Interaction {
  override draw(): void {}

  override key(machine: Machine, key: Key): boolean {
    // Keys with no character -- arrows, function keys -- are not what these
    // loops are waiting for: the script tests the key variable for a non-zero
    // value, so anything else would send it straight back round the loop.
    if (key.char === 0) return false;

    machine.state.setVar(VAR.KEY_PRESSED, key.char);
    // Taken out of the buffer as well, or the next cycle hands the same key to
    // the game a second time and a keypress that dismissed a help screen also
    // fires whatever else that key is bound to.
    machine.keyboard.takeKey();
    return true;
  }
}

/**
 * A message on screen, dismissed by any key.
 *
 * A script can ask for windows that close themselves, through the reserved
 * "window close delay" variable. That is measured in half-seconds, which is why
 * the conversion is here and not at the call site.
 */
export class MessageWindow extends Interaction {
  readonly window: TextWindow;

  #remainingMs: number | null;

  constructor(window: TextWindow, closeAfterHalfSeconds = 0) {
    super();
    this.window = window;
    this.#remainingMs = closeAfterHalfSeconds > 0 ? closeAfterHalfSeconds * 500 : null;
  }

  override draw(frame: Frame): void {
    frame.window(this.window);
  }

  override key(_machine: Machine, _key: Key): boolean {
    return true;
  }

  override tick(elapsedMs: number): boolean {
    if (this.#remainingMs === null) return false;
    this.#remainingMs -= elapsedMs;
    return this.#remainingMs <= 0;
  }
}

/**
 * A window with an editable answer on its last line.
 *
 * `get.num` and `get.string` differ only in what they accept and where the
 * answer goes, so the editing lives here once.
 */
abstract class Question extends Interaction {
  protected readonly prompt: string;
  protected readonly maxLength: number;
  protected text = '';

  /** Where the answer field starts, when the script placed it explicitly. */
  protected readonly column: number | undefined;
  protected readonly row: number | undefined;

  constructor(prompt: string, maxLength: number, column?: number, row?: number) {
    super();
    this.prompt = prompt;
    this.maxLength = Math.max(1, maxLength);
    this.column = column;
    this.row = row;
  }

  /** Whether this question accepts a character. */
  protected abstract accepts(char: number): boolean;

  override draw(frame: Frame, machine: Machine): void {
    // On a mono display the game's own questions take the same shape as its
    // command line -- the prompt on one line and the answer in an inverse
    // field below -- which is what photographs of the real thing show for
    // "How old are you?". A script's own placement is ignored there: the box
    // has a fixed shape and a fixed place, and it is a place the photographs
    // show rather than one a script chose.
    if (machine.monochrome) {
      promptBox(frame, this.prompt.trim(), `${this.text}_`);
      return;
    }

    // Black on white, like every other message box, and deliberately not the
    // machine's text attribute: that colours text written into character cells,
    // and a game that left it on white-on-black would otherwise ask its
    // questions in a black box.
    const window = layOutWindow(`${this.prompt}${this.text}_`, {
      width: WINDOW_TEXT_WIDTH,
      column: this.column,
      row: this.row,
      minRow: machine.layout.minPrintRow,
    });
    frame.window(window);
  }

  override key(_machine: Machine, key: Key): boolean {
    if (key.name === 'Enter') return true;

    if (key.name === 'Backspace') {
      this.text = this.text.slice(0, -1);
      return false;
    }

    if (this.text.length < this.maxLength && this.accepts(key.char)) {
      this.text += String.fromCharCode(key.char);
    }
    return false;
  }
}

/** `get.num`: a number, written into a variable. */
export class NumberQuestion extends Question {
  readonly variable: number;

  constructor(prompt: string, variable: number) {
    // A variable holds one byte, so three digits is as much as can be meant.
    super(prompt, 3);
    this.variable = variable;
  }

  protected override accepts(char: number): boolean {
    return char >= 0x30 && char <= 0x39;
  }

  override finish(machine: Machine): void {
    // An empty answer is zero, which is what the original leaves behind, and
    // what the game's own age question then rejects.
    machine.state.setVar(this.variable, Number(this.text || '0') & 0xff);
  }
}

/** `get.string`: a line of text, written into one of the interpreter's strings. */
export class StringQuestion extends Question {
  readonly index: number;

  constructor(prompt: string, index: number, maxLength: number, column?: number, row?: number) {
    super(prompt, maxLength, column, row);
    this.index = index;
  }

  protected override accepts(char: number): boolean {
    return char >= 0x20 && char <= 0x7e;
  }

  override finish(machine: Machine): void {
    machine.state.setString(this.index, this.text);
  }
}

/**
 * A full-screen page of text, as `text.screen` and the inventory use.
 *
 * Unlike a window it covers the picture entirely, so it is drawn as a filled
 * screen rather than a box.
 */
export function drawTextScreen(
  frame: Frame,
  lines: readonly string[],
  foreground: number,
  background: number,
  topRow = 0,
): void {
  frame.fill(background);
  lines.forEach((line, index) => {
    frame.text(line.slice(0, COLUMNS), 0, topRow + index, foreground, background);
  });
}

/**
 * The command line, on a display that puts it in a box.
 *
 * Photographs of the real thing show one: a box over the scene, with `ENTER
 * COMMAND` centred in it and the line being typed beneath in inverse video,
 * while the screen's bottom rows carry the game's own text instead.
 *
 * Not because there is nowhere else to put it -- that was the first explanation
 * and it was wrong. Rows 22 to 24 exist on Hercules as on every adapter, and
 * the game writes on them nineteen times. The original *chose* a box, and why
 * is not recoverable from three screenshots; that it did is not in doubt.
 *
 * It is an interaction and not a layer of the frame, which is the whole
 * difference between this and the command line on a colour display. That one
 * sits on a row of its own and the world keeps moving while the player types.
 * This one covers the scene, so the scene has to hold still: the box appears
 * when the player starts typing, the cycle parks on it, and the game carries on
 * when the line is handed over. A box over a moving picture that the player is
 * also reading would be the worst of both.
 *
 * Three ways out, and two of them are the same key going backwards. Enter hands
 * the line to the scripts. Escape abandons it. And backspacing away the last
 * character closes the box too -- it opened because a key was pressed, so
 * un-pressing that key should undo it rather than leave the player shut in.
 *
 * The line carries no `]`. That marker is what AGI keeps in string 0 and what
 * this game writes there, and it belongs to the input *row*; the box announces
 * itself with a title instead, and the photograph shows the field holding
 * nothing but what was typed.
 *
 * The shape is {@link promptBox}, which the game's own questions share --
 * because the photographs show them sharing it.
 */
export class CommandLine extends Interaction {
  /** What the box calls itself. */
  static readonly TITLE = 'ENTER COMMAND';

  #text: string;
  #cursorChar: string;
  #maxLength: number;
  #submitted = false;

  /**
   * @param first      the character that opened the box
   * @param cursorChar the cursor to draw after the text, from `set.cursor.char`
   * @param maxLength  how long a line may get, from the reserved variable
   */
  constructor(first: string, cursorChar: string, maxLength: number) {
    super();
    this.#text = first;
    this.#cursorChar = cursorChar;
    this.#maxLength = Math.max(1, maxLength);
  }

  /** What has been typed so far, without the cursor. */
  get text(): string {
    return this.#text;
  }

  override draw(frame: Frame): void {
    promptBox(frame, CommandLine.TITLE, `${this.#text}${this.#cursorChar}`);
  }

  override key(_machine: Machine, key: Key): boolean {
    if (key.name === 'Enter') {
      this.#submitted = true;
      return true;
    }

    if (key.name === 'Escape') return true;

    if (key.name === 'Backspace') {
      this.#text = this.#text.slice(0, -1);
      // Emptied, the box has nothing left to be, so it goes.
      return this.#text === '';
    }

    if (this.#text.length < this.#maxLength && key.char >= 0x20 && key.char <= 0x7e) {
      this.#text += String.fromCharCode(key.char);
    }
    return false;
  }

  override finish(machine: Machine): void {
    // The machine's own prompt is left empty either way: this box keeps its own
    // text, so a line abandoned here does not turn up on the input row of a
    // display the player switches to next.
    machine.prompt.clear();
    if (this.#submitted) machine.submitLine(this.#text);
  }
}
