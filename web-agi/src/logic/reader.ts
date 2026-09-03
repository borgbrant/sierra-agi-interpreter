/**
 * Decoding LOGIC bytecode into instructions.
 *
 * Two shapes are irregular and cannot be described by the opcode table:
 *
 *   - `said` takes a count byte followed by that many 16-bit word numbers.
 *   - an `if` opens with 0xFF, lists conditions until a closing 0xFF, and is
 *     followed by a 16-bit distance to skip when the condition is false.
 *     0xFD negates the condition that follows it, and 0xFC brackets a group of
 *     ORed conditions. `else` is 0xFE plus its own 16-bit distance.
 */
import {
  actionFor,
  COMMAND_COUNT_BY_INTERPRETER,
  INTERPRETER_VERSION,
  MARKER,
  SAID,
  TESTS,
  VARIADIC,
} from './opcodes.ts';

export class BytecodeError extends Error {
  readonly code = 'BYTECODE_MALFORMED';
  readonly at: number;

  constructor(message: string, at: number) {
    super(`${message} (at byte ${at})`);
    this.at = at;
  }
}

export type Condition =
  | { kind: 'test'; opcode: number; name: string; args: number[] }
  | { kind: 'said'; words: number[] }
  | { kind: 'not'; condition: Condition }
  | { kind: 'or'; conditions: Condition[] };

export type Instruction =
  | { kind: 'action'; at: number; size: number; opcode: number; name: string; args: number[] }
  | { kind: 'if'; at: number; size: number; conditions: Condition[]; skip: number; target: number }
  | { kind: 'else'; at: number; size: number; skip: number; target: number };

/** How many action commands the target interpreter knows. */
export const DEFAULT_COMMAND_COUNT = COMMAND_COUNT_BY_INTERPRETER[INTERPRETER_VERSION]!;

/** Decode a whole bytecode block. */
export function decodeLogic(
  bytecode: Uint8Array,
  commandCount = DEFAULT_COMMAND_COUNT,
): Instruction[] {
  const out: Instruction[] = [];
  let at = 0;

  while (at < bytecode.length) {
    const instruction = decodeInstruction(bytecode, at, commandCount);
    out.push(instruction);
    at += instruction.size;
  }

  return out;
}

/** Decode the single instruction starting at `at`. */
export function decodeInstruction(
  bytecode: Uint8Array,
  at: number,
  commandCount = DEFAULT_COMMAND_COUNT,
): Instruction {
  const opcode = bytecode[at];
  if (opcode === undefined) throw new BytecodeError('reading past the end of the bytecode', at);

  if (opcode === MARKER.IF) return decodeIf(bytecode, at, commandCount);

  if (opcode === MARKER.ELSE) {
    const skip = readWord(bytecode, at + 1);
    // The distance is measured from just after the two-byte field.
    return { kind: 'else', at, size: 3, skip, target: at + 3 + skip };
  }

  const command = actionFor(opcode, commandCount);
  if (!command) {
    throw new BytecodeError(
      `unknown action opcode 0x${opcode.toString(16).padStart(2, '0')}; ` +
        `this interpreter knows ${commandCount} commands`,
      at,
    );
  }

  const args: number[] = [];
  for (let i = 0; i < command.args; i++) {
    const byte = bytecode[at + 1 + i];
    if (byte === undefined) {
      throw new BytecodeError(`arguments to ${command.name} run past the bytecode`, at);
    }
    args.push(byte);
  }

  return { kind: 'action', at, size: 1 + command.args, opcode, name: command.name, args };
}

/** Decode an if-block header: conditions plus the distance to skip. */
function decodeIf(bytecode: Uint8Array, at: number, commandCount: number): Instruction {
  let cursor = at + 1;
  const conditions: Condition[] = [];

  while (true) {
    const byte = bytecode[cursor];
    if (byte === undefined) throw new BytecodeError('unterminated if condition', at);
    if (byte === MARKER.IF) {
      cursor++;
      break;
    }

    const [condition, next] = decodeCondition(bytecode, cursor, commandCount);
    conditions.push(condition);
    cursor = next;
  }

  const skip = readWord(bytecode, cursor);
  cursor += 2;

  return { kind: 'if', at, size: cursor - at, conditions, skip, target: cursor + skip };
}

/** Decode one condition, returning it and the position after it. */
function decodeCondition(
  bytecode: Uint8Array,
  at: number,
  commandCount: number,
): [Condition, number] {
  const opcode = bytecode[at];
  if (opcode === undefined) throw new BytecodeError('condition runs past the bytecode', at);

  if (opcode === MARKER.NOT) {
    const [condition, next] = decodeCondition(bytecode, at + 1, commandCount);
    return [{ kind: 'not', condition }, next];
  }

  if (opcode === MARKER.OR) {
    const conditions: Condition[] = [];
    let cursor = at + 1;

    while (true) {
      const byte = bytecode[cursor];
      if (byte === undefined) throw new BytecodeError('unterminated or group', at);
      if (byte === MARKER.OR) {
        cursor++;
        break;
      }
      const [condition, next] = decodeCondition(bytecode, cursor, commandCount);
      conditions.push(condition);
      cursor = next;
    }

    return [{ kind: 'or', conditions }, cursor];
  }

  if (opcode === SAID) {
    // A count of words, then that many 16-bit word numbers.
    const count = bytecode[at + 1];
    if (count === undefined) throw new BytecodeError('said has no argument count', at);

    const words: number[] = [];
    for (let i = 0; i < count; i++) {
      const lo = bytecode[at + 2 + i * 2];
      const hi = bytecode[at + 3 + i * 2];
      if (lo === undefined || hi === undefined) {
        throw new BytecodeError('said word list runs past the bytecode', at);
      }
      words.push(lo | (hi << 8));
    }

    return [{ kind: 'said', words }, at + 2 + count * 2];
  }

  const test = TESTS[opcode];
  if (!test) {
    throw new BytecodeError(
      `unknown test opcode 0x${opcode.toString(16).padStart(2, '0')}`,
      at,
    );
  }
  if (test.args === VARIADIC) {
    throw new BytecodeError(`${test.name} needs its own decoding`, at);
  }

  const args: number[] = [];
  for (let i = 0; i < test.args; i++) {
    const byte = bytecode[at + 1 + i];
    if (byte === undefined) {
      throw new BytecodeError(`arguments to ${test.name} run past the bytecode`, at);
    }
    args.push(byte);
  }

  return [{ kind: 'test', opcode, name: test.name, args }, at + 1 + test.args];
}

/**
 * Read a jump displacement.
 *
 * These are signed: a negative distance jumps backwards, which is how the
 * bytecode expresses a loop. Read unsigned, a backward jump becomes an
 * enormous forward one and lands far outside the resource.
 */
function readWord(bytecode: Uint8Array, at: number): number {
  const lo = bytecode[at];
  const hi = bytecode[at + 1];
  if (lo === undefined || hi === undefined) {
    throw new BytecodeError('a 16-bit field runs past the bytecode', at);
  }
  const value = lo | (hi << 8);
  return value >= 0x8000 ? value - 0x10000 : value;
}
