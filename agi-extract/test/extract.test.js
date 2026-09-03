import assert from 'node:assert/strict';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  extractAll,
  extractOne,
  extractType,
  listResources,
  renderPictureToPng,
  renderViewToPngs,
  Session,
} from '../src/agi/extract.js';
import { run } from '../src/cli.js';
import { ERROR_CODES } from '../src/util/errors.js';
import {
  celBytes,
  dirEntry,
  LOGIC_0,
  LOGIC_2,
  makeGame,
  PIC_0,
  sampleGame,
  SOUND_0,
  tempDir,
  VIEW_0,
  viewBytes,
  volResource,
} from './helpers.js';

/** Open a session, run `fn`, always close. */
async function withSession(inputDir, options, fn) {
  const session = await Session.open(inputDir, options);
  try {
    return await fn(session);
  } finally {
    await session.close();
  }
}

/** Run the CLI, capturing stdout/stderr. */
async function cli(argv) {
  const stdout = [];
  const stderr = [];
  const code = await run(argv, {
    out: (line) => stdout.push(line),
    err: (line) => stderr.push(line),
  });
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}

test('extracts one known resource', async () => {
  const input = await sampleGame();
  const output = await tempDir('agi-out-');

  const result = await withSession(input, { outputDir: output }, (s) => extractOne(s, 'view', 0));

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.resources.length, 1);

  const [resource] = result.resources;
  assert.equal(resource.type, 'view');
  assert.equal(resource.id, 0);
  assert.equal(resource.volume, 1);
  assert.equal(resource.payloadLength, VIEW_0.length);
  assert.equal(resource.includedHeader, false);
  assert.equal(resource.outputPath, join(output, 'view', 'view.000.view'));
  assert.deepEqual(await readFile(resource.outputPath), VIEW_0);
});

test('names files <type>.<3-digit id>.<ext> grouped by type', async () => {
  const input = await sampleGame();
  const output = await tempDir('agi-out-');

  const result = await withSession(input, { outputDir: output }, (s) => extractAll(s));

  assert.deepEqual(
    result.resources.map((r) => r.outputPath.slice(output.length + 1)),
    [
      join('logic', 'logic.000.logic'),
      join('logic', 'logic.002.logic'),
      join('pic', 'pic.001.pic'),
      join('view', 'view.000.view'),
      join('sound', 'sound.000.sound'),
    ],
  );
});

test('extracts all resources of one type', async () => {
  const input = await sampleGame();
  const output = await tempDir('agi-out-');

  const result = await withSession(input, { outputDir: output }, (s) => extractType(s, 'logic'));

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.resources.map((r) => r.id),
    [0, 2],
  );
  assert.deepEqual(await readFile(join(output, 'logic', 'logic.000.logic')), LOGIC_0);
  assert.deepEqual(await readFile(join(output, 'logic', 'logic.002.logic')), LOGIC_2);
});

test('extracts all supported resource types', async () => {
  const input = await sampleGame();
  const output = await tempDir('agi-out-');

  const result = await withSession(input, { outputDir: output }, (s) => extractAll(s));

  assert.equal(result.ok, true);
  assert.equal(result.resources.length, 5);
  assert.deepEqual(await readFile(join(output, 'pic', 'pic.001.pic')), PIC_0);
  assert.deepEqual(await readFile(join(output, 'sound', 'sound.000.sound')), SOUND_0);
});

test('skips missing resources during bulk extraction', async () => {
  const input = await sampleGame();
  const output = await tempDir('agi-out-');

  const result = await withSession(input, { outputDir: output }, (s) => extractType(s, 'pic'));

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.resources.map((r) => r.id),
    [1],
  );
});

test('rejects a resource explicitly marked missing', async () => {
  const input = await sampleGame();
  const output = await tempDir('agi-out-');

  const result = await withSession(input, { outputDir: output }, (s) => extractOne(s, 'logic', 1));

  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, ERROR_CODES.RESOURCE_MISSING);
  assert.deepEqual(result.errors[0].type, 'logic');
  assert.deepEqual(result.errors[0].id, 1);
});

