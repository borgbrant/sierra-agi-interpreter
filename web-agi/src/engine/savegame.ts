/**
 * The save and restore screens.
 *
 * Both are `Interaction`s, so they suspend the cycle the same way a message
 * window or the inventory does -- the game stands still, the browser keeps
 * running, and the script carries on at the instruction after the one that
 * opened them.
 *
 * The game's own menus already offer Save and Restore, and its key bindings
 * already put them on F5 and F7, so nothing new reaches the player: the two
 * commands simply stop being stubs.
 *
 * Restoring is the one interaction that replaces the machine underneath the
 * script that asked for it. That is why {@link RestoreScreen} sets
 * `restored` rather than doing anything clever: the machine sees it on the way
 * out and abandons the rest of the cycle, exactly as `new.room` does.
 */
import type { Display } from '../render/display.ts';
import type { SaveSlot, SaveStore } from '../storage/saves.ts';
import { drawTextScreen, Interaction, type Key } from './interaction.ts';
import type { Machine } from './machine.ts';
import { applySnapshot, captureSnapshot, SaveError } from './snapshot.ts';

/**
 * How wide a save's name may be.
 *
 * Chosen from the screen rather than from taste. The restore list is the
 * tightest line: a cursor, the name, and sixteen characters of date, inside
 * forty columns.
 */
const NAME_LENGTH = 19;

/** A slot as it appears in the list: the name, then when it was written. */
function describe(slot: SaveSlot): string {
  const when = slot.savedAt.slice(0, 16).replace('T', ' ');
  return `${slot.name.padEnd(NAME_LENGTH).slice(0, NAME_LENGTH)} ${when}`;
}

/** What both screens share: a list of slots with a cursor on it. */
abstract class SlotScreen extends Interaction {
  protected readonly store: SaveStore;
  protected slots: SaveSlot[];
  protected cursor = 0;
  protected message: string | null = null;

  constructor(store: SaveStore) {
    super();
    this.store = store;
    this.slots = store.list();
  }

  protected abstract title(): string;
  protected abstract lines(): string[];

  override draw(display: Display, machine: Machine): void {
    drawTextScreen(
      display,
      [this.title(), '', ...this.lines()],
      machine.textForeground,
      machine.textBackground,
      1,
    );
  }

  protected moveCursor(key: Key, count: number): boolean {
    if (count === 0) return false;
    if (key.name === 'ArrowUp') {
      this.cursor = (this.cursor + count - 1) % count;
      return true;
    }
    if (key.name === 'ArrowDown') {
      this.cursor = (this.cursor + 1) % count;
      return true;
    }
    return false;
  }
}

/**
 * Saving: type a name, press Enter.
 *
 * The name is offered already filled in with the room number, because a save
 * with no name at all is the one thing a player cannot tell apart later.
 */
export class SaveScreen extends SlotScreen {
  #name: string;
  #saved = false;

  constructor(store: SaveStore, machine: Machine) {
    super(store);
    this.#name = `Room ${machine.state.room}`;
  }

  /** Whether a game was actually written. */
  get saved(): boolean {
    return this.#saved;
  }

  protected override title(): string {
    return 'SAVE GAME';
  }

  protected override lines(): string[] {
    const lines = ['Name this saved game, then press ENTER:', '', `  ]${this.#name}_`, ''];

    if (this.slots.length > 0) {
      lines.push('Saved games (a name already used is replaced):', '');
      for (const slot of this.slots) lines.push(`  ${describe(slot)}`);
      lines.push('');
    }

    if (!this.store.available) lines.push('This browser will not let the game save.', '');
    if (this.message) lines.push(this.message, '');

    lines.push('ESC to cancel.');
    return lines;
  }

  override key(machine: Machine, key: Key): boolean {
    if (key.name === 'Escape') return true;

    if (key.name === 'Enter') {
      const name = this.#name.trim();
      if (name === '') {
        this.message = 'A saved game needs a name.';
        return false;
      }

      try {
        this.store.save(name, captureSnapshot(machine));
        this.#saved = true;
        return true;
      } catch (error) {
        // Reported on the screen the player is looking at, because this is the
        // moment they are trying not to lose anything.
        this.message = error instanceof Error ? error.message : 'the save could not be written';
        this.slots = this.store.list();
        return false;
      }
    }

    if (key.name === 'Backspace') {
      this.#name = this.#name.slice(0, -1);
      return false;
    }

    if (key.char >= 0x20 && key.char <= 0x7e && this.#name.length < NAME_LENGTH) {
      this.#name += String.fromCharCode(key.char);
    }
    return false;
  }
}

/** Restoring: pick a save, press Enter. */
export class RestoreScreen extends SlotScreen {
  /** Set once a game has been put back, for the machine to act on. */
  restored = false;

  protected override title(): string {
    return 'RESTORE GAME';
  }

  protected override lines(): string[] {
    if (this.slots.length === 0) {
      return [
        this.store.available
          ? 'There are no saved games.'
          : 'This browser will not let the game save or restore.',
        '',
        'Press ENTER or ESC to go back.',
      ];
    }

    const lines = ['Choose a saved game:', ''];
    this.slots.forEach((slot, index) => {
      lines.push(`  ${index === this.cursor ? '>' : ' '} ${describe(slot)}`);
    });
    lines.push('');
    if (this.message) lines.push(this.message, '');
    lines.push('ENTER restores, D deletes, ESC cancels.');
    return lines;
  }

  override key(machine: Machine, key: Key): boolean {
    if (key.name === 'Escape') return true;
    if (this.moveCursor(key, this.slots.length)) return false;

    if (key.name === 'Enter') {
      const slot = this.slots[this.cursor];
      if (!slot) return true;

      try {
        applySnapshot(machine, slot.snapshot);
        this.restored = true;
        return true;
      } catch (error) {
        // A refused save leaves the running game exactly as it was, so there is
        // something to go back to.
        this.message =
          error instanceof SaveError ? error.message : 'this save could not be restored';
        return false;
      }
    }

    if (key.name === 'd' || key.name === 'D') {
      const slot = this.slots[this.cursor];
      if (slot) {
        this.store.remove(slot.id);
        this.slots = this.store.list();
        this.cursor = Math.min(this.cursor, Math.max(0, this.slots.length - 1));
      }
      return false;
    }

    return false;
  }

  override finish(machine: Machine): void {
    // The script that called restore.game is running in a game that no longer
    // exists. The machine unwinds out of it; see Machine.run.
    if (this.restored) machine.restored = true;
  }
}
