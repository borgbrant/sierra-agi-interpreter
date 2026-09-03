import { AgiError, ERROR_CODES } from '../util/errors.js';

/** Size in bytes of an AGI v2 VOL resource header. */
export const VOL_HEADER_SIZE = 5;

/** Signature bytes at the start of every AGI v2 VOL resource header. */
const VOL_SIGNATURE = Object.freeze([0x12, 0x34]);

/**
 * @typedef {object} VolResource
 * @property {number} volume
 * @property {number} offset        Offset of the resource header in the VOL file.
 * @property {number} headerLength  Always 5 for AGI v2.
 * @property {number} payloadLength Declared payload length, little-endian.
 * @property {Buffer} [payload]     Present unless the read was header-only.
 */

/**
 * Validate a 5-byte AGI v2 VOL header already sitting in a buffer.
 *
 * @param {Buffer | Uint8Array} buffer
 * @param {number} expectedVolume
 * @param {number} offset  Offset of the header within `buffer`.
 * @param {number} [reportedOffset]  Offset named in error messages; defaults to
 *   `offset`. Callers reading a header into a standalone buffer pass the offset
 *   within the VOL file, so errors point at the file rather than the scratch buffer.
 * @returns {{ volume: number, payloadLength: number, headerLength: number }}
 */
export function parseVolHeader(buffer, expectedVolume, offset = 0, reportedOffset = offset) {
  if (buffer[offset] !== VOL_SIGNATURE[0] || buffer[offset + 1] !== VOL_SIGNATURE[1]) {
    const got = [buffer[offset], buffer[offset + 1]]
      .map((b) => (b === undefined ? '??' : `0x${b.toString(16).padStart(2, '0')}`))
      .join(' ');
    throw new AgiError(
      ERROR_CODES.INVALID_VOL_SIGNATURE,
      `Expected 0x12 0x34 at VOL.${expectedVolume} offset ${reportedOffset}, got ${got}.`,
    );
  }

  const volume = buffer[offset + 2];
  if (volume !== expectedVolume) {
    throw new AgiError(
      ERROR_CODES.VOL_NUMBER_MISMATCH,
      `Header volume byte ${volume} does not match VOL.${expectedVolume} at offset ${reportedOffset}.`,
    );
  }

  return {
    volume,
    payloadLength: buffer[offset + 3] | (buffer[offset + 4] << 8),
    headerLength: VOL_HEADER_SIZE,
  };
}