test('rejects a resource id past the end of the directory file', async () => {
  const input = await sampleGame();
  const output = await tempDir('agi-out-');

  const result = await withSession(input, { outputDir: output }, (s) => extractOne(s, 'view', 99));

  assert.equal(result.errors[0].code, ERROR_CODES.RESOURCE_ID_OUT_OF_RANGE);
});

test('does not overwrite existing output without --force', async () => {
  const input = await sampleGame();
  const output = await tempDir('agi-out-');

  const first = await withSession(input, { outputDir: output }, (s) => extractOne(s, 'view', 0));
  assert.equal(first.ok, true);

  const second = await withSession(input, { outputDir: output }, (s) => extractOne(s, 'view', 0));
  assert.equal(second.ok, false);
  assert.equal(second.errors[0].code, ERROR_CODES.OUTPUT_EXISTS);

  // The original file survived untouched.
  assert.deepEqual(await readFile(join(output, 'view', 'view.000.view')), VIEW_0);
});

test('--force overwrites existing output', async () => {
  const input = await sampleGame();
  const output = await tempDir('agi-out-');
  const path = join(output, 'view', 'view.000.view');

  await withSession(input, { outputDir: output }, (s) => extractOne(s, 'view', 0));
  await writeFile(path, 'stale');

  const result = await withSession(input, { outputDir: output, force: true }, (s) =>
    extractOne(s, 'view', 0),
  );

  assert.equal(result.ok, true);
  assert.deepEqual(await readFile(path), VIEW_0);
});

test('writes the header when --include-header is used', async () => {
  const input = await sampleGame();
  const output = await tempDir('agi-out-');

  const result = await withSession(input, { outputDir: output, includeHeader: true }, (s) =>
    extractOne(s, 'view', 0),
  );

  const written = await readFile(result.resources[0].outputPath);
  assert.equal(result.resources[0].includedHeader, true);
  assert.equal(result.resources[0].payloadLength, VIEW_0.length);
  assert.equal(written.length, VIEW_0.length + 5);
  assert.deepEqual(written.subarray(0, 5), Buffer.from([0x12, 0x34, 1, VIEW_0.length & 0xff, 0]));
  assert.deepEqual(written.subarray(5), VIEW_0);
});

test('continues after an individual failure and reports it at the end', async () => {
  // logic 1 points one byte into a valid header, so its signature check fails.
  const input = await makeGame({
    dirs: { logic: Buffer.concat([dirEntry(0, 0), dirEntry(0, 1), dirEntry(0, 0)]) },
    volumes: { 0: volResource(0, LOGIC_0) },
  });
  const output = await tempDir('agi-out-');

  const result = await withSession(input, { outputDir: output }, (s) => extractType(s, 'logic'));

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.resources.map((r) => r.id),
    [0, 2],
  );
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].code, ERROR_CODES.INVALID_VOL_SIGNATURE);
  assert.equal(result.errors[0].id, 1);
});

test('an unknown type is reported the same way whichever entry point is used', async () => {
  // extractOne and extractType both collect it rather than throwing, so a
  // caller can handle one failure the same way it handles the rest.
  const input = await makeGame({ dirs: { logic: dirEntry(0, 0) } });
  const output = await tempDir('agi-out-');

  for (const run of [(s) => extractOne(s, 'sprite', 0), (s) => extractType(s, 'sprite')]) {
    const result = await withSession(input, { outputDir: output }, run);

    assert.equal(result.ok, false);
    assert.equal(result.resources.length, 0);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].code, ERROR_CODES.UNKNOWN_RESOURCE_TYPE);
    assert.equal(result.errors[0].type, 'sprite');
  }
});

test('--strict stops at the first failure', async () => {
  const input = await makeGame({
    dirs: { logic: Buffer.concat([dirEntry(0, 1), dirEntry(0, 0)]) },
    volumes: { 0: volResource(0, LOGIC_0) },
  });
  const output = await tempDir('agi-out-');

  const result = await withSession(input, { outputDir: output, strict: true }, (s) =>
    extractType(s, 'logic'),
  );

  assert.equal(result.ok, false);
  assert.equal(result.resources.length, 0, 'stopped before extracting logic 1');
  assert.equal(result.errors.length, 1);
});

