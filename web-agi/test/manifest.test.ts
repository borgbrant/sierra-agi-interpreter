import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const GAMES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'games');

interface ManifestEntry {
  name: string;
  bytes: number;
}

interface Manifest {
  id: string;
  title: string;
  interpreter?: string;
  source: string;
  generated: string;
  files: ManifestEntry[];
}

interface GameIndex {
  generated: string;
  games: { id: string; title: string; interpreter?: string; bytes?: number }[];
}

/**
 * Every game the build serves, not just the first.
 *
 * M18's picker made this a list: `games/index.json` is what the shell fetches
 * before the player has chosen, and each game has a manifest of its own. A
 * check that only looked at one of them would pass a build whose second game
 * was half copied.
 */
const index: GameIndex = JSON.parse(await readFile(join(GAMES_DIR, 'index.json'), 'utf8'));
const games = await Promise.all(
  index.games.map(async (game) => {
    const dir = join(GAMES_DIR, game.id);
    const manifest: Manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
    return { entry: game, dir, manifest, names: manifest.files.map((f) => f.name) };
  }),
);

test('there is at least one game, and the index agrees with the manifests', () => {
  assert.ok(games.length > 0, 'no games are bundled; run npm run game:sync');

  for (const { entry, manifest } of games) {
    assert.equal(manifest.id, entry.id, 'the manifest knows its own id');
    assert.equal(manifest.title, entry.title, `${entry.id}: the index and the manifest agree`);
    assert.ok(entry.title.length > 0, `${entry.id} has a title to put on the picker`);
  }

  const ids = games.map((game) => game.entry.id);
  assert.equal(new Set(ids).size, ids.length, 'the ids are unique');
});

test('every manifest lists every file the engine reads', () => {
  for (const { entry, names } of games) {
    for (const required of ['LOGDIR', 'PICDIR', 'VIEWDIR', 'SNDDIR', 'OBJECT', 'WORDS.TOK']) {
      assert.ok(names.includes(required), `${entry.id} is missing ${required}`);
    }
    assert.ok(
      names.some((name) => /^VOL\.\d+$/.test(name)),
      `${entry.id} has at least one VOL file`,
    );
  }
});

test('the manifest lists nothing the engine does not read', () => {
  // The DOS executables and the graphics overlays are deliberately not copied.
  // Two interpreter files are, because the Hercules driver reads them when they
  // are there: HGC_FONT for its letterforms, and AGIDATA.OVL for the 128 bytes
  // at 0x1bea that are its dither table.
  const allowed = /^(LOGDIR|PICDIR|VIEWDIR|SNDDIR|OBJECT|WORDS\.TOK|HGC_FONT|AGIDATA\.OVL|VOL\.\d+)$/;
  for (const { names } of games) {
    for (const name of names) assert.match(name, allowed);
  }
});

test('every listed file is on disk at the recorded size', async () => {
  for (const { entry, dir, manifest } of games) {
    for (const file of manifest.files) {
      const { size } = await stat(join(dir, file.name));
      assert.equal(size, file.bytes, `${entry.id}: ${file.name} size`);
    }
  }
});

test('the resource directories are whole 3-byte entries', () => {
  for (const { entry, manifest } of games) {
    for (const name of ['LOGDIR', 'PICDIR', 'VIEWDIR', 'SNDDIR']) {
      const size = manifest.files.find((f) => f.name === name)?.bytes;
      assert.ok(size !== undefined && size > 0, `${entry.id}: ${name} is present and not empty`);
      assert.equal(size % 3, 0, `${entry.id}: ${name} length is a multiple of 3`);
    }
  }
});

test('each volume file starts with a resource header signature', async () => {
  for (const { entry, dir, names } of games) {
    for (const name of names.filter((n) => /^VOL\.\d+$/.test(n))) {
      const head = (await readFile(join(dir, name))).subarray(0, 2);
      assert.deepEqual([...head], [0x12, 0x34], `${entry.id}: ${name} begins with 0x12 0x34`);
    }
  }
});

test('volume numbering starts at 0 and has no gaps', () => {
  for (const { entry, names } of games) {
    const numbers = names
      .filter((name) => /^VOL\.\d+$/.test(name))
      .map((name) => Number(name.slice(4)))
      .sort((a, b) => a - b);

    assert.deepEqual(numbers, numbers.map((_, i) => i), `${entry.id}: volume numbering`);
  }
});

test('a game that names its interpreter names one this engine knows', () => {
  // The picker shows it, and the engine reads it again at run time to decide
  // how many commands the bytecode reader will accept.
  for (const { entry, manifest } of games) {
    if (manifest.interpreter === undefined) continue;
    assert.match(manifest.interpreter, /^\d\.\d{3}(\.\d+)?$/, `${entry.id}: ${manifest.interpreter}`);
    assert.equal(manifest.interpreter, entry.interpreter, `${entry.id}: the index agrees`);
  }
});
