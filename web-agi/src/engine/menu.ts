/**
 * Menus and key bindings.
 *
 * Both exist to do the same thing: turn something the player did into a
 * *controller* number, which is what scripts actually test. A menu item and a
 * function key bound to the same controller are indistinguishable to the game,
 * which is exactly how AGI games offer "Save" on both F5 and the File menu
 * without writing the logic twice.
 *
 * A controller fires for one cycle. Scripts test it with `controller(n)` and
 * expect it to have gone by the next cycle, so the set is cleared each time
 * round rather than when it is read.
 */
import type { Frame } from '../render/frame.ts';
import { COLUMNS } from '../render/text.ts';
import { Interaction, type Key } from './interaction.ts';
import type { Machine } from './machine.ts';

export interface MenuItem {
  text: string;
  controller: number;
  enabled: boolean;
}

export interface Menu {
  text: string;
  items: MenuItem[];
}

/**
 * The menu bar a game defines through `set.menu` and `set.menu.item`.
 *
 * The definition arrives one command at a time and is finished by
 * `submit.menu`; items land in whichever menu was named last.
 */
export class MenuBar {
  readonly menus: Menu[] = [];

  /** Whether `submit.menu` has run. Until it has, the bar is incomplete. */
  submitted = false;

  /** Whether the game currently offers the menu at all. */
  enabled = true;

  /** Start a new menu. Items that follow belong to it. */
  addMenu(text: string): void {
    this.menus.push({ text, items: [] });
  }

  /** Add an item to the menu most recently started. */
  addItem(text: string, controller: number): void {
    this.menus[this.menus.length - 1]?.items.push({ text, controller, enabled: true });
  }

  submit(): void {
    this.submitted = true;
  }

  /** Grey out, or restore, every item bound to a controller. */
  setEnabled(controller: number, enabled: boolean): void {
    for (const menu of this.menus) {
      for (const item of menu.items) {
        if (item.controller === controller) item.enabled = enabled;
      }
    }
  }

  /** Whether there is anything to show. */
  get isUsable(): boolean {
    return this.submitted && this.enabled && this.menus.length > 0;
  }

  /** Forget everything, as a restarted game does. */
  clear(): void {
    this.menus.length = 0;
    this.submitted = false;
  }
}

/**
 * The menu, open and being navigated.
 *
 * Escape closes it having chosen nothing, which is not the same as choosing
 * something disabled: the first fires no controller and the second cannot be
 * reached at all, because the cursor skips disabled items.
 */
export class MenuNavigation extends Interaction {
  readonly bar: MenuBar;

  #menu = 0;
  #item = 0;
  #chosen: number | null = null;

  constructor(bar: MenuBar) {
    super();
    this.bar = bar;
    this.#item = this.#firstEnabled(0);
  }

  /** The controller the player chose, or null if they backed out. */
  get chosen(): number | null {
    return this.#chosen;
  }

