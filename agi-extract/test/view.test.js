import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inflateSync } from 'node:zlib';

import {
  celPixelsForLoop,
  composeOnCanvas,
  decodeCel,
  decodeView,
  flipHorizontally,
  TRANSPARENT,
  VIEW_PALETTE,
} from '../src/agi/view.js';
import { encodeIndexedApng, encodeIndexedPng } from '../src/util/png.js';
import { celBytes, MIRRORED_VIEW, viewBytes } from './helpers.js';

const T = TRANSPARENT;

test('decodes RLE chunks into colour runs', () => {
  const cel = decodeCel(
    celBytes({ width: 6, height: 2, transparent: 0, lines: [[[1, 2], [2, 4]], [[3, 6]]] }),
    0,
  );

  assert.equal(cel.width, 6);
  assert.equal(cel.height, 2);
  assert.deepEqual([...cel.pixels], [1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3]);
});

test('maps the cel transparent colour onto the transparent index', () => {
  const cel = decodeCel(
    celBytes({ width: 4, height: 1, transparent: 5, lines: [[[5, 2], [9, 2]]] }),
    0,
  );

  assert.deepEqual([...cel.pixels], [T, T, 9, 9]);
  assert.equal(cel.transparent, 5);
});

test('a line that ends early leaves the rest of the row transparent', () => {
  const cel = decodeCel(celBytes({ width: 6, height: 1, lines: [[[7, 2]]] }), 0);
  assert.deepEqual([...cel.pixels], [7, 7, T, T, T, T]);
});

test('a run longer than the row is clipped to the cel width', () => {
  const cel = decodeCel(celBytes({ width: 3, height: 1, lines: [[[7, 15]]] }), 0);
  assert.deepEqual([...cel.pixels], [7, 7, 7]);
});

test('missing lines at the end of a cel stay transparent', () => {
  const cel = decodeCel(celBytes({ width: 2, height: 3, lines: [[[7, 2]]] }), 0);
  assert.deepEqual([...cel.pixels], [7, 7, T, T, T, T]);
});

test('reads the transparency and mirroring header byte', () => {
  const plain = decodeCel(celBytes({ width: 1, height: 1, transparent: 6, lines: [[[1, 1]]] }), 0);
  assert.deepEqual(
    { m: plain.mirrored, s: plain.sourceLoop, t: plain.transparent },
    { m: false, s: 0, t: 6 },
  );

  const mirrored = decodeCel(
    celBytes({ width: 1, height: 1, transparent: 3, mirrored: true, sourceLoop: 5, lines: [[[1, 1]]] }),
    0,
  );
  assert.deepEqual(
    { m: mirrored.mirrored, s: mirrored.sourceLoop, t: mirrored.transparent },
    { m: true, s: 5, t: 3 },
  );
});

test('flips a cel horizontally, row by row', () => {
  const cel = decodeCel(
    celBytes({ width: 3, height: 2, transparent: 0, lines: [[[1, 1], [2, 1], [3, 1]], [[4, 3]]] }),
    0,
  );

  assert.deepEqual([...flipHorizontally(cel)], [3, 2, 1, 4, 4, 4]);
});

test('a mirrored cel is drawn as stored for its own loop and flipped for others', () => {
  const view = decodeView(MIRRORED_VIEW);
  const cel = view.loops[0].cels[0];

  assert.equal(cel.mirrored, true);
  assert.equal(cel.sourceLoop, 0);
  assert.equal(celPixelsForLoop(cel, 0), cel.pixels, 'own loop: unchanged');
  assert.deepEqual([...celPixelsForLoop(cel, 1)], [...flipHorizontally(cel)], 'other loop: flipped');
});

test('a cel that is not mirrored is never flipped', () => {
  const cel = decodeCel(celBytes({ width: 2, height: 1, lines: [[[1, 1], [2, 1]]] }), 0);
  assert.equal(celPixelsForLoop(cel, 3), cel.pixels);
});

