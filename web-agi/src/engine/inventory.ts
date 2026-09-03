/**
 * Where the game's objects are.
 *
 * OBJECT records where every item *starts*; from then on the item's room is
 * game state that scripts move about, so it cannot live in the parsed file.
 * This holds the current rooms, initialised from the file and reset with it.
 *
 * "Room 255" means the player is carrying it, and "room 0" means it is nowhere
 * -- dropped out of the game rather than left on the floor. Neither is a real
 * room number, which is why both have names here.
 */
import { DISPLAY_WIDTH, PICTURE_TOP, PIXEL_ASPECT, type Display } from '../render/display.ts';
import { COLUMNS, drawText, wrapText } from '../render/text.ts';
import { TRANSPARENT, type Cel } from '../render/sprite.ts';
import { CARRIED, type ObjectFile } from '../resources/objects.ts';
import { drawTextScreen, Interaction, type Key } from './interaction.ts';
import type { Machine } from './machine.ts';
import { VAR } from './state.ts';

export { CARRIED };

/** An item that has been taken out of play. */
export const NOWHERE = 0;

export class Inventory {
  readonly file: ObjectFile;

  /** Current room of each item, indexed by item number. */
  readonly rooms: Uint8Array;

  constructor(file: ObjectFile) {
    this.file = file;
    this.rooms = new Uint8Array(file.items.length);
    this.reset();
  }

  /** Put every item back where the game file says it starts. */
  reset(): void {
    this.file.items.forEach((item, index) => {
      this.rooms[index] = item.room;
    });
  }

  get count(): number {
    return this.rooms.length;
  }

  /** Whether an item number exists at all. */
  has(item: number): boolean {
    return item >= 0 && item < this.rooms.length;
  }

  roomOf(item: number): number {
    return this.rooms[item] ?? NOWHERE;
  }

  setRoom(item: number, room: number): void {
    if (this.has(item)) this.rooms[item] = room;
  }

  /** Whether the player is carrying an item. */
  isCarried(item: number): boolean {
    return this.roomOf(item) === CARRIED;
  }

  /** The player picks it up. */
  take(item: number): void {
    this.setRoom(item, CARRIED);
  }

  /** The player puts it down, out of play. */
  drop(item: number): void {
    this.setRoom(item, NOWHERE);
  }

  /** An item's name, or the empty string if there is no such item. */
  nameOf(item: number): string {
    return this.file.items[item]?.name ?? '';
  }

  /** Everything the player is carrying, in item order. */
  carried(): { id: number; name: string }[] {
    const held: { id: number; name: string }[] = [];
    for (let id = 0; id < this.rooms.length; id++) {
      if (this.rooms[id] === CARRIED) held.push({ id, name: this.nameOf(id) });
    }
    return held;
  }
}

/**
 * The inventory screen.
 *
 * Two modes, and which one is in force is a flag the game sets rather than a
 * choice the engine makes: normally the list is only shown, but with the
 * "status selects items" flag the player picks one and the choice comes back
 * through a reserved variable. Escape reports the no-choice value, which is not
 * the same as picking the first item.
 */
export class InventoryScreen extends Interaction {
  readonly items: { id: number; name: string }[];
  readonly selectable: boolean;

  #cursor = 0;
  #chosen: number | null = null;

  constructor(items: { id: number; name: string }[], selectable: boolean) {
    super();
    this.items = items;
    this.selectable = selectable;
  }

  override draw(display: Display, machine: Machine): void {
    const lines = ['You are carrying:', ''];

    if (this.items.length === 0) {
      lines.push('    nothing at all.');
    } else {
      this.items.forEach((item, index) => {
        const marker = this.selectable && index === this.#cursor ? '>' : ' ';
        lines.push(`  ${marker} ${item.name}`);
      });
    }

    lines.push('');
    lines.push(this.selectable ? 'Press ENTER to select, ESC to cancel.' : 'Press ENTER to continue.');

    drawTextScreen(display, lines, machine.textForeground, machine.textBackground, 1);
  }

  override key(_machine: Machine, key: Key): boolean {
    if (key.name === 'Escape') {
      this.#chosen = null;
      return true;
    }

    if (key.name === 'Enter') {
      this.#chosen = this.selectable ? (this.items[this.#cursor]?.id ?? null) : null;
      return true;
    }

    if (!this.selectable || this.items.length === 0) return false;

    if (key.name === 'ArrowUp') {
      this.#cursor = (this.#cursor + this.items.length - 1) % this.items.length;
    } else if (key.name === 'ArrowDown') {
      this.#cursor = (this.#cursor + 1) % this.items.length;
    }
    return false;
  }

  override finish(machine: Machine): void {
    // 255 is the interpreter's "the player chose nothing" value; a real item
    // number is never that high.
    machine.state.setVar(VAR.SELECTED_ITEM, this.#chosen ?? 0xff);
  }
}

/**
 * An item's close-up: the picture of a thing the player is holding.
 *
 * `show.obj` names a VIEW rather than an item, and the view's own description
 * is the caption. Nothing about it is drawn from the inventory state -- the
 * item and the view are connected only by the script that pairs them.
 */
export class ObjectCloseUp extends Interaction {
  readonly cel: Cel | undefined;
  readonly description: string;

  constructor(cel: Cel | undefined, description: string) {
    super();
    this.cel = cel;
    this.description = description;
  }

  override draw(display: Display, machine: Machine): void {
    const lines = wrapText(this.description, COLUMNS - 2);
    drawTextScreen(display, [], machine.textForeground, machine.textBackground);

    if (this.cel) {
      // Centred in the picture area, at the display's two-pixels-per-game-pixel.
      const left = Math.floor((DISPLAY_WIDTH - this.cel.width * PIXEL_ASPECT) / 2);
      const top = PICTURE_TOP + 20;

      for (let y = 0; y < this.cel.height; y++) {
        for (let x = 0; x < this.cel.width; x++) {
          const colour = this.cel.pixels[y * this.cel.width + x]!;
          if (colour === TRANSPARENT) continue;
          display.fillRect(left + x * PIXEL_ASPECT, top + y, PIXEL_ASPECT, 1, colour);
        }
      }
    }

    lines.forEach((line, index) => {
      drawText(display, line, 1, 1 + index, machine.textForeground, machine.textBackground);
    });
    drawText(
      display,
      'Press ENTER to continue.',
      1,
      23,
      machine.textForeground,
      machine.textBackground,
    );
  }

  override key(_machine: Machine, _key: Key): boolean {
    return true;
  }
}
