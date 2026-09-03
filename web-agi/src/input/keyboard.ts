/**
 * The keyboard, as the game sees it.
 *
 * AGI's walking controls are not "hold a key to move". A direction key sets
 * ego walking that way and ego keeps walking until told otherwise; pressing the
 * same key again stops. That is why this is a small state machine rather than a
 * set of held-key booleans, and why it is worth testing on its own.
 *
 * The state machine is separated from the DOM so it can be driven directly in a
 * test. {@link bindKeyboard} is the only part that needs a browser.
 */
import type { Key } from '../engine/interaction.ts';
import { DIRECTION } from '../engine/viewtable.ts';

/** Which direction each key names. */
const DIRECTION_KEYS: Record<string, number> = {
  ArrowUp: DIRECTION.NORTH,
  ArrowRight: DIRECTION.EAST,
  ArrowDown: DIRECTION.SOUTH,
  ArrowLeft: DIRECTION.WEST,
  // The numeric keypad is the original's real control: it has the diagonals.
  Numpad8: DIRECTION.NORTH,
  Numpad9: DIRECTION.NORTH_EAST,
  Numpad6: DIRECTION.EAST,
  Numpad3: DIRECTION.SOUTH_EAST,
  Numpad2: DIRECTION.SOUTH,
  Numpad1: DIRECTION.SOUTH_WEST,
  Numpad4: DIRECTION.WEST,
  Numpad7: DIRECTION.NORTH_WEST,
  Numpad5: DIRECTION.NONE,
};

/** Character codes for the keys whose name is longer than the character. */
const NAMED_KEYS: Record<string, number> = {
  Enter: 13,
  Escape: 27,
  Backspace: 8,
  Tab: 9,
  ' ': 32,
};

export class Keyboard {
  /** The direction ego has been told to walk, 0-8. */
  direction: number = DIRECTION.NONE;

  /** Code of the last key pressed, consumed once per cycle. */
  #pending = 0;

  /**
   * Record a key as "the key just pressed".
   *
   * Every key is recorded, whatever else goes on to consume it. The reserved
   * variable is a raw last-key buffer, not a queue of keys nothing else
   * wanted: scripts that read it clear it first and then watch it, which is
   * how the game's own multiple-choice questions work while the command line
   * is still on screen.
   */
  note(char: number): void {
    if (char !== 0) this.#pending = char;
  }

  /**
   * Steer ego with a direction key.
   *
   * @param key  the event's `key`
   * @param code the event's `code`, which distinguishes the keypad
   * @returns whether this was a direction key
   */
  press(key: string, code = key): boolean {
    const named = DIRECTION_KEYS[code] ?? DIRECTION_KEYS[key];

    if (named !== undefined) {
      // Pressing the direction you are already walking stops you. Without this
      // there is no way to stand still with the arrow keys alone.
      this.direction = named === this.direction ? DIRECTION.NONE : named;
      return true;
    }

    return false;
  }

  /**
   * Take the key waiting to be reported, clearing it.
   *
   * The cycle clears the keyboard buffer before it polls, so a key is seen by
   * exactly one cycle rather than by every cycle until the next keypress.
   */
  takeKey(): number {
    const key = this.#pending;
    this.#pending = 0;
    return key;
  }

  /** Stop ego and drop any pending key, as leaving player control does. */
  clear(): void {
    this.direction = DIRECTION.NONE;
    this.#pending = 0;
  }
}

/**
 * The key a name stands for.
 *
 * For callers holding a key's name rather than a browser event -- the shell
 * uses {@link keyFromEvent}, but tests and any scripted input need the same
 * translation, and Tab meaning character 9 is exactly the sort of thing that
 * goes wrong when it is written out twice.
 */
export function keyNamed(name: string, code = name): Key {
  const named = NAMED_KEYS[name];
  return { char: named ?? (name.length === 1 ? name.charCodeAt(0) : 0), name, code };
}

/** The letter of a physical key, for the modifier combinations. */
function letterOf(code: string): string | null {
  return /^Key[A-Z]$/.test(code) ? code.slice(3) : null;
}

/**
 * Turn a browser key event into the key the engine works with.
 *
 * A one-character `key` is the character itself; everything else is a named
 * key with no character, which is exactly the distinction the engine draws
 * between typing and pressing.
 *
 * The modifier combinations need their own translation, because the games bind
 * them and the PC reported them in two particular ways. Ctrl+letter arrives as
 * a control character -- Ctrl+B is 2, which is what the bundled game binds its
 * boss key to. Alt+letter arrives as no character at all plus the letter's scan
 * code, which is what "Quit  &lt;Alt-Z&gt;" in the game's own menu means. Both are
 * read off the *physical* key rather than the event's character, since a
 * browser may report Alt+X as some accented letter instead.
 */
export function keyFromEvent(event: KeyboardEvent): Key {
  const letter = letterOf(event.code);

  if (event.altKey && letter) {
    return { char: 0, name: letter, code: event.code, alt: true };
  }

  if (event.ctrlKey && letter) {
    // Ctrl+A is 1, Ctrl+B is 2, and so on up to Ctrl+Z at 26.
    return { char: letter.charCodeAt(0) - 0x40, name: letter, code: event.code };
  }

  const named = NAMED_KEYS[event.key];
  const char = named ?? (event.key.length === 1 ? event.key.charCodeAt(0) : 0);
  return { char, name: event.key, code: event.code };
}

/**
 * Send the window's key events to the engine.
 *
 * The engine decides what each key means -- it may be an answer to a question,
 * a menu choice, a letter being typed, or a direction to walk -- so nothing is
 * filtered here beyond the browser's own shortcuts.
 *
 * @param handle  called with each key; return true if the engine claimed it
 * @returns a function that unbinds
 */
export function bindKeyboard(
  handle: (key: Key) => boolean,
  target: Window = window,
): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    // Ctrl and Alt combinations are the game's own shortcuts and have to get
    // through -- the boss key is Ctrl+B and the menu advertises Alt+Z to quit.
    // The platform's command modifier is left alone, so the browser's real
    // shortcuts keep working.
    if (event.metaKey) return;
    if (handle(keyFromEvent(event))) event.preventDefault();
  };

  target.addEventListener('keydown', onKeyDown);
  return () => target.removeEventListener('keydown', onKeyDown);
}