test('parses the view header, loops and cels', () => {
  const view = decodeView(MIRRORED_VIEW);

  assert.equal(view.loops.length, 2);
  assert.equal(view.loops[0].cels.length, 2);
  assert.equal(view.loops[1].cels.length, 2);
  assert.equal(view.description, 'a test view');
});

test('two loops can share the same cel data', () => {
  const view = decodeView(MIRRORED_VIEW);
  assert.deepEqual([...view.loops[0].cels[0].pixels], [...view.loops[1].cels[0].pixels]);
});

test('cel offsets are relative to the start of their loop', () => {
  // Two loops of different sizes: if cel offsets were read as resource-relative
  // the second loop's cels would decode as garbage.
  const data = viewBytes([
    [celBytes({ width: 2, height: 1, transparent: 0, lines: [[[1, 2]]] })],
    [
      celBytes({ width: 2, height: 1, transparent: 0, lines: [[[2, 2]]] }),
      celBytes({ width: 2, height: 1, transparent: 0, lines: [[[3, 2]]] }),
    ],
  ]);

  const view = decodeView(data);
  assert.deepEqual([...view.loops[0].cels[0].pixels], [1, 1]);
  assert.deepEqual([...view.loops[1].cels[0].pixels], [2, 2]);
  assert.deepEqual([...view.loops[1].cels[1].pixels], [3, 3]);
});

test('a view with no description reports null', () => {
  const view = decodeView(viewBytes([[celBytes({ width: 1, height: 1, lines: [[[1, 1]]] })]]));
  assert.equal(view.description, null);
});

test('a loop offset outside the payload yields an empty loop', () => {
  const data = Buffer.from(viewBytes([[celBytes({ width: 1, height: 1, lines: [[[1, 1]]] })]]));
  data.writeUInt16LE(0xfff0, 5); // point loop 0 past the end

  const view = decodeView(data);
  assert.equal(view.loops.length, 1);
  assert.deepEqual(view.loops[0].cels, []);
});

test('a truncated view decodes the loops that survived', () => {
  const full = viewBytes([
    [celBytes({ width: 2, height: 1, transparent: 0, lines: [[[1, 2]]] })],
    [celBytes({ width: 2, height: 1, transparent: 0, lines: [[[2, 2]]] })],
  ]);

  const view = decodeView(full.subarray(0, full.length - 4));
  assert.equal(view.loops.length, 2);
  assert.deepEqual([...view.loops[0].cels[0].pixels], [1, 1]);
});

test('an empty payload decodes to no loops', () => {
  assert.deepEqual(decodeView(Buffer.alloc(0)), { loops: [], description: null });
});

test('composeOnCanvas anchors a cel at the bottom left', () => {
  const pixels = Uint8Array.from([1, 2]);
  const canvas = composeOnCanvas(pixels, 2, 1, 4, 3);

  assert.deepEqual([...canvas], [
    T, T, T, T,
    T, T, T, T,
    1, 2, T, T,
  ]);
});

test('composeOnCanvas returns the input when it already fills the canvas', () => {
  const pixels = Uint8Array.from([1, 2, 3, 4]);
  assert.equal(composeOnCanvas(pixels, 2, 2, 2, 2), pixels);
});

// --- APNG ------------------------------------------------------------------

/** Parse an APNG far enough to check its animation chunks. */
function parseApng(buffer) {
  const chunks = [];
  const frames = [];
  const controls = [];
  let header;
  let animation;
  let at = 8;

  while (at < buffer.length) {
    const length = buffer.readUInt32BE(at);
    const type = buffer.toString('ascii', at + 4, at + 8);
    const data = buffer.subarray(at + 8, at + 8 + length);
    chunks.push(type);

    if (type === 'IHDR') header = { width: data.readUInt32BE(0), height: data.readUInt32BE(4) };
    if (type === 'acTL') animation = { frames: data.readUInt32BE(0), plays: data.readUInt32BE(4) };
    if (type === 'fcTL') {
      controls.push({
        sequence: data.readUInt32BE(0),
        width: data.readUInt32BE(4),
        height: data.readUInt32BE(8),
        delayNum: data.readUInt16BE(20),
        delayDen: data.readUInt16BE(22),
      });
    }
    if (type === 'IDAT') frames.push({ sequence: null, raw: inflateSync(data) });
    if (type === 'fdAT') {
      frames.push({ sequence: data.readUInt32BE(0), raw: inflateSync(data.subarray(4)) });
    }

    at += 12 + length;
  }

  return { chunks, header, animation, controls, frames };
}

