import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildHandlers } from '../src/engine/commands/index.ts';
import { Machine } from '../src/engine/machine.ts';
import { formatMessage } from '../src/engine/message.ts';
import { FLAG, VAR } from '../src/engine/state.ts';
import {
  parseInput,
  saidMatches,
  WORD_ANYWORD,
  WORD_REST_OF_LINE,
} from '../src/input/parser.ts';
import { ResourceManager } from '../src/resources/manager.ts';
import { parseObjectFile } from '../src/resources/objects.ts';
import { Vocabulary } from '../src/resources/words.ts';
import { DiskSource } from './helpers/disk-source.ts';

const source = await DiskSource.open();
const resources = await ResourceManager.open(source);
await resources.preload();
const objects = parseObjectFile((await source.read('OBJECT'))!);
const vocabulary = Vocabulary.parse((await source.read('WORDS.TOK'))!);

function machine(): Machine {
  const m = new Machine({ resources, objects, vocabulary });
  m.setHandlers(buildHandlers());
  return m;
}

const numbers = (line: string) => parseInput(line, vocabulary).words.map((w) => w.number);

// --- Parsing ---------------------------------------------------------------

test('words come back as the numbers the scripts test', () => {
  const look = vocabulary.lookup('look');
  assert.ok(look !== undefined, 'the game knows the word "look"');
  assert.deepEqual(numbers('look'), [look]);
});

test('synonyms reduce to the same number', () => {
  // This is the whole point of the vocabulary: the scripts test one number and
  // every phrasing the author allowed satisfies it.
  const get = vocabulary.lookup('get');
  const take = vocabulary.lookup('take');
  assert.equal(get, take, 'the game treats these as the same word');
});

test('ignorable words are dropped before matching', () => {
  // "the" is in the vocabulary numbered 0, which means "ignore me".
  assert.equal(vocabulary.lookup('the'), 0);
  assert.deepEqual(numbers('look at the sign'), numbers('look sign'));
});

test('punctuation ends a word without becoming one', () => {
  assert.deepEqual(numbers('look at the sign.'), numbers('look sign'));
  assert.deepEqual(numbers('look, please!'), numbers('look'));
});

test('the longest vocabulary entry wins', () => {
  // Multi-word entries exist, and matching the first word alone would consume
  // the wrong thing. Find a real one in the game's own word list.
  const phrase = vocabulary.entries.find((entry) => entry.word.includes(' '));
  assert.ok(phrase, 'the game has multi-word vocabulary entries');

  const parsed = parseInput(phrase.word, vocabulary);
  assert.deepEqual(
    parsed.words.map((w) => w.word),
    [phrase.word],
    `"${phrase.word}" is one word, not ${parsed.words.length}`,
  );
});

test('an unknown word is reported by position, and the rest is kept', () => {
  const parsed = parseInput('look zzzyx sign', vocabulary);
  assert.equal(parsed.unknownWordPosition, 2, 'the second word is the unknown one');
  assert.equal(parsed.words[1]!.number, null);
  assert.equal(parsed.words[1]!.word, 'zzzyx', 'kept as typed, for the message that names it');
});

test('a line the game understands reports no unknown word', () => {
  assert.equal(parseInput('look', vocabulary).unknownWordPosition, 0);
  assert.equal(parseInput('', vocabulary).unknownWordPosition, 0);
});

// --- said ------------------------------------------------------------------

const typed = (...ns: (number | null)[]) => ns.map((number) => ({ word: '', number }));

test('said matches only when every word is accounted for', () => {
  assert.equal(saidMatches([1000], typed(1000)), true);
  assert.equal(saidMatches([1000], typed(1000, 2000)), false, 'the player said more');
  assert.equal(saidMatches([1000, 2000], typed(1000)), false, 'the player said less');
  assert.equal(saidMatches([1000], typed(2000)), false);
});

test('word 1 stands for any single word', () => {
  assert.equal(saidMatches([1000, WORD_ANYWORD], typed(1000, 55)), true);
  assert.equal(saidMatches([1000, WORD_ANYWORD], typed(1000)), false, 'there must be a word');
});

test('word 9999 swallows whatever is left', () => {
  assert.equal(saidMatches([1000, WORD_REST_OF_LINE], typed(1000, 55, 66)), true);
  assert.equal(saidMatches([1000, WORD_REST_OF_LINE], typed(1000)), true, 'even nothing');
});

test('a said test needs a line, and claims it once', () => {
  const m = machine();
  const look = vocabulary.lookup('look')!;

  assert.equal(m.said([look]), false, 'nothing has been typed');

  m.submitLine('look');
  assert.equal(m.state.getFlag(FLAG.PLAYER_COMMAND_ENTERED), true);
  assert.equal(m.said([look]), true);
  assert.equal(m.state.getFlag(FLAG.SAID_ACCEPTED_INPUT), true);

  // A second test cannot also claim it, or one sentence would fire every test
  // it happens to fit.
  assert.equal(m.said([look]), false);
});

test('submitting a line reports the unknown word to the scripts', () => {
  const m = machine();
  m.submitLine('look zzzyx');
  assert.equal(m.state.getVar(VAR.UNKNOWN_WORD), 2);
  assert.equal(m.lastLine, 'look zzzyx');
});

// --- Message substitution --------------------------------------------------

test('a variable is substituted, and padded when a width is given', () => {
  const m = machine();
  m.state.setVar(30, 7);
  assert.equal(formatMessage(m, 'score %v30 points'), 'score 7 points');
  assert.equal(formatMessage(m, 'score %v30|3 points'), 'score 007 points');
});

test('an item name is substituted, counting from one', () => {
  const m = machine();
  const first = m.inventory.nameOf(0);
  assert.equal(formatMessage(m, 'you see %o1'), `you see ${first}`);
});

test('a string and a typed word are substituted', () => {
  const m = machine();
  m.state.setString(2, 'Larry');
  m.submitLine('look zzzyx');

  assert.equal(formatMessage(m, 'hello %s2'), 'hello Larry');
  assert.equal(formatMessage(m, "what's a %w2?"), "what's a zzzyx?");
});

test('a message can substitute another message, recursively', () => {
  // The game's own text does this, so it is not a hypothetical.
  const m = machine();
  const compiled = m.compile(1);
  m.currentLogic = compiled;

  const inner = compiled.resource.messages.texts.findIndex((t) => t !== null && t.length > 0);
  assert.ok(inner > 0, 'logic 1 has messages');

  const expected = formatMessage(m, compiled.resource.messages.texts[inner]!);
  assert.equal(formatMessage(m, `%m${inner}`), expected);
});

test('runaway recursion stops instead of hanging', () => {
  const m = machine();
  // A message that refers to itself would expand forever; the depth limit
  // turns that into a bounded result rather than a locked-up tab.
  m.currentLogic = {
    id: 99,
    resource: { bytecode: new Uint8Array(), messages: { texts: ['%m0'], count: 1 } } as never,
    instructions: [],
    indexAt: new Map(),
    scanStart: 0,
  };
  const out = formatMessage(m, '%m0');
  assert.equal(typeof out, 'string');
});

test('an escape the interpreter does not know is left visible', () => {
  const m = machine();
  assert.equal(formatMessage(m, '100%'), '100%', 'a trailing percent is just a percent');
  assert.equal(formatMessage(m, '50% off'), '50% off');
  assert.equal(formatMessage(m, '%q7 here'), '%q7 here');
});