test('reports a VOL file referenced by a directory entry but absent from disk', async () => {
  const input = await makeGame({ dirs: { logic: dirEntry(7, 0) } });
  const output = await tempDir('agi-out-');

  const result = await withSession(input, { outputDir: output }, (s) => extractType(s, 'logic'));

  assert.equal(result.errors[0].code, ERROR_CODES.VOL_FILE_NOT_FOUND);
});

test('reports a missing directory file per type and keeps going', async () => {
  const input = await makeGame({
    dirs: { logic: dirEntry(0, 0) },
    volumes: { 0: volResource(0, LOGIC_0) },
  });
  const output = await tempDir('agi-out-');

  const result = await withSession(input, { outputDir: output }, (s) => extractAll(s));

  assert.equal(result.resources.length, 1);
  assert.deepEqual(
    result.errors.map((e) => [e.type, e.code]),
    [
      ['pic', ERROR_CODES.DIR_FILE_NOT_FOUND],
      ['view', ERROR_CODES.DIR_FILE_NOT_FOUND],
      ['sound', ERROR_CODES.DIR_FILE_NOT_FOUND],
    ],
  );
});

test('matches directory and VOL file names case-insensitively', async () => {
  const input = await sampleGame();
  await rename(join(input, 'VIEWDIR'), join(input, 'ViewDir'));
  await rename(join(input, 'VOL.1'), join(input, 'vol.1'));
  const output = await tempDir('agi-out-');

  const result = await withSession(input, { outputDir: output }, (s) => extractOne(s, 'view', 0));

  assert.equal(result.ok, true);
  assert.deepEqual(await readFile(result.resources[0].outputPath), VIEW_0);
});

test('reports a missing input directory', async () => {
  await assert.rejects(Session.open(join(await tempDir(), 'nope')), {
    code: ERROR_CODES.INPUT_DIR_NOT_FOUND,
  });
});

test('list reports every present resource with its payload length', async () => {
  const input = await sampleGame();

  const result = await withSession(input, {}, (s) =>
    listResources(s, ['logic', 'pic', 'view', 'sound']),
  );

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.resources.map((r) => [r.type, r.id, r.volume, r.payloadLength]),
    [
      ['logic', 0, 0, LOGIC_0.length],
      ['logic', 2, 0, LOGIC_2.length],
      ['pic', 1, 0, PIC_0.length],
      ['view', 0, 1, VIEW_0.length],
      ['sound', 0, 1, SOUND_0.length],
    ],
  );
});

// --- CLI ------------------------------------------------------------------

test('CLI: one <type> <number>', async () => {
  const input = await sampleGame();
  const output = await tempDir('agi-out-');

  const { code, stdout } = await cli(['one', 'view', '0', '--input', input, '--output', output]);

  assert.equal(code, 0);
  assert.match(stdout, /view\.000\.view {2}\(64 bytes from VOL\.1\)/);
  assert.match(stdout, /Extracted 1 resource\(s\)/);
  assert.deepEqual(await readFile(join(output, 'view', 'view.000.view')), VIEW_0);
});

test('CLI: type <type>', async () => {
  const input = await sampleGame();
  const output = await tempDir('agi-out-');

  const { code } = await cli(['type', 'pic', '-i', input, '-o', output]);

  assert.equal(code, 0);
  assert.deepEqual(await readFile(join(output, 'pic', 'pic.001.pic')), PIC_0);
});

test('CLI: all', async () => {
  const input = await sampleGame();
  const output = await tempDir('agi-out-');

  const { code, stdout } = await cli(['all', '-i', input, '-o', output]);

  assert.equal(code, 0);
  assert.match(stdout, /Extracted 5 resource\(s\)/);
});

test('CLI: list renders the documented table', async () => {
  const input = await sampleGame();

  const { code, stdout } = await cli(['list', 'view', '-i', input]);

  assert.equal(code, 0);
  assert.deepEqual(stdout.split('\n'), ['TYPE   ID   VOL   OFFSET    SIZE', 'view   0    1     0x000004  64']);
});