  override draw(frame: Frame, machine: Machine): void {
    const foreground = machine.textForeground;
    const background = machine.textBackground;

    // The bar itself sits on the status line, where the game's own status text
    // would otherwise be.
    frame.rows(0, 0, background);

    let column = 1;
    const columns: number[] = [];
    for (const menu of this.bar.menus) {
      columns.push(column);
      column += menu.text.length + 1;
    }

    this.bar.menus.forEach((menu, index) => {
      const selected = index === this.#menu;
      frame.text(
        menu.text,
        columns[index]!,
        0,
        selected ? background : foreground,
        selected ? foreground : background,
      );
    });

    // The open menu drops down under its title.
    const open = this.bar.menus[this.#menu];
    if (!open || open.items.length === 0) return;

    const width = Math.max(...open.items.map((item) => item.text.length));
    const left = Math.min(columns[this.#menu] ?? 0, Math.max(0, COLUMNS - width));

    open.items.forEach((item, index) => {
      const selected = index === this.#item;
      const text = item.text.padEnd(width);
      // A disabled item is shown, not hidden: the player should see that the
      // game has the command and that it is not available now.
      const dim = item.enabled ? foreground : 7;
      frame.text(
        text,
        left,
        1 + index,
        selected ? background : dim,
        selected ? dim : background,
      );
    });
  }

  override key(_machine: Machine, key: Key): boolean {
    const open = this.bar.menus[this.#menu];

    switch (key.name) {
      case 'Escape':
        this.#chosen = null;
        return true;

      case 'Enter': {
        const item = open?.items[this.#item];
        if (!item || !item.enabled) return false;
        this.#chosen = item.controller;
        return true;
      }

      case 'ArrowLeft':
        this.#menu = (this.#menu + this.bar.menus.length - 1) % this.bar.menus.length;
        this.#item = this.#firstEnabled(0);
        return false;

      case 'ArrowRight':
        this.#menu = (this.#menu + 1) % this.bar.menus.length;
        this.#item = this.#firstEnabled(0);
        return false;

      case 'ArrowUp':
        this.#item = this.#step(-1);
        return false;

      case 'ArrowDown':
        this.#item = this.#step(1);
        return false;

      default:
        return false;
    }
  }

  override finish(machine: Machine): void {
    if (this.#chosen !== null) machine.triggerController(this.#chosen);
  }

  /** The first enabled item at or after an index, or that index if none are. */
  #firstEnabled(from: number): number {
    const items = this.bar.menus[this.#menu]?.items ?? [];
    for (let i = from; i < items.length; i++) if (items[i]!.enabled) return i;
    return from;
  }

  /** Move the cursor, skipping disabled items and wrapping round. */
  #step(direction: number): number {
    const items = this.bar.menus[this.#menu]?.items ?? [];
    if (items.length === 0) return 0;

    let at = this.#item;
    for (let tried = 0; tried < items.length; tried++) {
      at = (at + direction + items.length) % items.length;
      if (items[at]!.enabled) return at;
    }
    return this.#item;
  }
}

/**
 * Keys a script has bound to controllers.
 *
 * A binding names either a character or one of the keys that has no character.
 * The original addressed the second kind by PC scan code; the browser gives
 * names instead, so the scan codes the games actually use are mapped once here
 * rather than being carried through the engine.
 */
export class KeyBindings {
  /** Controller by AGI key code. */
  #byCode = new Map<number, number>();

  /**
   * Bind a key.
   *
   * `set.key`'s two arguments are the low and high bytes of one 16-bit key
   * code, which is why they are combined rather than treated as alternatives:
   * a key with a character is `(char, 0)` and a key without one is
   * `(0, scanCode)`.
   *
   * @param char     low byte: the character, or 0
   * @param scanCode high byte: the PC scan code, or 0
   */
  bind(char: number, scanCode: number, controller: number): void {
    this.#byCode.set(char | (scanCode << 8), controller);
  }

  /** The controller a key fires, if any. */
  controllerFor(key: Key): number | undefined {
    for (const code of codesFor(key)) {
      const controller = this.#byCode.get(code);
      if (controller !== undefined) return controller;
    }
    return undefined;
  }

  clear(): void {
    this.#byCode.clear();
  }
}

/**
 * Every AGI key code a browser key could stand for, most specific first.
 *
 * Alt+letter is checked first and on its own, because it is the one
 * combination that carries no character: the PC reported it as the letter's
 * scan code with nothing in the low byte, and reading its character instead
 * would match the plain letter's binding.
 */
function codesFor(key: Key): number[] {
  if (key.alt) {
    const scanCode = SCAN_CODE_BY_LETTER[key.name.toUpperCase()];
    return scanCode === undefined ? [] : [scanCode << 8];
  }

  const codes: number[] = [];

  const scanCode = SCAN_CODE_BY_KEY_NAME[key.name];
  if (scanCode !== undefined) codes.push(scanCode << 8);

  if (key.char !== 0) codes.push(key.char);

  return codes;
}

/**
 * PC scan codes for the letter keys, in keyboard order rather than alphabetical.
 *
 * Only needed for Alt+letter. The bundled game's bindings confirm the table:
 * it binds scan code 44 to the menu item labelled "Quit  <Alt-Z>" and 45 to
 * the controller that skips its age questions, and Z and X are 44 and 45.
 */
const SCAN_CODE_BY_LETTER: Record<string, number> = {
  Q: 16, W: 17, E: 18, R: 19, T: 20, Y: 21, U: 22, I: 23, O: 24, P: 25,
  A: 30, S: 31, D: 32, F: 33, G: 34, H: 35, J: 36, K: 37, L: 38,
  Z: 44, X: 45, C: 46, V: 47, B: 48, N: 49, M: 50,
};

/** PC scan codes for the keys with no character, as the games use them. */
const SCAN_CODE_BY_KEY_NAME: Record<string, number> = {
  Escape: 1,
  Tab: 15,
  F1: 59,
  F2: 60,
  F3: 61,
  F4: 62,
  F5: 63,
  F6: 64,
  F7: 65,
  F8: 66,
  F9: 67,
  F10: 68,
  Home: 71,
  ArrowUp: 72,
  PageUp: 73,
  ArrowLeft: 75,
  ArrowRight: 77,
  End: 79,
  ArrowDown: 80,
  PageDown: 81,
  Insert: 82,
  Delete: 83,
};
