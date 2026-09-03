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
import { COLUMNS, layOutWindow, WINDOW_TEXT_WIDTH, type TextWindow } from '../render/text.ts';
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

  override draw(frame: Frame, _machine: Machine): void {
    // Black on white, like every other message box, and deliberately not the
    // machine's text attribute: that colours text written into character cells,
    // and a game that left it on white-on-black would otherwise ask its
    // questions in a black box.
    const window = layOutWindow(`${this.prompt}${this.text}_`, {
      width: WINDOW_TEXT_WIDTH,
      column: this.column,
      row: this.row,
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