test('CLI: list --json emits an array of resource records', async () => {
  const input = await sampleGame();

  const { code, stdout } = await cli(['list', 'view', '-i', input, '--json']);

  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(stdout), [
    { type: 'view', id: 0, volume: 1, offset: 4, payloadLength: VIEW_0.length },
  ]);
});

test('CLI: --json emits the documented success envelope', async () => {
  const input = await sampleGame();
  const output = await tempDir('agi-out-');

  const { code, stdout } = await cli(['one', 'view', '0', '-i', input, '-o', output, '--json']);

  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(stdout), {
    ok: true,
    resources: [
      {
        type: 'view',
        id: 0,
        volume: 1,
        offset: 4,
        payloadLength: VIEW_0.length,
        outputPath: join(output, 'view', 'view.000.view'),
        includedHeader: false,
      },
    ],
    errors: [],
  });
});

test('CLI: --json emits the documented partial-failure envelope', async () => {
  const input = await makeGame({
    dirs: { logic: Buffer.concat([dirEntry(0, 0), dirEntry(0, 1)]) },
    volumes: { 0: volResource(0, LOGIC_0) },
  });
  const output = await tempDir('agi-out-');

  const { code, stdout } = await cli(['type', 'logic', '-i', input, '-o', output, '--json']);

  assert.equal(code, 1);
  const result = JSON.parse(stdout);
  assert.equal(result.ok, false);
  assert.equal(result.resources.length, 1);
  assert.deepEqual(result.errors, [
    {
      type: 'logic',
      id: 1,
      code: 'INVALID_VOL_SIGNATURE',
      message: result.errors[0].message,
    },
  ]);
  assert.match(result.errors[0].message, /Expected 0x12 0x34 at VOL\.0 offset 1, got/);
});

test('CLI: exit code 1 on partial failure', async () => {
  const input = await makeGame({
    dirs: { logic: Buffer.concat([dirEntry(0, 0), dirEntry(0, 1)]) },
    volumes: { 0: volResource(0, LOGIC_0) },
  });
  const output = await tempDir('agi-out-');

  const { code, stderr } = await cli(['type', 'logic', '-i', input, '-o', output]);

  assert.equal(code, 1);
  assert.match(stderr, /INVALID_VOL_SIGNATURE: logic 1/);
});

test('CLI: unknown resource type fails with a stable code', async () => {
  const input = await sampleGame();
  const { code, stderr } = await cli(['type', 'music', '-i', input]);

  assert.equal(code, 1);
  assert.match(stderr, /UNKNOWN_RESOURCE_TYPE/);
});

test('CLI: non-numeric resource number fails with a stable code', async () => {
  const input = await sampleGame();
  const { code, stdout } = await cli(['one', 'view', 'twelve', '-i', input, '--json']);

  assert.equal(code, 1);
  assert.equal(JSON.parse(stdout).errors[0].code, 'INVALID_RESOURCE_ID');
});

test('CLI: missing input directory fails with a stable code', async () => {
  const { code, stderr } = await cli(['all', '-i', join(await tempDir(), 'nope')]);

  assert.equal(code, 1);
  assert.match(stderr, /INPUT_DIR_NOT_FOUND/);
});

test('CLI: unknown command exits 2 with usage', async () => {
  const { code, stderr } = await cli(['frobnicate']);

  assert.equal(code, 2);
  assert.match(stderr, /Unknown command "frobnicate"/);
  assert.match(stderr, /Usage:/);
});

test('CLI: missing operands exit 2 with usage', async () => {
  assert.equal((await cli([])).code, 2);
  assert.equal((await cli(['one', 'view'])).code, 2);
  assert.equal((await cli(['type'])).code, 2);
});

test('CLI: input defaults to the current directory', async () => {
  const input = await sampleGame();
  const output = await tempDir('agi-out-');

  const stdout = [];
  const code = await run(['type', 'view', '-o', output], {
    out: (l) => stdout.push(l),
    err: () => {},
    cwd: input,
  });

  assert.equal(code, 0);
  assert.deepEqual(await readFile(join(output, 'view', 'view.000.view')), VIEW_0);
});

