import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  Vocabulary,
  WORD_ANYWORD,
  WORD_IGNORED,
  WORD_REST_OF_LINE,
} from '../src/resources/words.ts';
import { DiskSource } from './helpers/disk-source.ts';

const source = await DiskSource.open();
const bytes = (await source.read('WORDS.TOK'))!;
const vocabulary = Vocabulary.parse(bytes);

test('parses the whole vocabulary', () => {
  assert.ok(vocabulary.size > 500, `expected hundreds of words, got ${vocabulary.size}`);
});

test('accounts for every byte of the file', () => {
  // The packed list gives no count up front, so the only proof the decoder
  // stayed in sync is that it lands exactly on the end of the file.
  assert.equal(vocabulary.bytesRead, bytes.length);
});

test('rejects a stray byte where the terminator should be', () => {
  const broken = Uint8Array.from(bytes);
  broken[broken.length - 1] = 0x42;
  assert.throws(() => Vocabulary.parse(broken), { code: 'VOCABULARY_MALFORMED' });
});

test('entries come out in alphabetical order', () => {
  // The packing reuses a prefix of the previous entry, so it only works on a
  // sorted list. An ordering violation means the decoder lost sync.
  for (let i = 1; i < vocabulary.entries.length; i++) {
    const previous = vocabulary.entries[i - 1]!.word;
    const current = vocabulary.entries[i]!.word;
    assert.ok(previous <= current, `"${previous}" should not precede "${current}"`);
  }
});

test('every entry is non-empty and printable', () => {
  for (const { word } of vocabulary.entries) {
    assert.ok(word.length > 0, 'no empty entries');
    assert.match(word, /^[ -~]+$/, 'printable characters only');
  }
});

test('word numbers are read big-endian', () => {
  // Read little-endian the file still parses -- the same words, the same byte
  // count -- but the numbers are nonsense. These two assertions are what
  // actually distinguishes the two readings.
  const numbers = vocabulary.entries.map((e) => e.number);

  assert.ok(numbers.includes(WORD_REST_OF_LINE), 'the documented 9999 sentinel is present');
  const implausible = numbers.filter((n) => n > 2000 && n !== WORD_REST_OF_LINE);
  assert.deepEqual(implausible, [], 'no word numbers between 2000 and 9999');
});

test('the reserved word numbers are in use', () => {
  const numbers = new Set(vocabulary.entries.map((e) => e.number));
  assert.ok(numbers.has(WORD_IGNORED), 'ignored words exist');
  assert.ok(numbers.has(WORD_ANYWORD), 'the anyword marker exists');
  assert.ok(vocabulary.ignoredCount > 0);
});

test('synonyms share a number', () => {
  const byNumber = new Map<number, number>();
  for (const { number } of vocabulary.entries) {
    if (number === WORD_IGNORED) continue;
    byNumber.set(number, (byNumber.get(number) ?? 0) + 1);
  }
  const shared = [...byNumber.values()].filter((n) => n > 1).length;
  assert.ok(shared > 0, 'the game defines synonyms');
});

test('lookup finds a word by spelling, case-insensitively', () => {
  const sample = vocabulary.entries.find((e) => e.number !== WORD_IGNORED)!;
  assert.equal(vocabulary.lookup(sample.word), sample.number);
  assert.equal(vocabulary.lookup(sample.word.toUpperCase()), sample.number);
  assert.equal(vocabulary.lookup('  not a word'), undefined);
});

test('rejects a file too short to hold its letter index', () => {
  assert.throws(() => Vocabulary.parse(new Uint8Array(10)), {
    code: 'VOCABULARY_MALFORMED',
  });
});

test('rejects an entry claiming more shared characters than exist', () => {
  const broken = new Uint8Array(60);
  broken[52] = 9; // the first entry cannot share anything: there is no previous word
  assert.throws(() => Vocabulary.parse(broken), { code: 'VOCABULARY_MALFORMED' });
});
