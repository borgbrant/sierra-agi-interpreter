import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  directoryLengthWarning,
  entryCount,
  parseDirEntry,
  parseDirectory,
  requireResource,
} from '../src/agi/directory.js';
import { ERROR_CODES } from '../src/util/errors.js';
import { dirEntry, MISSING } from './helpers.js';

test('parses the volume number from the high nibble', () => {
  assert.equal(parseDirEntry(dirEntry(0, 0), 0).volume, 0);
  assert.equal(parseDirEntry(dirEntry(7, 0), 0).volume, 7);
  assert.equal(parseDirEntry(Buffer.from([0xe0, 0x00, 0x00]), 0).volume, 0x0e);
});

test('parses the 20-bit offset from the low nibble plus the next two bytes', () => {
  assert.equal(parseDirEntry(dirEntry(3, 0x0abcde), 0).offset, 0x0abcde);
  assert.equal(parseDirEntry(Buffer.from([0x0f, 0xff, 0xfe]), 0).offset, 0xffffe);
});

test('marks FF FF FF as missing', () => {
  const entry = parseDirEntry(MISSING, 0);
  assert.deepEqual(entry, { id: 0, present: false });
});

test('numbers resources by their index in the file', () => {
  const buffer = Buffer.concat([dirEntry(0, 5), MISSING, dirEntry(2, 7)]);
  assert.deepEqual(
    parseDirectory(buffer).map((e) => [e.id, e.present]),
    [
      [0, true],
      [1, false],
      [2, true],
    ],
  );
});

test('parseDirectory returns the documented record shape', () => {
  assert.deepEqual(parseDirectory(dirEntry(0, 123456)), [
    { id: 0, present: true, volume: 0, offset: 123456 },
  ]);
});

test('warns about a length that is not divisible by 3, and ignores the trailing bytes', () => {
  const buffer = Buffer.concat([dirEntry(0, 1), Buffer.from([0x00, 0x00])]);

  assert.match(directoryLengthWarning(buffer, 'LOGDIR'), /LOGDIR length 5 is not a multiple of 3/);
  assert.equal(entryCount(buffer), 1);
  assert.equal(parseDirectory(buffer).length, 1);
});

test('does not warn about a well-formed length', () => {
  assert.equal(directoryLengthWarning(Buffer.concat([dirEntry(0, 1), MISSING])), null);
  assert.equal(directoryLengthWarning(Buffer.alloc(0)), null);
});

test('an empty directory file holds no entries', () => {
  assert.deepEqual(parseDirectory(Buffer.alloc(0)), []);
});

test('requireResource rejects an id past the end of the file', () => {
  assert.throws(() => requireResource(dirEntry(0, 1), 5, 'logic'), {
    code: ERROR_CODES.RESOURCE_ID_OUT_OF_RANGE,
    type: 'logic',
    id: 5,
  });
});

test('requireResource rejects an entry marked missing', () => {
  assert.throws(() => requireResource(MISSING, 0, 'pic'), {
    code: ERROR_CODES.RESOURCE_MISSING,
    type: 'pic',
  });
});

test('requireResource returns the location of a present entry', () => {
  const buffer = Buffer.concat([MISSING, dirEntry(2, 4096)]);
  assert.deepEqual(requireResource(buffer, 1, 'view'), {
    id: 1,
    present: true,
    volume: 2,
    offset: 4096,
  });
});
