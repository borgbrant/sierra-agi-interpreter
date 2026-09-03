import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadDirectories, RESOURCE_TYPES } from '../src/resources/directory.ts';
import { ResourceManager } from '../src/resources/manager.ts';
import { DiskSource, MemorySource } from './helpers/disk-source.ts';

const source = await DiskSource.open();
const manager = await ResourceManager.open(source);

test('parses all four resource directories', async () => {
  const tables = await loadDirectories(source);

  for (const type of RESOURCE_TYPES) {
    assert.ok(tables[type].length > 0, `${type} directory has entries`);
    for (const entry of tables[type]) {
      if (!entry.present) continue;
      assert.ok(entry.volume! >= 0 && entry.volume! <= 15, `${type} ${entry.id} volume`);
      assert.ok(entry.offset! >= 0 && entry.offset! <= 0xfffff, `${type} ${entry.id} offset`);
    }
  }
});

test('reports how many resources of each type the game holds', () => {
  const counts = manager.counts();

  for (const type of RESOURCE_TYPES) {
    assert.equal(counts[type], manager.ids(type).length);
  }
  assert.ok(counts.logic > 0 && counts.pic > 0 && counts.view > 0);
});

test('loads every present resource in the game', async () => {
  // The strongest check available at this stage: if directory parsing, volume
  // caching or header validation is wrong anywhere, some resource in the game
  // will fail rather than all of them passing by luck.
  let loaded = 0;

  for (const type of RESOURCE_TYPES) {
    for (const id of manager.ids(type)) {
      const payload = await manager.load(type, id);
      assert.ok(payload.length > 0, `${type} ${id} is not empty`);
      loaded++;
    }
  }

  const expected = Object.values(manager.counts()).reduce((a, b) => a + b, 0);
  assert.equal(loaded, expected, 'every resource the directories promise');
});

test('holds the resource counts the extractor reports for this game', () => {
  // Cross-checked against agi-extract's CLI reading the same files, so this
  // pins the engine to a second, independent implementation rather than to
  // its own output.
  assert.deepEqual(manager.counts(), { logic: 46, pic: 43, view: 151, sound: 28 });
});

test('every LOGIC payload points at a message section inside itself', async () => {
  // The first two bytes are the offset to the messages. If payload extraction
  // were off by even the 5-byte VOL header, this would land outside.
  for (const id of manager.ids('logic')) {
    const payload = await manager.load('logic', id);
    assert.ok(payload.length >= 2, `logic ${id} has a header`);

    const messageStart = 2 + (payload[0]! | (payload[1]! << 8));
    assert.ok(
      messageStart <= payload.length,
      `logic ${id}: message section at ${messageStart} of ${payload.length} bytes`,
    );
  }
});

test('isPresent agrees with what can be loaded', async () => {
  const table = manager.directories.logic;
  const absent = table.findIndex((entry) => !entry.present);

  if (absent >= 0) {
    assert.equal(manager.isPresent('logic', absent), false);
    await assert.rejects(manager.load('logic', absent), { code: 'RESOURCE_MISSING' });
  }
  assert.equal(manager.isPresent('logic', manager.ids('logic')[0]!), true);
});

test('rejects a resource number past the end of the directory', async () => {
  await assert.rejects(manager.load('pic', 9999), { code: 'RESOURCE_ID_OUT_OF_RANGE' });
});

test('reports a directory file that is missing', async () => {
  await assert.rejects(loadDirectories(new MemorySource({})), { code: 'DIR_FILE_NOT_FOUND' });
});

test('reports a volume file a directory entry references but that is absent', async () => {
  const directories = Object.fromEntries(
    await Promise.all(
      RESOURCE_TYPES.map(async (type) => [
        { logic: 'LOGDIR', pic: 'PICDIR', view: 'VIEWDIR', sound: 'SNDDIR' }[type],
        (await source.read({ logic: 'LOGDIR', pic: 'PICDIR', view: 'VIEWDIR', sound: 'SNDDIR' }[type]))!,
      ]),
    ),
  ) as Record<string, Uint8Array>;

  // Same directories, but no VOL files at all.
  const crippled = await ResourceManager.open(new MemorySource(directories));
  await assert.rejects(crippled.load('logic', crippled.ids('logic')[0]!), {
    code: 'VOL_FILE_NOT_FOUND',
  });
});
