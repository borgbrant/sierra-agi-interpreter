import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DIR_FILE_BY_TYPE } from '../src/agi/files.js';

/** Build a 3-byte AGI v2 directory entry. */
export function dirEntry(volume, offset) {
  return Buffer.from([
    (volume << 4) | ((offset >> 16) & 0x0f),
    (offset >> 8) & 0xff,
    offset & 0xff,
  ]);
}

/** The missing-resource marker. */
export const MISSING = Buffer.from([0xff, 0xff, 0xff]);

/** Build a VOL resource block: 5-byte header plus payload. */
export function volResource(volume, payload) {
  return Buffer.concat([
    Buffer.from([0x12, 0x34, volume, payload.length & 0xff, (payload.length >> 8) & 0xff]),
    payload,
  ]);
}

/** @returns {Promise<string>} a fresh empty temporary directory */
export function tempDir(prefix = 'agi-extract-') {
  return mkdtemp(join(tmpdir(), prefix));
}

/**
 * Create a temporary AGI game directory.
 *
 * @param {object} spec
 * @param {Record<string, Buffer>} [spec.dirs]    canonical type -> directory file bytes
 * @param {Record<string, Buffer>} [spec.volumes] volume number -> VOL file bytes
 * @param {Record<string, Buffer>} [spec.files]   extra files, written verbatim
 * @returns {Promise<string>} path to the game directory
 */
export async function makeGame({ dirs = {}, volumes = {}, files = {} } = {}) {
  const dir = await tempDir('agi-game-');

  for (const [type, buffer] of Object.entries(dirs)) {
    await writeFile(join(dir, DIR_FILE_BY_TYPE[type]), buffer);
  }
  for (const [volume, buffer] of Object.entries(volumes)) {
    await writeFile(join(dir, `VOL.${volume}`), buffer);
  }
  for (const [name, buffer] of Object.entries(files)) {
    await writeFile(join(dir, name), buffer);
  }

  return dir;
}

export const LOGIC_0 = Buffer.from('logic zero payload');
export const LOGIC_2 = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]);
export const PIC_0 = Buffer.alloc(300, 0x7e);
export const VIEW_0 = Buffer.alloc(64, 0x55);
export const SOUND_0 = Buffer.from('sound zero');

/**
 * A four-type sample game.
 *
 * VOL.0 holds logic 0 and logic 2 (logic 1 is marked missing) and pic 1
 * (pic 0 is marked missing). VOL.1 holds view 0 and sound 0. Both VOL files
 * start with padding so no resource sits at offset 0.
 */
export async function sampleGame() {
  const pad = Buffer.alloc(4, 0x00);

  const logic0 = volResource(0, LOGIC_0);
  const logic2 = volResource(0, LOGIC_2);
  const pic1 = volResource(0, PIC_0);
  const view0 = volResource(1, VIEW_0);
  const sound0 = volResource(1, SOUND_0);

  const at = (blocks, index) =>
    blocks.slice(0, index).reduce((sum, b) => sum + b.length, pad.length);

  const vol0Blocks = [logic0, logic2, pic1];
  const vol1Blocks = [view0, sound0];

  return makeGame({
    dirs: {
      logic: Buffer.concat([dirEntry(0, at(vol0Blocks, 0)), MISSING, dirEntry(0, at(vol0Blocks, 1))]),
      pic: Buffer.concat([MISSING, dirEntry(0, at(vol0Blocks, 2))]),
      view: dirEntry(1, at(vol1Blocks, 0)),
      sound: dirEntry(1, at(vol1Blocks, 1)),
    },
    volumes: {
      0: Buffer.concat([pad, ...vol0Blocks]),
      1: Buffer.concat([pad, ...vol1Blocks]),
    },
  });
}

/**
 * Build one VIEW cel: a 3-byte header plus RLE lines.
 *
 * @param {object} cel
 * @param {number} cel.width
 * @param {number} cel.height
 * @param {number} [cel.transparent]
 * @param {boolean} [cel.mirrored]
 * @param {number} [cel.sourceLoop]
 * @param {Array<Array<[number, number]>>} cel.lines  per row, [colour, run] chunks
 * @returns {Buffer}
 */
export function celBytes({ width, height, transparent = 0, mirrored = false, sourceLoop = 0, lines }) {
  const out = [
    width,
    height,
    (mirrored ? 0x80 : 0) | ((sourceLoop & 0x07) << 4) | (transparent & 0x0f),
  ];

  for (const line of lines) {
    for (const [colour, run] of line) out.push((colour << 4) | run);
    out.push(0x00); // end of line
  }

  return Buffer.from(out);
}

/**
 * Build a VIEW resource.
 *
 * A loop given as `{ mirrorOf: n }` reuses loop n's data, which is how the
 * format stores a mirrored animation.
 *
 * @param {Array<Buffer[] | { mirrorOf: number }>} loops
 * @param {{ description?: string | null }} [options]
 * @returns {Buffer}
 */
export function viewBytes(loops, { description = null } = {}) {
  const headerSize = 5 + loops.length * 2;
  const blocks = [];
  const loopOffsets = [];
  let offset = headerSize;

  loops.forEach((cels) => {
    if (!Array.isArray(cels)) {
      loopOffsets.push(loopOffsets[cels.mirrorOf]); // share the other loop's data
      return;
    }

    loopOffsets.push(offset);

    const headerLength = 1 + cels.length * 2;
    const head = Buffer.alloc(headerLength);
    head[0] = cels.length;

    let relative = headerLength;
    cels.forEach((cel, i) => {
      head.writeUInt16LE(relative, 1 + i * 2); // cel offsets are loop-relative
      relative += cel.length;
    });

    const block = Buffer.concat([head, ...cels]);
    blocks.push(block);
    offset += block.length;
  });

  const header = Buffer.alloc(headerSize);
  header[0] = 2;
  header[1] = 1;
  header[2] = loops.length;
  header.writeUInt16LE(description ? offset : 0, 3);
  loopOffsets.forEach((o, i) => header.writeUInt16LE(o, 5 + i * 2));

  const parts = [header, ...blocks];
  if (description) parts.push(Buffer.from(`${description}\0`, 'latin1'));

  return Buffer.concat(parts);
}

/** A two-loop view: loop 0 has two 4x2 cels, loop 1 mirrors it. */
export const MIRRORED_VIEW = viewBytes(
  [
    [
      celBytes({
        width: 4,
        height: 2,
        transparent: 0,
        mirrored: true,
        sourceLoop: 0,
        lines: [
          [[1, 1], [2, 3]],
          [[4, 2], [5, 2]],
        ],
      }),
      celBytes({
        width: 4,
        height: 2,
        transparent: 0,
        mirrored: true,
        sourceLoop: 0,
        lines: [
          [[6, 4]],
          [[7, 4]],
        ],
      }),
    ],
    { mirrorOf: 0 },
  ],
  { description: 'a test view' },
);
