/**
 * A LOGIC resource: bytecode followed by the text it can print.
 *
 * The payload, once the 5-byte VOL header is stripped, opens with a 16-bit
 * offset to the message section. Bytecode runs from just past that field up to
 * where the messages begin.
 */
import { parseMessages, type Messages } from './messages.ts';

/** Bytes of the header that precedes the bytecode. */
export const HEADER_SIZE = 2;

export interface LogicResource {
  /** Executable bytes, with positions measured from the start of this array. */
  readonly bytecode: Uint8Array;
  readonly messages: Messages;
  /** Offset of the message section within the payload, for diagnostics. */
  readonly messageSectionStart: number;
}

export class LogicFormatError extends Error {
  readonly code = 'LOGIC_MALFORMED';
}

/**
 * Split a LOGIC payload into its bytecode and its messages.
 *
 * @param payload raw LOGIC bytes, without the VOL header
 */
export function parseLogic(payload: Uint8Array): LogicResource {
  if (payload.length < HEADER_SIZE) {
    throw new LogicFormatError(`LOGIC resource is ${payload.length} bytes, too short for a header`);
  }

  const messageSectionStart = HEADER_SIZE + (payload[0]! | (payload[1]! << 8));
  if (messageSectionStart > payload.length) {
    throw new LogicFormatError(
      `message section starts at ${messageSectionStart}, past the end of a ${payload.length}-byte resource`,
    );
  }

  return {
    bytecode: payload.subarray(HEADER_SIZE, messageSectionStart),
    messages: parseMessages(payload.subarray(messageSectionStart)),
    messageSectionStart,
  };
}