test('CLI: warns about a directory file whose length is not a multiple of 3', async () => {
  const input = await makeGame({
    dirs: { logic: Buffer.concat([dirEntry(0, 0), Buffer.from([0x00])]) },
    volumes: { 0: volResource(0, LOGIC_0) },
  });
  const output = await tempDir('agi-out-');

  const { code, stderr } = await cli(['type', 'logic', '-i', input, '-o', output]);

  assert.equal(code, 0);
  assert.match(stderr, /warning: .*LOGDIR length 4 is not a multiple of 3/);
});

// --- PIC rendering --------------------------------------------------------

/** A picture that outlines a box and fills it, plus the end marker. */
const PIC_SOURCE = Buffer.from([
  0xf0, 0x01,
  0xf6, 0x0a, 0x0a, 0x14, 0x0a, 0x14, 0x14, 0x0a, 0x14, 0x0a, 0x0a,
  0xf0, 0x02,
  0xf8, 0x0f, 0x0f,
  0xff,
]);

/** A game whose pic 0 is a real drawable picture. */
async function pictureGame() {
  return makeGame({
    dirs: { pic: dirEntry(0, 0) },
    volumes: { 0: volResource(0, PIC_SOURCE) },
  });
}

/** Read a PNG's dimensions and colour type straight from its IHDR. */
function readPngHeader(buffer) {
  assert.deepEqual([...buffer.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(buffer.toString('ascii', 12, 16), 'IHDR');
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bitDepth: buffer[24],
    colourType: buffer[25],
  };
}

test('renders a picture at 320x168 by default, correcting the pixel aspect', () => {
  const { data, width, height } = renderPictureToPng(PIC_SOURCE);

  assert.equal(width, 320);
  assert.equal(height, 168);
  assert.deepEqual(readPngHeader(data), { width: 320, height: 168, bitDepth: 8, colourType: 3 });
});

test('--png writes a PNG instead of the raw vector payload', async () => {
  const input = await pictureGame();
  const output = await tempDir('agi-out-');

  const result = await withSession(input, { outputDir: output, png: true }, (s) =>
    extractOne(s, 'pic', 0),
  );

  assert.equal(result.ok, true);
  const [resource] = result.resources;
  assert.equal(resource.outputPath, join(output, 'pic', 'pic.000.png'));
  assert.equal(resource.format, 'png');
  assert.equal(resource.width, 320);
  assert.equal(resource.height, 168);
  assert.equal(resource.payloadLength, PIC_SOURCE.length, 'still reports the source byte count');

  readPngHeader(await readFile(resource.outputPath));
});

test('without --png the raw vector payload is preserved exactly', async () => {
  const input = await pictureGame();
  const output = await tempDir('agi-out-');

  const result = await withSession(input, { outputDir: output }, (s) => extractOne(s, 'pic', 0));

  assert.equal(result.resources[0].outputPath, join(output, 'pic', 'pic.000.pic'));
  assert.equal(result.resources[0].format, undefined);
  assert.deepEqual(await readFile(result.resources[0].outputPath), PIC_SOURCE);
});

test('--png-scale multiplies both axes on top of the aspect correction', async () => {
  const input = await pictureGame();
  const output = await tempDir('agi-out-');

  const result = await withSession(input, { outputDir: output, png: true, pngScale: 3 }, (s) =>
    extractOne(s, 'pic', 0),
  );

  assert.deepEqual(readPngHeader(await readFile(result.resources[0].outputPath)), {
    width: 960,
    height: 504,
    bitDepth: 8,
    colourType: 3,
  });
});

test('--png leaves LOGIC and SOUND as raw payloads', async () => {
  const input = await sampleGame();
  const output = await tempDir('agi-out-');

  const result = await withSession(input, { outputDir: output, png: true }, (s) => extractAll(s));

  const byType = Object.fromEntries(result.resources.map((r) => [`${r.type}.${r.id}`, r]));
  assert.equal(byType['pic.1'].outputPath.endsWith('.png'), true, 'pictures render');
  assert.equal(byType['logic.0'].outputPath.endsWith('.logic'), true);
  assert.equal(byType['logic.0'].format, undefined);
  assert.deepEqual(await readFile(byType['sound.0'].outputPath), SOUND_0);
});

test('--png ignores --include-header for rendered images but not for raw types', async () => {
  const input = await sampleGame();
  const output = await tempDir('agi-out-');

  const result = await withSession(
    input,
    { outputDir: output, png: true, includeHeader: true },
    (s) => extractAll(s),
  );

  const pic = result.resources.find((r) => r.type === 'pic');
  const sound = result.resources.find((r) => r.type === 'sound');

  assert.equal(pic.includedHeader, false, 'a rendered image has no VOL header');
  assert.equal(sound.includedHeader, true);
  assert.equal((await readFile(sound.outputPath)).length, SOUND_0.length + 5);
});

test('a picture that is not valid vector data still renders what it can', async () => {
  // Random bytes decode to whatever they decode to; the point is that the run
  // completes rather than failing the whole extraction.
  const input = await makeGame({
    dirs: { pic: dirEntry(0, 0) },
    volumes: { 0: volResource(0, Buffer.from([0x01, 0x02, 0x03, 0xf9, 0xff])) },
  });
  const output = await tempDir('agi-out-');

  const result = await withSession(input, { outputDir: output, png: true }, (s) =>
    extractType(s, 'pic'),
  );

  assert.equal(result.ok, true);
  readPngHeader(await readFile(result.resources[0].outputPath));
});

test('CLI: --png renders pictures', async () => {
  const input = await pictureGame();
  const output = await tempDir('agi-out-');

  const { code, stdout } = await cli(['type', 'pic', '-i', input, '-o', output, '--png']);

  assert.equal(code, 0);
  assert.match(stdout, /pic\.000\.png {2}\(320x168 PNG from \d+ bytes of vectors in VOL\.0\)/);
  readPngHeader(await readFile(join(output, 'pic', 'pic.000.png')));
});

test('CLI: --png --json reports the rendered dimensions', async () => {
  const input = await pictureGame();
  const output = await tempDir('agi-out-');

  const { code, stdout } = await cli([
    'one', 'pic', '0', '-i', input, '-o', output, '--png', '--png-scale', '2', '--json',
  ]);

  assert.equal(code, 0);
  const [resource] = JSON.parse(stdout).resources;
  assert.equal(resource.format, 'png');
  assert.equal(resource.width, 640);
  assert.equal(resource.height, 336);
  assert.equal(resource.outputPath, join(output, 'pic', 'pic.000.png'));
});

test('CLI: rejects a non-positive --png-scale', async () => {
  const input = await pictureGame();

  const { code, stderr } = await cli(['type', 'pic', '-i', input, '--png', '--png-scale', '0']);

  assert.equal(code, 2);
  assert.match(stderr, /--png-scale must be a positive integer/);
});

// --- VIEW rendering -------------------------------------------------------

/** A view with a 2-cel loop 0, a mirror of it as loop 1, and a 1-cel loop 2. */
const VIEW_SOURCE = viewBytes(
  [
    [
      celBytes({
        width: 4,
        height: 3,
        transparent: 0,
        mirrored: true,
        sourceLoop: 0,
        lines: [[[1, 4]], [[2, 2], [3, 2]], [[4, 4]]],
      }),
      celBytes({
        width: 4,
        height: 3,
        transparent: 0,
        mirrored: true,
        sourceLoop: 0,
        lines: [[[5, 4]], [[6, 4]], [[7, 4]]],
      }),
    ],
    { mirrorOf: 0 },
    [celBytes({ width: 2, height: 2, transparent: 0, lines: [[[9, 2]], [[10, 2]]] })],
  ],
  { description: 'a walking man' },
);

async function viewGame() {
  return makeGame({
    dirs: { view: dirEntry(0, 0) },
    volumes: { 0: volResource(0, VIEW_SOURCE) },
  });
}

/** Names of every file a rendered view produced, relative to its directory. */
const names = (resource) => resource.files.map((f) => f.split('/').pop());

test('renders one PNG per cel plus an animation per multi-cel loop', () => {
  const { files, loops, description } = renderViewToPngs(VIEW_SOURCE);

  assert.deepEqual(
    files.map((f) => f.name),
    [
      'loop00.cel00.png',
      'loop00.cel01.png',
      'loop00.anim.png',
      'loop01.cel00.png',
      'loop01.cel01.png',
      'loop01.anim.png',
      'loop02.cel00.png',
    ],
  );

  assert.equal(loops.length, 3);
  assert.equal(loops[2].animationName, null, 'a single-cel loop gets no animation');
  assert.equal(description, 'a walking man');
});

test('a rendered cel is sized from the cel, corrected for pixel aspect', () => {
  const { files } = renderViewToPngs(VIEW_SOURCE);
  const cel = files.find((f) => f.name === 'loop00.cel00.png');
  const single = files.find((f) => f.name === 'loop02.cel00.png');

  assert.deepEqual([cel.width, cel.height], [8, 3], '4x3 cel at 2x horizontally');
  assert.deepEqual([single.width, single.height], [4, 2], 'not padded to the other loop');
});

test('mirrored loops render flipped from the same source cels', () => {
  const { files } = renderViewToPngs(VIEW_SOURCE);
  const own = files.find((f) => f.name === 'loop00.cel00.png');
  const mirror = files.find((f) => f.name === 'loop01.cel00.png');

  assert.deepEqual([own.width, own.height], [mirror.width, mirror.height]);
  assert.notDeepEqual(own.data, mirror.data, 'the mirrored loop is not byte-identical');
});

test('--png writes a view as PNG frames and animations', async () => {
  const input = await viewGame();
  const output = await tempDir('agi-out-');

  const result = await withSession(input, { outputDir: output, png: true }, (s) =>
    extractOne(s, 'view', 0),
  );

  assert.equal(result.ok, true);
  const [resource] = result.resources;

  assert.equal(resource.format, 'png');
  assert.equal(resource.includedHeader, false);
  assert.equal(resource.payloadLength, VIEW_SOURCE.length);
  assert.equal(resource.description, 'a walking man');
  assert.deepEqual(names(resource), [
    'view.000.loop00.cel00.png',
    'view.000.loop00.cel01.png',
    'view.000.loop00.anim.png',
    'view.000.loop01.cel00.png',
    'view.000.loop01.cel01.png',
    'view.000.loop01.anim.png',
    'view.000.loop02.cel00.png',
  ]);
  assert.equal(resource.outputPath, resource.files[0]);

  for (const file of resource.files) {
    assert.deepEqual(
      [...(await readFile(file)).subarray(0, 8)],
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      file,
    );
  }
});

test('reports per-loop cel counts, canvas size and animation path', async () => {
  const input = await viewGame();
  const output = await tempDir('agi-out-');

  const result = await withSession(input, { outputDir: output, png: true }, (s) =>
    extractOne(s, 'view', 0),
  );

  assert.deepEqual(
    result.resources[0].loops.map((l) => [l.loop, l.cels, l.width, l.height, l.animationPath !== null]),
    [
      [0, 2, 8, 3, true],
      [1, 2, 8, 3, true],
      [2, 1, 4, 2, false],
    ],
  );
});

test('an animation canvas fits the largest cel in its loop', () => {
  const uneven = viewBytes([
    [
      celBytes({ width: 2, height: 2, transparent: 0, lines: [[[1, 2]], [[1, 2]]] }),
      celBytes({ width: 5, height: 4, transparent: 0, lines: [[[2, 5]], [[2, 5]], [[2, 5]], [[2, 5]]] }),
    ],
  ]);

  const { loops, files } = renderViewToPngs(uneven);
  const anim = files.find((f) => f.name === 'loop00.anim.png');

  assert.deepEqual([loops[0].width, loops[0].height], [10, 4], 'canvas takes the larger cel');
  assert.deepEqual([anim.width, anim.height], [10, 4]);
});

test('--view-fps sets the animation frame delay', async () => {
  const input = await viewGame();
  const output = await tempDir('agi-out-');

  const result = await withSession(input, { outputDir: output, png: true, viewFps: 25 }, (s) =>
    extractOne(s, 'view', 0),
  );

  const anim = await readFile(result.resources[0].loops[0].animationPath);
  const at = anim.indexOf(Buffer.from('fcTL'));

  assert.equal(anim.readUInt16BE(at + 4 + 20), 1, 'delay numerator');
  assert.equal(anim.readUInt16BE(at + 4 + 22), 25, 'delay denominator');
});

test('--png-scale scales rendered view frames', async () => {
  const input = await viewGame();
  const output = await tempDir('agi-out-');

  const result = await withSession(input, { outputDir: output, png: true, pngScale: 4 }, (s) =>
    extractOne(s, 'view', 0),
  );

  assert.deepEqual(
    [result.resources[0].loops[0].width, result.resources[0].loops[0].height],
    [32, 12],
  );
});

test('without --png a view is still written as one raw file', async () => {
  const input = await viewGame();
  const output = await tempDir('agi-out-');

  const result = await withSession(input, { outputDir: output }, (s) => extractOne(s, 'view', 0));

  assert.equal(result.resources[0].outputPath, join(output, 'view', 'view.000.view'));
  assert.equal(result.resources[0].files, undefined);
  assert.deepEqual(await readFile(result.resources[0].outputPath), VIEW_SOURCE);
});

test('a view with no cels fails rather than writing nothing', async () => {
  const input = await makeGame({
    dirs: { view: dirEntry(0, 0) },
    volumes: { 0: volResource(0, Buffer.from([2, 1, 0, 0, 0])) },
  });
  const output = await tempDir('agi-out-');

  const result = await withSession(input, { outputDir: output, png: true }, (s) =>
    extractType(s, 'view'),
  );

  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'VIEW_RENDER_FAILED');
});