const twoFrames = [Uint8Array.from([1, 2, 3, 4]), Uint8Array.from([4, 3, 2, 1])];

test('encodes an APNG with the animation chunks in the required order', () => {
  const png = encodeIndexedApng({
    width: 2,
    height: 2,
    frames: twoFrames,
    palette: VIEW_PALETTE,
    transparentIndex: TRANSPARENT,
  });
  const { chunks, header, animation } = parseApng(png);

  assert.deepEqual(header, { width: 2, height: 2 });
  assert.deepEqual(animation, { frames: 2, plays: 0 });
  assert.deepEqual(chunks, [
    'IHDR', 'acTL', 'PLTE', 'tRNS', 'fcTL', 'IDAT', 'fcTL', 'fdAT', 'IEND',
  ]);
});

test('APNG sequence numbers run consecutively across fcTL and fdAT', () => {
  const png = encodeIndexedApng({
    width: 2,
    height: 2,
    frames: [...twoFrames, Uint8Array.from([0, 0, 0, 0])],
    palette: VIEW_PALETTE,
  });
  const { controls, frames } = parseApng(png);

  const sequences = [
    controls[0].sequence,
    ...frames.slice(1).flatMap((f, i) => [controls[i + 1].sequence, f.sequence]),
  ];
  assert.deepEqual(sequences, [0, 1, 2, 3, 4]);
});

test('the first APNG frame is the still image in IDAT', () => {
  const png = encodeIndexedApng({ width: 2, height: 2, frames: twoFrames, palette: VIEW_PALETTE });
  const { frames } = parseApng(png);

  assert.equal(frames.length, 2);
  assert.equal(frames[0].sequence, null, 'first frame is IDAT');
  assert.deepEqual([...frames[0].raw], [0, 1, 2, 0, 3, 4]); // filter byte per row
  assert.deepEqual([...frames[1].raw], [0, 4, 3, 0, 2, 1]);
});

test('APNG frame delay is stored as the given fraction of a second', () => {
  const png = encodeIndexedApng({
    width: 2,
    height: 2,
    frames: twoFrames,
    palette: VIEW_PALETTE,
    delayNumerator: 1,
    delayDenominator: 25,
  });

  for (const control of parseApng(png).controls) {
    assert.equal(control.delayNum, 1);
    assert.equal(control.delayDen, 25);
  }
});

test('an animation needs at least one frame', () => {
  assert.throws(
    () => encodeIndexedApng({ width: 1, height: 1, frames: [], palette: VIEW_PALETTE }),
    /at least one frame/,
  );
});

test('tRNS marks only the transparent palette entry', () => {
  const png = encodeIndexedPng({
    width: 1,
    height: 1,
    pixels: Uint8Array.from([TRANSPARENT]),
    palette: VIEW_PALETTE,
    transparentIndex: TRANSPARENT,
  });

  const at = png.indexOf(Buffer.from('tRNS'));
  const length = png.readUInt32BE(at - 4);
  const trns = png.subarray(at + 4, at + 4 + length);

  assert.equal(length, TRANSPARENT + 1, 'reaches the transparent entry');
  assert.equal(trns[TRANSPARENT], 0, 'transparent entry is fully transparent');
  assert.ok([...trns.subarray(0, TRANSPARENT)].every((a) => a === 255), 'colours stay opaque');
});

test('rejects a transparent index outside the palette', () => {
  assert.throws(
    () =>
      encodeIndexedPng({
        width: 1,
        height: 1,
        pixels: Uint8Array.from([0]),
        palette: [[0, 0, 0]],
        transparentIndex: 9,
      }),
    /outside the palette/,
  );
});
