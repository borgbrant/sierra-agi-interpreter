/**
 * Turning what the player typed into what the scripts test.
 *
 * The game never sees the words themselves. It sees the numbers the vocabulary
 * gives them, which is how "get the lamp", "take lamp" and "pick up lamp" all
 * satisfy one `said` test: the synonyms share a number.
 *
 * Two numbers are special and are not words at all:
 *
 * ```text
 * 0     an ignorable word -- "the", "a", "please" -- dropped before matching
 * 1     matches any single word
 * 9999  matches everything remaining on the line
 * ```
 *
 * The last two only ever appear inside a `said` test, never in the player's
 * input; the first only ever comes out of the vocabulary.
 */
import {
  WORD_ANYWORD,
  WORD_IGNORED,
  WORD_REST_OF_LINE,
  type Vocabulary,
} from '../resources/words.ts';

export { WORD_ANYWORD, WORD_IGNORED, WORD_REST_OF_LINE };

/** One word of the player's input, as the parser understood it. */
export interface ParsedWord {
  /** The word as matched in the vocabulary, or as typed if it is unknown. */
  word: string;
  /** Its vocabulary number, or null when the vocabulary has never heard of it. */
  number: number | null;
}

export interface ParseResult {
  /** The words that matter, ignorable ones already dropped. */
  words: ParsedWord[];
  /**
   * Position of the first word that is not in the vocabulary at all, counting
   * from 1, or 0 when every word was understood.
   *
   * This is the distinction the scripts need: a word the vocabulary does not
   * have is "I don't know that word", while a known word in a sentence with no
   * matching `said` is "I don't understand". The reserved variable carries the
   * first, and the absence of a `said` match carries the second.
   */
  unknownWordPosition: number;
}

/** Characters that end a word without being part of it. */
const PUNCTUATION = /[.,;:!?"()\[\]{}]/g;

/**
 * Parse a line of input against the vocabulary.
 *
 * Matching is longest-first: the vocabulary contains multi-word entries such as
 * "pick up", and matching "pick" on its own would consume the wrong thing.
 *
 * @param line       what the player typed
 * @param vocabulary the game's word list
 */
export function parseInput(line: string, vocabulary: Vocabulary): ParseResult {
  const tokens = line
    .toLowerCase()
    .replace(PUNCTUATION, ' ')
    .split(/\s+/)
    .filter((token) => token !== '');

  const words: ParsedWord[] = [];
  let unknownWordPosition = 0;
  let at = 0;
  let position = 0;

  while (at < tokens.length) {
    const match = longestMatch(tokens, at, vocabulary);
    position++;

    if (!match) {
      // Unknown: report the first one and keep the rest, so a script can still
      // see the shape of what was typed.
      if (unknownWordPosition === 0) unknownWordPosition = position;
      words.push({ word: tokens[at]!, number: null });
      at++;
      continue;
    }

    // Ignorable words are dropped entirely; they never reach a `said` test.
    if (match.number !== WORD_IGNORED) {
      words.push({ word: match.word, number: match.number });
    }
    at = match.next;
  }

  return { words, unknownWordPosition };
}

/** The longest vocabulary entry starting at a token. */
function longestMatch(
  tokens: readonly string[],
  at: number,
  vocabulary: Vocabulary,
): { word: string; number: number; next: number } | null {
  for (let length = tokens.length - at; length >= 1; length--) {
    const phrase = tokens.slice(at, at + length).join(' ');
    const number = vocabulary.lookup(phrase);
    if (number !== undefined) return { word: phrase, number, next: at + length };
  }
  return null;
}

/**
 * Whether a `said` test matches what the player typed.
 *
 * The rule is exact coverage, not a prefix: every word of the test must be
 * matched and every word the player typed must be consumed. `9999` is what
 * relaxes the second half, and is why "look at the sign carefully" can satisfy
 * a test written as `said(look, sign, 9999)`.
 *
 * @param said  the word numbers the test was written with
 * @param typed the words the parser produced
 */
export function saidMatches(said: readonly number[], typed: readonly ParsedWord[]): boolean {
  let t = 0;

  for (let s = 0; s < said.length; s++) {
    const expected = said[s]!;

    if (expected === WORD_REST_OF_LINE) return true;
    if (t >= typed.length) return false;

    if (expected !== WORD_ANYWORD && expected !== typed[t]!.number) return false;
    t++;
  }

  // Every word the player typed has to be accounted for, or "open door" would
  // satisfy a test meant for "open".
  return t === typed.length;
}
