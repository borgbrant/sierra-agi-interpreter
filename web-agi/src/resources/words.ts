/**
 * WORDS.TOK, the vocabulary the parser matches player input against.
 *
 * Words carry a number rather than an identity: several spellings sharing one
 * number are synonyms, and `said` tests compare numbers, never spellings.
 *
 * The file is packed and lightly obfuscated. Entries are stored alphabetically
 * because each one reuses a prefix of the entry before it.
 */
import { ResourceError, ERROR_CODES } from './errors.ts';

/** Words the parser drops, such as articles. */
export const WORD_IGNORED = 0;

/** Matches any single word in a `said` test. */
export const WORD_ANYWORD = 1;

/** Matches the rest of the input line in a `said` test. */
export const WORD_REST_OF_LINE = 9999;

/** Where the packed word list begins: after the 26 two-byte letter offsets. */
const WORDS_START = 26 * 2;

export interface VocabularyEntry {
  /** The spelling, which may be a multi-word phrase. */
  word: string;
  /** The number `said` tests compare against. */
  number: number;
}

/** The game's dictionary. */
export class Vocabulary {
  readonly entries: readonly VocabularyEntry[];

  /** Bytes consumed while parsing. Equal to the file size for a sound file. */
  readonly bytesRead: number;

  #byWord: Map<string, number>;

  private constructor(entries: VocabularyEntry[], bytesRead: number) {
    this.entries = entries;
    this.bytesRead = bytesRead;
    this.#byWord = new Map(entries.map((e) => [e.word, e.number]));
  }

  get size(): number {
    return this.entries.length;
  }

  /** The word number for a spelling, or undefined if it is not in the game. */
  lookup(word: string): number | undefined {
    return this.#byWord.get(word.toLowerCase());
  }

  /** How many words the parser will discard. */
  get ignoredCount(): number {
    return this.entries.filter((e) => e.number === WORD_IGNORED).length;
  }

  /**
   * Parse WORDS.TOK.
   *
   * @param bytes the whole file
   */
  static parse(bytes: Uint8Array): Vocabulary {
    if (bytes.length <= WORDS_START) {
      throw new ResourceError(
        ERROR_CODES.VOCABULARY_MALFORMED,
        `WORDS.TOK is ${bytes.length} bytes, too short to hold its letter index`,
      );
    }

    const entries: VocabularyEntry[] = [];
    let at = WORDS_START;
    let previous = '';

    while (at < bytes.length) {
      // The word list ends with a lone 0x00 where the next entry would begin.
      if (at === bytes.length - 1) {
        if (bytes[at] !== 0) {
          throw new ResourceError(
            ERROR_CODES.VOCABULARY_MALFORMED,
            `WORDS.TOK ends with a stray byte 0x${bytes[at]!.toString(16)} after "${previous}"`,
          );
        }
        at++;
        break;
      }

      const shared = bytes[at]!;
      at++;

      if (shared > previous.length) {
        throw new ResourceError(
          ERROR_CODES.VOCABULARY_MALFORMED,
          `Entry at byte ${at - 1} reuses ${shared} characters of a ${previous.length}-character word`,
        );
      }

      let word = previous.slice(0, shared);
      let complete = false;
      while (at < bytes.length && !complete) {
        const byte = bytes[at]!;
        at++;
        // The final character of a word carries the high bit.
        complete = (byte & 0x80) !== 0;
        word += String.fromCharCode((byte & 0x7f) ^ 0x7f);
      }

      if (!complete || at + 1 >= bytes.length) {
        throw new ResourceError(
          ERROR_CODES.VOCABULARY_MALFORMED,
          `WORDS.TOK ends part-way through the entry after "${previous}"`,
        );
      }

      // Word numbers are big-endian here. So is the letter index. This is the
      // exception to AGI's little-endian convention, and reading it the usual
      // way still parses -- it just yields nonsense numbers.
      const number = (bytes[at]! << 8) | bytes[at + 1]!;
      at += 2;

      entries.push({ word, number });
      previous = word;
    }

    if (entries.length === 0) {
      throw new ResourceError(ERROR_CODES.VOCABULARY_MALFORMED, 'WORDS.TOK holds no words');
    }

    return new Vocabulary(entries, at);
  }
}