test('re-extracting a view without --force reports the existing file', async () => {
  const input = await viewGame();
  const output = await tempDir('agi-out-');

  await withSession(input, { outputDir: output, png: true }, (s) => extractOne(s, 'view', 0));
  const again = await withSession(input, { outputDir: output, png: true }, (s) =>
    extractOne(s, 'view', 0),
  );

  assert.equal(again.errors[0].code, 'OUTPUT_EXISTS');
});

test('CLI: --png renders views', async () => {
  const input = await viewGame();
  const output = await tempDir('agi-out-');

  const { code, stdout } = await cli(['type', 'view', '-i', input, '-o', output, '--png']);

  assert.equal(code, 0);
  assert.match(stdout, /view\.000\.\*\.png {2}\(3 loop\(s\), 5 frame\(s\), 2 animation\(s\)/);
});

test('CLI: --png --json lists every file a view produced', async () => {
  const input = await viewGame();
  const output = await tempDir('agi-out-');

  const { code, stdout } = await cli([
    'one', 'view', '0', '-i', input, '-o', output, '--png', '--json',
  ]);

  assert.equal(code, 0);
  const [resource] = JSON.parse(stdout).resources;
  assert.equal(resource.files.length, 7);
  assert.equal(resource.loops.length, 3);
});

test('CLI: rejects an out-of-range --view-fps', async () => {
  const input = await viewGame();

  const { code, stderr } = await cli(['type', 'view', '-i', input, '--png', '--view-fps', '0']);

  assert.equal(code, 2);
  assert.match(stderr, /--view-fps must be an integer between 1 and 65535/);
});

test('--png renders pictures and views together, leaving other types raw', async () => {
  const input = await makeGame({
    dirs: { logic: dirEntry(0, 0), pic: dirEntry(0, 0), view: dirEntry(1, 0) },
    volumes: { 0: volResource(0, PIC_SOURCE), 1: volResource(1, VIEW_SOURCE) },
  });
  const output = await tempDir('agi-out-');

  const result = await withSession(input, { outputDir: output, png: true }, (s) => extractAll(s));

  const byType = Object.fromEntries(result.resources.map((r) => [r.type, r]));
  assert.equal(byType.pic.outputPath.endsWith('.pic.png') || byType.pic.outputPath.endsWith('pic.000.png'), true);
  assert.equal(byType.view.format, 'png');
  assert.equal(byType.logic.format, undefined, 'logic stays raw');
});
