import { AgiError, ERROR_CODES } from '../util/errors.js';

/** Size in bytes of one AGI v2 directory entry. */
export const DIR_ENTRY_SIZE = 3;

/**
 * @typedef {object} ResourceLocation
 * @property {number} id       Resource number, implied by the entry's index.
 * @property {boolean} present False for the `FF FF FF` missing-resource marker.
 * @property {number} [volume] VOL.n holding the resource (present entries only).
 * @property {number} [offset] Byte offset of the resource header (present entries only).
 */

/**
 * Parse a single 3-byte directory entry.
 *
 *   byte 0: high nibble = volume number, low nibble = offset bits 16-19
 *   byte 1: offset bits 8-15
 *   byte 2: offset bits 0-7
 *
 * @param {Buffer | Uint8Array} buffer
 * @param {number} id
 * @returns {ResourceLocation}
 */
export function parseDirEntry(buffer, id) {
  const base = id * DIR_ENTRY_SIZE;
  const a = buffer[base];
  const b = buffer[base + 1];
  const c = buffer[base + 2];

  if (a === 0xff && b === 0xff && c === 0xff) {
    return { id, present: false };
  }

  return {
    id,
    present: true,
    volume: a >> 4,
    offset: ((a & 0x0f) << 16) | (b << 8) | c,
  };
}

/**
 * Number of whole entries a directory file holds.
 *
 * @param {Buffer | Uint8Array} buffer
 * @returns {number}
 */
export function entryCount(buffer) {
  return Math.floor(buffer.length / DIR_ENTRY_SIZE);
}

/**
 * Policy for a directory file whose length is not a multiple of 3: warn and
 * ignore the trailing bytes, rather than reject the whole file. A stray byte at
 * the end of a decades-old dump should not cost you every resource in it.
 *
 * @param {Buffer | Uint8Array} buffer
 * @param {string} [label] file name used in the warning text
 * @returns {string | null} warning text, or null when the length is well-formed
 */
export function directoryLengthWarning(buffer, label = 'directory file') {
  const extra = buffer.length % DIR_ENTRY_SIZE;
  if (extra === 0) return null;
  return (
    `${label} length ${buffer.length} is not a multiple of ${DIR_ENTRY_SIZE}; ` +
    `ignoring ${extra} trailing byte(s).`
  );
}

/**
 * Parse a whole directory file into resource location records, including the
 * missing ones (so callers can tell "not present" from "out of range").
 *
 * @param {Buffer | Uint8Array} buffer
 * @returns {ResourceLocation[]}
 */
export function parseDirectory(buffer) {
  const count = entryCount(buffer);
  const entries = new Array(count);
  for (let id = 0; id < count; id++) {
    entries[id] = parseDirEntry(buffer, id);
  }
  return entries;
}

/**
 * Look up one resource, distinguishing an id past the end of the file from an
 * entry that is explicitly marked missing.
 *
 * @param {Buffer | Uint8Array} buffer
 * @param {number} id
 * @param {string} [type] for error reporting
 * @returns {ResourceLocation} always `present: true`
 */
export function requireResource(buffer, id, type) {
  if (id >= entryCount(buffer)) {
    throw new AgiError(
      ERROR_CODES.RESOURCE_ID_OUT_OF_RANGE,
      `Resource ${id} is outside the directory file, which holds ${entryCount(buffer)} entries.`,
      { type, id },
    );
  }

  const entry = parseDirEntry(buffer, id);
  if (!entry.present) {
    throw new AgiError(
      ERROR_CODES.RESOURCE_MISSING,
      `Resource ${id} is marked missing (FF FF FF) in the directory file.`,
      { type, id },
    );
  }
  return entry;
}

