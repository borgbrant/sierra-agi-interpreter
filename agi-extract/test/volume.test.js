import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { parseVolHeader, VOL_HEADER_SIZE } from '../src/agi/volume.js';
import { VolumeFile } from '../src/agi/volume-file.js';
import { ERROR_CODES } from '../src/util/errors.js';
import { tempDir, volResource } from './helpers.js';

/**
 * @param {Buffer} buffer file contents
 * @param {number} volume the VOL number it claims to be
 */
async function openVol(buffer, volume = 0) {
  const dir = await tempDir('agi-vol-');
  const path = join(dir, `VOL.${volume}`);
  await writeFile(path, buffer);
  return VolumeFile.open(volume, path);
}

test('accepts a valid 12 34 signature', () => {
  const header = parseVolHeader(Buffer.from([0x12, 0x34, 0x00, 0x10, 0x00]), 0);
  assert.deepEqual(header, { volume: 0, payloadLength: 0x10, headerLength: VOL_HEADER_SIZE });
});

test('rejects an invalid signature', () => {
  assert.throws(() => parseVolHeader(Buffer.from([0x12, 0x35, 0x00, 0x00, 0x00]), 0), {
    code: ERROR_CODES.INVALID_VOL_SIGNATURE,
    message: /Expected 0x12 0x34 at VOL\.0 offset 0/,
  });
});

test('rejects a mismatched volume byte', () => {
  assert.throws(() => parseVolHeader(Buffer.from([0x12, 0x34, 0x02, 0x00, 0x00]), 1), {
    code: ERROR_CODES.VOL_NUMBER_MISMATCH,
  });
});

test('reads a little-endian payload length', async (t) => {
  const vol = await openVol(volResource(0, Buffer.alloc(0x0123, 0x41)));
  t.after(() => vol.close());

  const header = await vol.readHeader(0);
  assert.equal(header.payloadLength, 0x0123);
  assert.equal(header.headerLength, 5);
  assert.equal(header.offset, 0);
});

test('returns the payload exactly as stored, without the header', async (t) => {
  const payload = Buffer.from([0x00, 0xff, 0x12, 0x34, 0x7f]);
  const vol = await openVol(Buffer.concat([Buffer.alloc(16, 0xaa), volResource(0, payload)]));
  t.after(() => vol.close());

  const resource = await vol.readResource(16);
  assert.deepEqual(resource.payload, payload);
  assert.equal(resource.offset, 16);
  assert.equal(resource.payloadLength, payload.length);
});

test('includeHeader prepends the 5-byte header', async (t) => {
  const payload = Buffer.from('abcdef');
  const block = volResource(0, payload);
  const vol = await openVol(block);
  t.after(() => vol.close());

  const resource = await vol.readResource(0, { includeHeader: true });
  assert.deepEqual(resource.payload, block);
  assert.equal(resource.payloadLength, payload.length);
});

test('reads a zero-length payload', async (t) => {
  const vol = await openVol(volResource(0, Buffer.alloc(0)));
  t.after(() => vol.close());

  assert.equal((await vol.readResource(0)).payload.length, 0);
});

test('rejects a payload length that runs past the end of the file', async (t) => {
  const truncated = volResource(0, Buffer.alloc(100)).subarray(0, 50);
  const vol = await openVol(truncated);
  t.after(() => vol.close());

  await assert.rejects(vol.readHeader(0), { code: ERROR_CODES.PAYLOAD_OUT_OF_RANGE });
});

test('rejects an offset past the end of the file', async (t) => {
  const vol = await openVol(volResource(0, Buffer.from('x')));
  t.after(() => vol.close());

  await assert.rejects(vol.readHeader(9999), { code: ERROR_CODES.VOL_OFFSET_OUT_OF_RANGE });
});

test('rejects a header that cannot be read in full', async (t) => {
  const vol = await openVol(Buffer.from([0x12, 0x34, 0x00]));
  t.after(() => vol.close());

  await assert.rejects(vol.readHeader(0), { code: ERROR_CODES.VOL_HEADER_TRUNCATED });
});

test('reports a missing VOL file', async () => {
  const dir = await tempDir('agi-vol-');
  await assert.rejects(VolumeFile.open(0, join(dir, 'VOL.0')), {
    code: ERROR_CODES.VOL_FILE_NOT_FOUND,
  });
});
