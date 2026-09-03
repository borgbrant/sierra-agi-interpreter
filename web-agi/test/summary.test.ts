import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ResourceManager } from '../src/resources/manager.ts';
import { parseObjectFile } from '../src/resources/objects.ts';
import { formatSummary, summariseGame } from '../src/resources/summary.ts';
import { Vocabulary } from '../src/resources/words.ts';
import { DiskSource } from './helpers/disk-source.ts';

const source = await DiskSource.open();
const manager = await ResourceManager.open(source);
const objects = parseObjectFile((await source.read('OBJECT'))!);
const vocabulary = Vocabulary.parse((await source.read('WORDS.TOK'))!);
const summary = summariseGame(manager, objects, vocabulary);

test('summarises the loaded game', () => {
  assert.deepEqual(summary.counts, { logic: 46, pic: 43, view: 151, sound: 28 });
  assert.equal(summary.totalResources, 268);
  assert.equal(summary.items, objects.items.length);
  assert.equal(summary.words, vocabulary.size);
  assert.equal(summary.encryptedObjects, true);
});

test('renders lines naming every resource type and both data files', () => {
  const text = formatSummary(summary).join('\n');

  for (const type of ['logic', 'pic', 'view', 'sound']) {
    assert.match(text, new RegExp(`^${type}\\s+\\d+$`, 'm'), `${type} row`);
  }
  assert.match(text, /total\s+268 resources/);
  assert.match(text, /inventory items\s+\d+/);
  assert.match(text, /vocabulary\s+\d+ words/);
});
