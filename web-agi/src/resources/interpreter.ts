/**
 * What the interpreter beside the game says about itself.
 *
 * `AGIDATA.OVL` carries the version as text, in the line the original prints
 * when it is asked what it is:
 *
 * ```text
 * lsl1  0xaac    "    Version 2.440\0\0Press ENTE..."
 * kq1   0xacc    "    Version 2.917\0\0Press ENTE..."
 * ```
 *
 * It matters because the version decides how many commands the bytecode reader
 * will accept, and a reader that accepts too many walks off the end of a script
 * into whatever follows it. Until M18 the version was a constant naming the
 * bundled game's interpreter, which is the kind of thing that is right until
 * there is a second game.
 *
 * It turned out not to be what stopped King's Quest I -- all ninety of its
 * scripts decode at 2.440's count of 170, and the highest opcode it uses is 162
 * where Larry's own scripts reach 169. So this is insurance rather than a
 * repair: it is a *third* game, built with an interpreter that added commands,
 * that needs it. Insurance is worth having when it costs a regular expression.
 */
import { COMMAND_COUNT_BY_INTERPRETER, INTERPRETER_VERSION } from '../logic/opcodes.ts';
import { DEFAULT_COMMAND_COUNT } from '../logic/reader.ts';

/** A version string, and what the reader should do with it. */
export interface InterpreterVersion {
  /** As printed in the file, or the engine's default when it was not found. */
  readonly version: string;
  /** How many action opcodes that version defines. */
  readonly commandCount: number;
  /** Whether the version was read from the file rather than assumed. */
  readonly read: boolean;
  /** Why the file's own version was not used, when it was not. */
  readonly why?: string;
}

/** The text the version follows, and the shape of the number after it. */
const VERSION_TEXT = /Version (\d\.\d{3}(?:\.\d+)?)/;

/**
 * Read the version out of `AGIDATA.OVL`.
 *
 * A file with no such line, or with a version this engine has no command count
 * for, falls back to the bundled game's -- the rule every interpreter file here
 * follows. A wrong count is worse than a missing file only if it is *higher*
 * than the truth, and the fallback is the lowest of the modern ones.
 *
 * @param bytes the whole of `AGIDATA.OVL`, or undefined if it is not there
 */
export function readInterpreterVersion(bytes?: Uint8Array): InterpreterVersion {
  const fallback = (why: string): InterpreterVersion => ({
    version: INTERPRETER_VERSION,
    commandCount: DEFAULT_COMMAND_COUNT,
    read: false,
    why,
  });

  if (!bytes) return fallback('AGIDATA.OVL is not bundled with this game');

  // Latin-1 rather than UTF-8: the file is 8 KB of 8086 code with strings in
  // it, and decoding it as UTF-8 would turn some of that code into replacement
  // characters and could swallow a byte of the text being looked for.
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);

  const found = VERSION_TEXT.exec(text);
  if (!found) return fallback('AGIDATA.OVL holds no version line');

  const version = found[1]!;
  const commandCount = COMMAND_COUNT_BY_INTERPRETER[version];
  if (commandCount === undefined) {
    return {
      ...fallback(`AGI ${version} is not a version this engine has a command count for`),
      version,
    };
  }

  return { version, commandCount, read: true };
}
