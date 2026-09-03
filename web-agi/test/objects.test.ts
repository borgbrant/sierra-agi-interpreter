import assert from 'node:assert/strict';
import { test } from 'node:test';

import { xorCycle, AVIS_DURGAN } from '../src/resources/crypt.ts';
import { CARRIED, parseObjectFile } from '../src/resources/objects.ts';
import { DiskSource } from './helpers/disk-source.ts';

const source = await DiskSource.open();
const bytes = (await source.read('OBJECT'))!;
const objects = parseObjectFile(bytes);

test('detects that the file is obfuscated', () => {
  assert.equal(objects.encrypted, true);
});

test('reads the inventory items', () => {
  assert.ok(objects.items.length > 0);
  assert.deepEqual(
    objects.items.map((item) => item.id),
    objects.items.map((_, i) => i),
    'items are numbered from zero without gaps',
  );
});

test('every item has a printable name', () => {
  for (const item of objects.items) {
    assert.ok(item.name.length > 0, `item ${item.id} has a name`);
    assert.match(item.name, /^[ -~]+$/, `item ${item.id} is printable`);
  }
});

test('every item starts in a real room, or is carried', () => {
  for (const item of objects.items) {
    assert.ok(item.room >= 0 && item.room <= CARRIED, `item ${item.id} room ${item.room}`);
  }
});

test('reads the animated object limit', () => {
  assert.ok(objects.maxAnimatedObjects > 0 && objects.maxAnimatedObjects <= 255);
});

test('parses an unencrypted file without decrypting it', () => {
  // Some early games ship OBJECT in the clear, so which it is must be detected.
  const plain = xorCycle(bytes, AVIS_DURGAN);
  const parsed = parseObjectFile(plain);

  assert.equal(parsed.encrypted, false);
  assert.deepEqual(
    parsed.items.map((i) => i.name),
    objects.items.map((i) => i.name),
    'the same game, read either way',
  );
});

test('rejects data that is neither plain nor obfuscated', () => {
  assert.throws(() => parseObjectFile(new Uint8Array([1, 2, 3, 4, 5, 6])), {
    code: 'OBJECT_MALFORMED',
  });
});
