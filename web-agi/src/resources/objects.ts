/**
 * The OBJECT file: the game's inventory items and the size of the view table.
 *
 * Layout, after decryption:
 *
 *   byte 0-1   offset of the first item name, relative to byte 3
 *   byte 2     maximum number of animated objects
 *   byte 3..   three bytes per item: a 2-byte name offset, then a room number
 *   names      null-terminated strings
 *
 * Item name offsets are relative to the start of the item table, not the file.
 */
import { AVIS_DURGAN, readCString, xorCycle } from './crypt.ts';
import { ResourceError, ERROR_CODES } from './errors.ts';

/** A starting room of 255 means the player is already carrying the item. */
export const CARRIED = 255;

/** Bytes per entry in the item table. */
const ENTRY_SIZE = 3;

export interface InventoryItem {
  id: number;
  name: string;
  /** Room the item starts in, or CARRIED. */
  room: number;
}

export interface ObjectFile {
  items: readonly InventoryItem[];
  /** Upper bound on simultaneously animated screen objects. */
  maxAnimatedObjects: number;
  /** Whether the file on disk was obfuscated. */
  encrypted: boolean;
}

/** Does this byte sequence look like a plausible OBJECT file? */
function plausible(bytes: Uint8Array): boolean {
  if (bytes.length < ENTRY_SIZE) return false;

  const tableLength = bytes[0]! | (bytes[1]! << 8);
  if (tableLength <= 0 || tableLength % ENTRY_SIZE !== 0) return false;

  const count = tableLength / ENTRY_SIZE;
  // The table must fit, and leave room for at least one name byte per item.
  return count > 0 && ENTRY_SIZE + tableLength + count <= bytes.length + count;
}

/**
 * Parse OBJECT, decrypting it if it turns out to be obfuscated.
 *
 * Some early games ship it in the clear, so which it is has to be detected
 * rather than assumed.
 *
 * @param bytes the whole file
 * @param key   the obfuscation key, should the file need one
 */
export function parseObjectFile(bytes: Uint8Array, key = AVIS_DURGAN): ObjectFile {
  let data = bytes;
  let encrypted = false;

  if (!plausible(data)) {
    data = xorCycle(bytes, key);
    encrypted = true;

    if (!plausible(data)) {
      throw new ResourceError(
        ERROR_CODES.OBJECT_MALFORMED,
        'OBJECT parses as neither plain nor obfuscated data',
      );
    }
  }

  const tableLength = data[0]! | (data[1]! << 8);
  const maxAnimatedObjects = data[2]!;
  const count = tableLength / ENTRY_SIZE;

  const items: InventoryItem[] = [];
  for (let id = 0; id < count; id++) {
    const at = ENTRY_SIZE + id * ENTRY_SIZE;
    // Offsets are measured from the start of the item table.
    const nameOffset = ENTRY_SIZE + (data[at]! | (data[at + 1]! << 8));
    const room = data[at + 2]!;

    if (nameOffset >= data.length) {
      throw new ResourceError(
        ERROR_CODES.OBJECT_MALFORMED,
        `Item ${id} names a string at ${nameOffset}, past the end of a ${data.length}-byte file`,
      );
    }

    items.push({ id, name: readCString(data, nameOffset), room });
  }

  return { items, maxAnimatedObjects, encrypted };
}
