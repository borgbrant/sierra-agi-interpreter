/**
 * The message section at the tail of a LOGIC resource.
 *
 * Layout, measured against every LOGIC resource in the bundled game:
 *
 *   section[0]      number of messages
 *   section[1..2]   end position of the section
 *   section[3..]    count x 2 offsets, 16-bit, NOT obfuscated;
 *                   relative to section + 1, and 0 means the message is absent
 *   then            null-terminated strings, obfuscated
 *
 * Two details decide whether readable text comes out, and neither is stated
 * outright in the format documentation:
 *
 *   - An offset of 0 marks an absent message rather than one at position zero.
 *     Message numbering is sparse; slots are skipped.
 *   - The cipher key restarts at the start of the strings region, not at the
 *     start of the section or of the resource. Decrypting every message in the
 *     game under each candidate anchor, only this one yields 100% printable
 *     characters; the others fall to roughly 90%.
 */
import { AVIS_DURGAN, latin1 } from '../resources/crypt.ts';

/** Messages are numbered from 1 in the bytecode; index 0 is never used. */
export interface Messages {
  /** Indexed by message number; null where a slot is unused. */
  readonly texts: readonly (string | null)[];
  /** How many slots the section declares. */
  readonly count: number;
}

/**
 * Parse and decrypt a message section.
 *
 * @param section bytes from the start of the message section to the end of the
 *                resource
 * @param key     the obfuscation key
 */
export function parseMessages(section: Uint8Array, key = AVIS_DURGAN): Messages {
  if (section.length === 0) return { texts: [null], count: 0 };

  const count = section[0]!;
  const stringsStart = 3 + count * 2;

  // Decrypt only the strings, with the key restarting where they begin.
  const plain = new Uint8Array(section.length);
  plain.set(section);
  for (let i = stringsStart; i < section.length; i++) {
    plain[i] = section[i]! ^ key.charCodeAt((i - stringsStart) % key.length);
  }

  const texts: (string | null)[] = [null]; // message numbers start at 1

  for (let m = 0; m < count; m++) {
    const at = 3 + m * 2;
    if (at + 1 >= section.length) {
      texts.push(null);
      continue;
    }

    const offset = section[at]! | (section[at + 1]! << 8);
    if (offset === 0) {
      texts.push(null); // an unused slot
      continue;
    }

    // Offsets are measured from one byte into the section.
    const start = offset + 1;
    if (start >= plain.length) {
      texts.push(null);
      continue;
    }

    let end = start;
    while (end < plain.length && plain[end] !== 0) end++;
    texts.push(latin1(plain.subarray(start, end)));
  }

  return { texts, count };
}
