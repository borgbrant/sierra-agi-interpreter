import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const GAME_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'game');

interface ManifestEntry {
  name: string;
  bytes: number;
}

interface Manifest {
  source: string;
  generated: string;
  files: ManifestEntry[];
}

const manifest: Manifest = JSON.parse(await readFile(join(GAME_DIR, 'manifest.json'), 'utf8'));
const names = manifest.files.map((f) => f.name);
const bytesOf = (name: string) => manifest.files.find((f) => f.name === name)?.bytes;

test('the manifest lists every file the engine reads', () => {
  for (const required of ['LOGDIR', 'PICDIR', 'VIEWDIR', 'SNDDIR', 'OBJECT', 'WORDS.TOK']) {
    assert.ok(names.includes(required), `missing ${required}`);
  }
  assert.ok(
    names.some((name) => /^VOL\.\d+$/.test(name)),
    'at least one VOL file',
  );
});

test('the manifest lists nothing the engine does not read', () => {
  // The DOS executables and the CGA/Hercules overlays are deliberately not
  // copied; shipping them would serve bytes the engine never opens.
  const allowed = /^(LOGDIR|PICDIR|VIEWDIR|SNDDIR|OBJECT|WORDS\.TOK|VOL\.\d+)$/;
  for (const name of names) assert.match(name, allowed);
});

test('every listed file is on disk at the recorded size', async () => {
  for (const entry of manifest.files) {
    const { size } = await stat(join(GAME_DIR, entry.name));
    assert.equal(size, entry.bytes, `${entry.name} size`);
  }
});

test('the resource directories are whole 3-byte entries', async () => {
  for (const name of ['LOGDIR', 'PICDIR', 'VIEWDIR', 'SNDDIR']) {
    const size = bytesOf(name);
    assert.ok(size !== undefined && size > 0, `${name} is present and not empty`);
    assert.equal(size % 3, 0, `${name} length is a multiple of 3`);
  }
});

test('each volume file starts with a resource header signature', async () => {
  const volumes = names.filter((name) => /^VOL\.\d+$/.test(name));

  for (const name of volumes) {
    const head = (await readFile(join(GAME_DIR, name))).subarray(0, 2);
    assert.deepEqual([...head], [0x12, 0x34], `${name} begins with 0x12 0x34`);
  }
});

test('volume numbering starts at 0 and has no gaps', () => {
  const numbers = names
    .filter((name) => /^VOL\.\d+$/.test(name))
    .map((name) => Number(name.slice(4)))
    .sort((a, b) => a - b);

  assert.deepEqual(numbers, numbers.map((_, i) => i));
});
