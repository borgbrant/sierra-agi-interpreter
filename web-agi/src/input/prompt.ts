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

/** The character AGI shows where the next one will be typed. */
export const CURSOR = '_';

export class Prompt {
  /** What the player has typed so far. */
  text = '';

  /** The character the line starts with, which scripts can change. */
  cursorChar = '>';

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

  /** The line as it should appear on screen, cursor included. */
  render(): string {
    return `${this.cursorChar}${this.text}${CURSOR}`.slice(0, COLUMNS);
  }

  clear(): void {
    this.text = '';
  }
}
