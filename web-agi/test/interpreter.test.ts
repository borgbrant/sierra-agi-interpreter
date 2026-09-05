/**
 * What the engine takes from the interpreter that shipped beside the game.
 *
 * M15 and M16 read four dither tables out of `AGIDATA.OVL` at four fixed
 * offsets, and M18 found out what that meant: those are one copy's offsets. The
 * tables are found now, and a file that has none is refused rather than read
 * as though it had.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BLOCK_BYTES, BLOCK_LAYOUT, findTables, readInterpreterTables } from '../src/render/agidata.ts';
import { CGA_TABLES, CGA_TABLES_AT } from '../src/render/cgatables.ts';
import { HGC_DITHER, HGC_DITHER_OFFSET } from '../src/render/hgcdither.ts';
import { readInterpreterVersion } from '../src/resources/interpreter.ts';
import { DEFAULT_COMMAND_COUNT } from '../src/logic/reader.ts';
import { DiskSource } from './helpers/disk-source.ts';

const source = await DiskSource.open();
const AGIDATA = (await source.read('AGIDATA.OVL'))!;

test('the bundled game’s tables are found where M15 and M16 recorded them', () => {
  const sites = findTables(AGIDATA);

  assert.deepEqual(sites, {
    fill: CGA_TABLES_AT.fill,
    mono: CGA_TABLES_AT.mono,
    colour: CGA_TABLES_AT.colour,
    hercules: HGC_DITHER_OFFSET,
  });
});

test('finding them gives the same tables the engine ships', () => {
  const tables = readInterpreterTables(AGIDATA);

  assert.notEqual(tables.sites, null, tables.why ?? 'the tables were not found');
  assert.deepEqual(tables.cga, CGA_TABLES);
  assert.deepEqual(tables.hercules, HGC_DITHER);
});

test('the block is found wherever it is, which is the whole point', () => {
  // King's Quest I keeps the same 242 bytes 436 further on. Rather than
  // depend on that copy being present, this moves the block by hand and asks
  // for it back.
  const moved = new Uint8Array(AGIDATA.length + 1000);
  const block = AGIDATA.subarray(CGA_TABLES_AT.fill, CGA_TABLES_AT.fill + BLOCK_BYTES);
  moved.set(block, CGA_TABLES_AT.fill + 436);

  const sites = findTables(moved);

  assert.equal(sites?.fill, CGA_TABLES_AT.fill + 436);
  assert.equal(sites?.hercules, HGC_DITHER_OFFSET + 436);
  assert.deepEqual(readInterpreterTables(moved).cga, CGA_TABLES);
});

test('a file with no table block falls back rather than reading one anyway', () => {
  const text = new TextEncoder().encode('store in\n\n%s\n\nPress ENTER'.repeat(400));

  const tables = readInterpreterTables(text);

  assert.equal(tables.sites, null);
  assert.deepEqual(tables.hercules, HGC_DITHER, 'the engine’s own table');
  assert.match(tables.why!, /no table block/);
});

test('the printf string at the old offset is not a dither table', () => {
  // The M18 defect in one assertion. Put the bytes King's Quest I has at
  // 0x1bea where the engine used to look, leave the real block elsewhere, and
  // the search must not be fooled into calling the string a table.
  const string = new TextEncoder().encode('store in\n\n%s\n\nPress ENTER to continue.\n\n');
  const file = new Uint8Array(AGIDATA.length);
  file.set(AGIDATA);
  file.set(string.subarray(0, 40), HGC_DITHER_OFFSET);

  const sites = findTables(file);

  assert.equal(sites, null, 'the block is broken, so there is no block to find');
  assert.deepEqual(readInterpreterTables(file).hercules, HGC_DITHER, 'and the fallback is used');
});

test('the two halves of the block are checked against each other', () => {
  // The CGA anchor is what makes the search unambiguous, and the Hercules
  // table is what confirms it: break either and the block is not a block.
  const file = new Uint8Array(AGIDATA.length);
  file.set(AGIDATA);
  file[CGA_TABLES_AT.fill + 3] = 0xff; // the fill table no longer ties to mono

  assert.equal(findTables(file), null);
});

test('the layout is the distances the two copies agree on', () => {
  assert.equal(BLOCK_LAYOUT.mono - BLOCK_LAYOUT.fill, CGA_TABLES_AT.mono - CGA_TABLES_AT.fill);
  assert.equal(BLOCK_LAYOUT.colour - BLOCK_LAYOUT.mono, CGA_TABLES_AT.colour - CGA_TABLES_AT.mono);
  assert.equal(BLOCK_LAYOUT.hercules - BLOCK_LAYOUT.mono, HGC_DITHER_OFFSET - CGA_TABLES_AT.mono);
});

test('the interpreter version is read out of the game’s own file', () => {
  const interpreter = readInterpreterVersion(AGIDATA);

  assert.equal(interpreter.version, '2.440');
  assert.equal(interpreter.commandCount, DEFAULT_COMMAND_COUNT);
  assert.equal(interpreter.read, true);
});

test('a file with no version line falls back to the bundled game’s', () => {
  const interpreter = readInterpreterVersion(new Uint8Array(4096));

  assert.equal(interpreter.read, false);
  assert.equal(interpreter.commandCount, DEFAULT_COMMAND_COUNT);
  assert.match(interpreter.why!, /no version line/);
});

test('a version this engine has no count for is not guessed at', () => {
  const file = new TextEncoder().encode('    Version 9.999\0\0Press ENTER');

  const interpreter = readInterpreterVersion(file);

  assert.equal(interpreter.version, '9.999', 'said, because it is what the file says');
  assert.equal(interpreter.read, false);
  assert.equal(interpreter.commandCount, DEFAULT_COMMAND_COUNT, 'and the count is not invented');
});
