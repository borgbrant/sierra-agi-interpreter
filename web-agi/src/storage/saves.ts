/**
 * Where saved games are kept.
 *
 * A snapshot is about eleven kilobytes of JSON, which is small enough that this
 * is `localStorage` rather than the IndexedDB the plan called for. The reason is
 * not the size but the shape: `localStorage` is synchronous, and so is the game
 * cycle. A script calls `save.game` in the middle of a cycle and expects an
 * answer; with an asynchronous store, every dialog would have to become a state
 * machine waiting on a promise, for a database this never needs.
 *
 * Storage is also where a player loses work rather than merely sees something
 * wrong, so nothing here fails quietly: a full quota, a private window, a
 * browser with storage switched off all raise {@link StorageError} with
 * something a person can read.
 *
 * Slots are keyed by the game they belong to, so two games in the same browser
 * cannot see each other's saves.
 */
import type { GameFingerprint, Snapshot } from '../engine/snapshot.ts';

/** How many saves one game may keep, so a browser's storage cannot be filled. */
export const MAX_SLOTS = 12;

const PREFIX = 'web-agi:save';

export class StorageError extends Error {
  readonly code = 'SAVE_STORAGE';

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'StorageError';
  }
}

/** A saved game, as the player picks it out of a list. */
export interface SaveSlot {
  id: string;
  name: string;
  /** ISO timestamp, from the snapshot. */
  savedAt: string;
  room: number;
  snapshot: Snapshot;
}

/**
 * The part of `localStorage` this uses.
 *
 * An interface rather than the real thing so the store can be tested without a
 * browser -- and so a browser that refuses storage can be handled as a value
 * rather than as an exception thrown from a property access.
 */
export interface KeyValueStore {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The browser's own storage, or null where it is not available at all. */
export function browserStorage(): KeyValueStore | null {
  try {
    const storage = globalThis.localStorage;
    // Reading it is not enough: Safari's private mode gives a storage object
    // that throws only when written to, so the probe writes.
    const probe = `${PREFIX}:probe`;
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

/** Every save for one game, as the text of a file. */
export function exportSaves(store: SaveStore): string {
  return JSON.stringify({ format: 'web-agi-saves', game: store.game, slots: store.list() }, null, 2);
}

/**
 * Read a file of saves back in, adding them to the store.
 *
 * Saves keep their names, so importing a file twice replaces rather than
 * duplicates. Anything from another game is refused as a whole: a file that is
 * half applicable is not something to guess at.
 *
 * @returns how many saves were taken in
 * @throws StorageError if the file is not a set of saves for this game
 */
export function importSaves(store: SaveStore, text: string): number {
  let parsed: { format?: string; game?: string; slots?: SaveSlot[] };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch (cause) {
    throw new StorageError('that file is not a saved game', { cause });
  }

  if (parsed.format !== 'web-agi-saves' || !Array.isArray(parsed.slots)) {
    throw new StorageError('that file is not a saved game');
  }
  if (parsed.game !== store.game) {
    throw new StorageError('those saves are from a different game');
  }

  for (const slot of parsed.slots) store.save(slot.name, slot.snapshot);
  return parsed.slots.length;
}

export class SaveStore {
  readonly game: string;

  #storage: KeyValueStore | null;

  /**
   * @param fingerprint which game these saves belong to
   * @param storage     where to keep them; null means saving is unavailable,
   *                    which the dialogs report rather than pretend about
   */
  constructor(fingerprint: GameFingerprint, storage: KeyValueStore | null) {
    this.game = `${fingerprint.logic}-${fingerprint.pic}-${fingerprint.view}-${fingerprint.sound}-${fingerprint.items}`;
    this.#storage = storage;
  }

  /** Whether anything can be saved at all. */
  get available(): boolean {
    return this.#storage !== null;
  }

  /** Every slot for this game, newest first. */
  list(): SaveSlot[] {
    const storage = this.#storage;
    if (!storage) return [];

    const prefix = this.#prefix;
    const slots: SaveSlot[] = [];

    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key?.startsWith(prefix)) continue;

      const text = storage.getItem(key);
      if (!text) continue;

      // A slot that will not parse is skipped rather than thrown over: one
      // damaged save must not hide the others.
      try {
        const slot = JSON.parse(text) as SaveSlot;
        if (slot?.snapshot) slots.push(slot);
      } catch {
        continue;
      }
    }

    return slots.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }

  /**
   * Write a save, replacing one of the same name.
   *
   * Same name means the same slot, which is what a player means by saving over
   * a game.
   */
  save(name: string, snapshot: Snapshot): SaveSlot {
    const storage = this.#storage;
    if (!storage) throw new StorageError('this browser will not let the game save anything');

    const existing = this.list();
    const previous = existing.find((slot) => slot.name === name);
    if (!previous && existing.length >= MAX_SLOTS) {
      throw new StorageError(`there is room for ${MAX_SLOTS} saved games; delete one first`);
    }

    const slot: SaveSlot = {
      id: previous?.id ?? `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
      name,
      savedAt: snapshot.savedAt,
      room: snapshot.room,
      snapshot,
    };

    try {
      storage.setItem(this.#key(slot.id), JSON.stringify(slot));
    } catch (cause) {
      throw new StorageError('the save could not be written; the browser’s storage may be full', {
        cause,
      });
    }

    return slot;
  }

  /** Read one slot back, or null if it has gone. */
  load(id: string): SaveSlot | null {
    return this.list().find((slot) => slot.id === id) ?? null;
  }

  remove(id: string): void {
    this.#storage?.removeItem(this.#key(id));
  }

  get #prefix(): string {
    return `${PREFIX}:${this.game}:`;
  }

  #key(id: string): string {
    return `${this.#prefix}${id}`;
  }
}
