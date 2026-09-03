/**
 * The command line.
 *
 * Unlike a message window this does not stop the game: the player types while
 * the world carries on moving, and only pressing Enter hands a line to the
 * scripts. That is why it is a line editor with state rather than an
 * interaction the cycle waits on.
 *
 * Submitting a line does not run anything by itself. It raises the "the player
 * entered a command" flag and parks the parsed words where `said` tests can
 * find them; the next cycle's scripts do the rest. A line therefore always
 * takes effect on a cycle boundary, never in the middle of one.
 */
import { COLUMNS } from '../render/text.ts';

/** The cursor AGI shows where the next character will be typed. */
export const DEFAULT_CURSOR = '_';

/**
 * The marker the input line starts with, until the game supplies its own.
 *
 * AGI keeps it in string 0, and this game writes `]` there -- the DOS prompt
 * the whole genre borrowed. It is a different thing from the cursor: the marker
 * leads the line, the cursor follows what has been typed.
 */
export const DEFAULT_PROMPT = ']';

export class Prompt {
  /** What the player has typed so far. */
  text = '';

  /** The cursor drawn after the typed text. `set.cursor.char` changes it. */
  cursorChar = DEFAULT_CURSOR;

  /** How long a line may get. Set from the reserved variable. */
  maxLength = 40;

  /** Whether the line is shown and accepting keys. */
  visible = true;

  /**
   * Take a key.
   *
   * @returns the finished line when Enter was pressed, otherwise null
   */
  key(char: number, name: string): string | null {
    if (name === 'Enter') {
      const line = this.text;
      this.text = '';
      return line;
    }

    if (name === 'Backspace') {
      this.text = this.text.slice(0, -1);
      return null;
    }

    if (name === 'Escape') {
      this.text = '';
      return null;
    }

    if (char >= 0x20 && char <= 0x7e && this.text.length < this.limit) {
      this.text += String.fromCharCode(char);
    }
    return null;
  }

  /** Longest line that fits both the game's limit and the screen. */
  get limit(): number {
    return Math.max(1, Math.min(this.maxLength, COLUMNS - 2));
  }

  /**
   * The line as it should appear on screen, marker and cursor included.
   *
   * @param prompt the marker the line starts with, from string 0
   */
  render(prompt = DEFAULT_PROMPT): string {
    return `${prompt}${this.text}${this.cursorChar}`.slice(0, COLUMNS);
  }

  clear(): void {
    this.text = '';
  }
}
