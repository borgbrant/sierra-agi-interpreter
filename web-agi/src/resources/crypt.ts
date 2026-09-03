/**
 * AGI's cyclic-XOR obfuscation, used for the OBJECT file and for the message
 * section of LOGIC resources.
 *
 * It is a shield against casual cheating, not encryption.
 */

/** The key used by Sierra's own games. */
export const AVIS_DURGAN = 'Avis Durgan';


/**
 * XOR every byte against a repeating key.
 *
 * @param bytes  the data to transform
 * @param key    the repeating key
 * @param phase  key position the first byte is XORed against; callers that
 *               decrypt a region whose key restarts partway through the file
 *               use this rather than slicing
 * @returns a new array; the input is left alone
 */
export function xorCycle(bytes: Uint8Array, key: string, phase = 0): Uint8Array {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[i] = bytes[i]! ^ key.charCodeAt((i + phase) % key.length);
  }
  return out;
}

/**
 * Decode bytes as latin1, one byte to one code point.
 *
 * Not `TextDecoder('latin1')`, which means windows-1252 and remaps 0x80-0x9F.
 */
export function latin1(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return out;
}

/** Read a null-terminated latin1 string starting at `offset`. */
export function readCString(bytes: Uint8Array, offset: number): string {
  let end = offset;
  while (end < bytes.length && bytes[end] !== 0) end++;
  return latin1(bytes.subarray(offset, end));
}
