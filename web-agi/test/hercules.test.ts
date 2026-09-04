/**
 * Hercules: 720x348, two colours, its own cell, and no room at the bottom.
 *
 * The first of these modes with a reference to check against -- a photograph of
 * the real thing -- so unlike M12 these tests are not purely about recording
 * what the mapping costs. Several of them assert *arithmetic* that the
 * photograph corroborates: that the status row and the picture add up to the
 * whole screen, and that the picture is 640 of 720 pixels wide.
 *
 * The rest are about the property a mono renderer has least of to spare, which
 * is the ability to tell two things apart. With two colours that is the whole
 * game.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

import { calibrate, decodePng, luma, otsu, STATUS_ROWS } from '../scripts/rectify-screenshot.mjs';

import type { SoundChip } from '../src/audio/output.ts';
import { buildHandlers } from '../src/engine/commands/index.ts';
import { Cycle } from '../src/engine/cycle.ts';
import { MONITOR } from '../src/engine/hardware.ts';
import { PICTURE_ROW } from '../src/engine/layout.ts';
import { CommandLine, NumberQuestion } from '../src/engine/interaction.ts';
import { Machine } from '../src/engine/machine.ts';
import { enterRoom } from '../src/engine/room.ts';
import { buildFrame } from '../src/engine/present.ts';
import { FLAG, VAR } from '../src/engine/state.ts';
import { keyNamed } from '../src/input/keyboard.ts';
import { PALETTE_SIZE } from '../src/render/display.ts';
import type { DisplayMode } from '../src/render/drivers/driver.ts';
import { EgaDriver } from '../src/render/drivers/ega.ts';
import {
  HGC_PIXEL_HEIGHT,
  HGC_PIXEL_WIDTH,
  HERCULES_CELL,
  HERCULES_HEIGHT,
  HERCULES_PALETTE_RGB,
  HERCULES_WIDTH,
  herculesSolid,
  herculesTextColours,
  HerculesDriver,
  PATTERN_HEIGHT,
  PATTERN_WIDTH,
} from '../src/render/drivers/hercules.ts';
import {
  decodeHgcDither,
  ditherDensity,
  HGC_CELL_HEIGHT,
  HGC_CELL_WIDTH,
  HGC_DITHER,
  HGC_DITHER_BYTES,
  HGC_DITHER_OFFSET,
  HGC_LEVELS,
} from '../src/render/hgcdither.ts';
import { createDriver } from '../src/render/drivers/index.ts';
import { Frame } from '../src/render/frame.ts';
import { PICTURE_HEIGHT, PICTURE_WIDTH, Screens } from '../src/render/screens.ts';
import { COLUMNS, ROWS } from '../src/render/text.ts';
import { ResourceManager } from '../src/resources/manager.ts';
import { parseObjectFile } from '../src/resources/objects.ts';
import { Vocabulary } from '../src/resources/words.ts';
import { DiskSource, GAME_DIR } from './helpers/disk-source.ts';
import { BRIGHTNESS, CAPTURES, CAPTURE_DIR, ENOUGH, FIT } from './helpers/hgc-reference.ts';

const source = await DiskSource.open();
const resources = await ResourceManager.open(source);
await resources.preload();
const objects = parseObjectFile((await source.read('OBJECT'))!);
const vocabulary = Vocabulary.parse((await source.read('WORDS.TOK'))!);

const FIRST_SEED = 0x2f6e2b1;
let seed = FIRST_SEED;
Math.random = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x80000000;
};

/** A game running on a chosen display, past its start-up. */
function bootWithCycle(mode: DisplayMode, chip: SoundChip = 'speaker', cycles = 60) {
  seed = FIRST_SEED;
  const machine = new Machine({ resources, objects, vocabulary });
  machine.setHandlers(buildHandlers());
  machine.setDisplayMode(mode);
  machine.setSoundChip(chip);

  const cycle = new Cycle(machine);
  cycle.start(0);
  for (let i = 0; i < cycles; i++) if (!cycle.runOnce()) break;
  return { machine, cycle };
}

// --- the geometry, which is arithmetic all the way down --------------------

test('Hercules is 720x348 in two colours, and mono', () => {
  const driver = new HerculesDriver();

  assert.equal(driver.display.width, HERCULES_WIDTH);
  assert.equal(driver.display.height, HERCULES_HEIGHT);
  assert.equal(driver.display.palette.length / 3, 2);
  assert.equal(driver.monochrome, true, 'which is what the scripts are told');
});

test('the picture keeps the shape EGA draws it in, exactly', () => {
  // Four across by two down is the same two-to-one EGA stretches by, so the
  // buffer wants square pixels and 640x336 is the picture's own proportion.
  // Not approximately: 640/336 and 320/168 are both 1.905:1.
  const driver = new HerculesDriver();
  assert.equal(driver.pixelAspect, 1);

  const wide = PICTURE_WIDTH * HGC_PIXEL_WIDTH * driver.pixelAspect;
  assert.equal(wide / driver.pictureHeight, (PICTURE_WIDTH * 2) / PICTURE_HEIGHT);
});

test('the picture reaches the bottom of the screen, with no dead band', () => {
  // What the photographs show. The picture is 336 rows and the grid's rows 1 to
  // 24 are exactly those rows, at 14 apiece -- so row 24 ends at the bottom of
  // the screen and there is nothing under it.
  const driver = new HerculesDriver();

  assert.equal(driver.pictureHeight, PICTURE_HEIGHT * HGC_PIXEL_HEIGHT);
  assert.equal(driver.pictureHeight, 336);
  assert.equal(HERCULES_CELL.height, 14, '336 over 24 rows');
  assert.equal(PICTURE_ROW * HERCULES_CELL.height + driver.pictureHeight, 350);
  assert.ok(350 - HERCULES_HEIGHT <= 2, 'the last two pixels fall off a 348-row card');

  // Lit to the last row, so nothing is left over for a band.
  const screen = new Uint8Array(PICTURE_WIDTH * PICTURE_HEIGHT).fill(15);
  driver.draw(new Frame().fill(0).picture(screen, PICTURE_ROW));

  const last = (HERCULES_HEIGHT - 1) * HERCULES_WIDTH + driver.pictureLeft;
  assert.equal(driver.display.pixels[last], 1, 'the very last picture row is drawn');
});

test("the game's bottom band sits on the bottom of the screen", () => {
  // Rows 22 to 24 are the last three rows of the grid, so a band painted there
  // is flush with the screen's bottom edge rather than floating above it --
  // which is where the photographs have it.
  const bandTop = 22 * HERCULES_CELL.height;
  assert.equal(bandTop, 308);
  assert.ok(HERCULES_HEIGHT - bandTop <= 3 * HERCULES_CELL.height, 'three rows, no more');
  assert.ok(HERCULES_HEIGHT - bandTop >= 2 * HERCULES_CELL.height, 'and no fewer than two');
});

test('the character grid lines up with the picture, not with the screen', () => {
  // The photographs show the status bar exactly as wide as the scene, and the
  // bottom band starting at the scene's left edge. So the 40 columns go across
  // the picture's 640 rather than across all 720.
  const driver = new HerculesDriver();
  assert.equal(HERCULES_CELL.originX, driver.pictureLeft);
  assert.equal(HERCULES_CELL.width * COLUMNS, PICTURE_WIDTH * HGC_PIXEL_WIDTH);

  driver.draw(new Frame().fill(0).text('X'.repeat(COLUMNS), 0, 0, 15, 0));

  const at = (x: number, y: number) => driver.display.pixels[y * HERCULES_WIDTH + x]!;
  assert.equal(at(driver.pictureLeft - 1, 4), 0, 'nothing left of the scene');
  assert.equal(at(driver.pictureLeft + 640, 4), 0, 'nor right of it');
});

test('the rows the game writes its bottom band on have scene behind them', () => {
  // Which is why `clear.lines` has to paint. All 34 of the game's calls are on
  // rows 21 to 24 and all clear to black, and 19 of its `display` calls write
  // there; on this display those rows are over the picture, so a clear that
  // emptied cells instead would put the band on the scene.
  const driver = new HerculesDriver();
  const screen = new Uint8Array(PICTURE_WIDTH * PICTURE_HEIGHT).fill(15);
  driver.draw(new Frame().fill(0).picture(screen, PICTURE_ROW));

  for (let row = 21; row < ROWS; row++) {
    const y = row * HERCULES_CELL.height;
    assert.equal(
      driver.display.pixels[y * HERCULES_WIDTH + driver.pictureLeft],
      1,
      `row ${row} is picture, not chrome`,
    );
  }
});

test('the picture is 640 of 720 pixels wide, centred', () => {
  // Corroborated rather than merely consistent: the photograph has unlit
  // margins either side of the scene at about this fraction, while the status
  // bar runs edge to edge.
  const driver = new HerculesDriver();
  assert.equal(PICTURE_WIDTH * HGC_PIXEL_WIDTH, 640);
  assert.equal(driver.pictureLeft, 40);
  assert.equal(driver.pictureLeft * 2 + 640, HERCULES_WIDTH);
});

test('the grid is 40 columns of 16 pixels, and 25 rows of 14', () => {
  assert.equal(HERCULES_CELL.width, 16, '640 of picture across 40 columns');
  assert.equal(HERCULES_CELL.height, 14);
  assert.equal(ROWS * HERCULES_CELL.height, 350, 'two pixels past a 348-row card');
});

test('the glyph fills the cell, and the font supplies the letter spacing', () => {
  // The photographs show thick wide letters with air between them. The width
  // comes from doubling an 8-bit glyph into a 16-pixel cell; the air comes from
  // the font, which leaves its rightmost column blank in all but two of its 95
  // glyphs, so that column doubles to two pixels of ground.
  //
  // Filling all fourteen rows rather than twelve is what keeps the strokes
  // even: eight into twelve alternates two and one and thins every other
  // stroke, eight into fourteen thins one.
  const driver = new HerculesDriver();
  driver.draw(new Frame().fill(15).text('MMMM', 0, 0, 0, 15));

  const at = (x: number, y: number) => driver.display.pixels[y * HERCULES_WIDTH + x]!;
  const ink = herculesSolid(0);
  const ground = herculesSolid(15);
  const left = HERCULES_CELL.originX!;

  // An M is inked from the cell's left edge, two pixels per column of glyph.
  assert.equal(at(left, 4), ink, 'the glyph starts at the cell edge');
  assert.equal(at(left + 1, 4), ink, 'and each column is two pixels wide');

  // Its rightmost column is the font's own blank, doubled.
  assert.equal(at(left + 14, 4), ground, 'the font spaces the letters itself');
  assert.equal(at(left + 15, 4), ground);
  assert.equal(at(left + 16, 4), ink, 'and the next M begins');

  // Two device rows per font row, for six of the font's eight rows. Only the
  // one thinned stroke and the blank bottom row are single.
  const rows = new Map<number, number>();
  for (let y = 0; y < HERCULES_CELL.height; y++) {
    let inked = 0;
    for (let x = 0; x < 16; x++) if (at(left + x, y) === ink) inked++;
    rows.set(inked, (rows.get(inked) ?? 0) + 1);
  }
  assert.ok(
    [...rows.values()].filter((n) => n === 1).length <= 2,
    'at most two rows of the cell stand alone',
  );
});

// --- the dither, which is the interpreter's own -----------------------------

/**
 * The table is 128 bytes at offset 0x1bea of `AGIDATA.OVL`, indexed by the blit
 * in `HGC_GRAF.OVL`. Two milestones guessed at it before anyone opened the
 * file: M13 derived densities from luminance, M15 measured them off the
 * captures and got eleven of the sixteen wrong, because thresholding a capture
 * flattens a one-pixel checkerboard into a half-tone. These tests hold the
 * table against the file, and the file against the captures' brightness.
 */

test("the shipped table is the bytes in the game's own AGIDATA.OVL", async () => {
  // The strongest test in this file: the constant in hgcdither.ts is not a
  // measurement or a judgement, it is a copy, and this is what says so.
  const bytes = await source.read('AGIDATA.OVL');
  assert.ok(bytes, 'AGIDATA.OVL is bundled');

  const fromFile = decodeHgcDither(bytes);
  assert.deepEqual(fromFile.map((rows) => [...rows]), HGC_DITHER.map((rows) => [...rows]));

  // And the offset is where the driver's code says, which is worth pinning
  // because a wrong offset in a 7680-byte file still decodes to something.
  assert.equal(HGC_DITHER_OFFSET, 0x1bea);
  assert.equal(HGC_DITHER_BYTES, PALETTE_SIZE * HGC_CELL_HEIGHT);
});

test('a cell is eight device rows of eight device pixels', () => {
  // Which follows from the driver's own arithmetic: colour * 8 picks the eight
  // bytes, (row and 3) * 2 picks two of them for an AGI row's two device rows,
  // and one byte spans two AGI pixels of four device pixels each.
  assert.equal(HGC_CELL_WIDTH, 8);
  assert.equal(HGC_CELL_HEIGHT, 8);
  assert.equal(HGC_LEVELS, 64);
  assert.equal(PATTERN_WIDTH, HGC_CELL_WIDTH);
  assert.equal(PATTERN_HEIGHT, HGC_CELL_HEIGHT);

  assert.equal(HGC_DITHER.length, PALETTE_SIZE);
  for (const [colour, rows] of HGC_DITHER.entries()) {
    assert.equal(rows.length, HGC_CELL_HEIGHT, `colour ${colour}`);
    for (const row of rows) assert.ok(row >= 0 && row <= 0xff, `colour ${colour} row ${row}`);
  }
});

test('every colour has a pattern, and only black and white are solid', () => {
  // This is what the two wrong tables both missed in their own direction. There
  // is no threshold in the original: fourteen of the sixteen are dithered.
  const solid = [...HGC_DITHER.keys()]
    .filter((colour) => [0, HGC_LEVELS].includes(ditherDensity(HGC_DITHER, colour)));
  assert.deepEqual(solid, [0, 15]);

  assert.equal(ditherDensity(HGC_DITHER, 0), 0);
  assert.equal(ditherDensity(HGC_DITHER, 15), HGC_LEVELS);
});

test('the sixteen colours reach ten distinct densities', () => {
  // Ten levels out of a possible sixty-five, and four of them are shared:
  // green, magenta and dark grey at 8/64; cyan, red and brown at 16/64; light
  // blue with light cyan at 56/64; light red with light magenta at 48/64. Those
  // are indistinguishable by brightness and told apart, where they are told
  // apart at all, by the shape of the weave.
  const densities = [...HGC_DITHER.keys()].map((colour) => ditherDensity(HGC_DITHER, colour));
  assert.deepEqual(densities, [0, 4, 8, 16, 16, 8, 16, 32, 8, 56, 40, 56, 48, 48, 60, 64]);
  assert.equal(new Set(densities).size, 10);
});

test('brown is the 45 degree diagonal the captures show plainly', () => {
  // The one pattern coarse enough to survive a capture's smoothing, which is
  // why it is the one M15 found: its lit pixels are four apart rather than
  // adjacent. LSL1 shades with brown, so it is also the most visible.
  assert.deepEqual([...HGC_DITHER[6]!], [0x11, 0x22, 0x44, 0x88, 0x11, 0x22, 0x44, 0x88]);
  assert.equal(ditherDensity(HGC_DITHER, 6), 16);

  const litColumns = (row: number) =>
    [...Array(HGC_CELL_WIDTH).keys()].filter((x) => (row >> (HGC_CELL_WIDTH - 1 - x)) & 1);
  const rows = HGC_DITHER[6]!.map((row) => litColumns(row));
  for (const [y, columns] of rows.entries()) {
    assert.equal(columns.length, 2, `row ${y} lights two of eight`);
    assert.equal(columns[1]! - columns[0]!, 4, `row ${y} spaces them evenly`);
  }
  assert.deepEqual(rows.map((columns) => columns[0]), [3, 2, 1, 0, 3, 2, 1, 0]);
});

test('light grey is a checkerboard, which is what a threshold cannot see', () => {
  // The colour that misled the first measurement, kept as a test because it is
  // the reason the captures are read for brightness rather than for bits.
  assert.deepEqual([...HGC_DITHER[7]!], [0x55, 0xaa, 0x55, 0xaa, 0x55, 0xaa, 0x55, 0xaa]);
  assert.equal(ditherDensity(HGC_DITHER, 7) * 2, HGC_LEVELS, 'exactly half lit');
});

test('a region of one colour comes out at the density the table asks for', () => {
  const driver = new HerculesDriver();
  const top = PICTURE_ROW * HERCULES_CELL.height;

  for (let colour = 0; colour < PALETTE_SIZE; colour++) {
    const screen = new Uint8Array(PICTURE_WIDTH * PICTURE_HEIGHT).fill(colour);
    driver.draw(new Frame().fill(0).picture(screen, PICTURE_ROW));

    let count = 0;
    for (let y = 0; y < HGC_CELL_HEIGHT; y++) {
      for (let x = 0; x < HGC_CELL_WIDTH; x++) {
        count += driver.display.pixels[(top + y) * HERCULES_WIDTH + driver.pictureLeft + x]!;
      }
    }
    assert.equal(count, ditherDensity(HGC_DITHER, colour), `colour ${colour} over one cell`);
  }
});

test('the driver draws through the table it was given', () => {
  // The table is an interpreter file, so a driver has to be able to take
  // another one -- and this is what stops the shipped constant from being
  // quietly hard-wired into the blit.
  const inverted = HGC_DITHER.map((rows) => rows.map((row) => ~row & 0xff));
  const driver = new HerculesDriver(undefined, inverted);
  const top = PICTURE_ROW * HERCULES_CELL.height;

  const screen = new Uint8Array(PICTURE_WIDTH * PICTURE_HEIGHT).fill(7);
  driver.draw(new Frame().fill(0).picture(screen, PICTURE_ROW));

  const at = (x: number, y: number) =>
    driver.display.pixels[(top + y) * HERCULES_WIDTH + driver.pictureLeft + x]!;
  assert.equal(at(0, 0), 1, "light grey's checkerboard, inverted");
  assert.equal(at(1, 0), 0);
});

test('no two colours a level apart share a weave', () => {
  // What the eleven densities cost, recorded rather than asserted away: five
  // pairs are identical in density, and this says whether they are identical
  // outright. Two colours with the same pattern are one colour on screen.
  const seen = new Map<string, number[]>();
  for (const [colour, rows] of HGC_DITHER.entries()) {
    const key = rows.join(',');
    seen.set(key, [...(seen.get(key) ?? []), colour]);
  }

  const shared = [...seen.values()].filter((colours) => colours.length > 1);
  assert.deepEqual(shared, [], 'all sixteen weaves are distinct');
});

test('black is never lit and white always is', () => {
  const driver = new HerculesDriver();
  const black = new Uint8Array(PICTURE_WIDTH * PICTURE_HEIGHT).fill(0);
  driver.draw(new Frame().fill(0).picture(black, PICTURE_ROW));
  assert.ok(driver.display.pixels.every((pixel) => pixel === 0), 'nothing is lit');

  const white = new Uint8Array(PICTURE_WIDTH * PICTURE_HEIGHT).fill(15);
  driver.draw(new Frame().fill(0).picture(white, PICTURE_ROW));

  // Every pixel of the picture area, and none of the margins.
  const at = (x: number, y: number) => driver.display.pixels[y * HERCULES_WIDTH + x]!;
  const top = PICTURE_ROW * HERCULES_CELL.height;
  assert.equal(at(driver.pictureLeft, top), 1);
  assert.equal(at(driver.pictureLeft + 639, top), 1);
  assert.equal(at(0, top), 0, 'the margin stays unlit');
  assert.equal(at(HERCULES_WIDTH - 1, top), 0);
});

test('text takes the solid side of a dithered colour', () => {
  // A glyph stroke is a pixel or two of its cell, so a dithered stroke is a
  // stroke with holes in it. The split is at half the density, which puts light
  // grey's checkerboard on the lit side and brown's diagonal on the unlit one.
  assert.equal(herculesSolid(7), 1, "light grey's half is ink");
  assert.equal(herculesSolid(6), 0, "brown's quarter is ground");
  assert.equal(herculesSolid(0), 0);
  assert.equal(herculesSolid(15), 1);
});

// --- against the captures themselves ----------------------------------------

/**
 * The table above is a copy of the interpreter's; this is what the original's
 * own screen says about it.
 *
 * Skipped when `screenshots-from-original/` is absent, which is the normal case
 * for a fresh clone: the captures are large and not this project's to
 * redistribute.
 *
 * What is measured is **brightness**, not bits. Half of the table's patterns
 * alternate on a one-pixel pitch and a capture smooths those into a flat
 * half-tone, so thresholding one reports light grey's checkerboard as solid
 * amber and cyan's alternating rows as solid black. The mean luminance of a
 * colour's regions survives, and the check is that it is a straight line in the
 * table's densities.
 */
const captureDir = resolve(GAME_DIR, '..', '..', CAPTURE_DIR);
const haveCaptures = existsSync(captureDir);

/** AGI pixels whose four neighbours share their colour. */
function interiors(colours: ArrayLike<number>): Uint8Array {
  const keep = new Uint8Array(PICTURE_WIDTH * PICTURE_HEIGHT);
  for (let y = 1; y < PICTURE_HEIGHT - 1; y++) {
    for (let x = 1; x < PICTURE_WIDTH - 1; x++) {
      const at = y * PICTURE_WIDTH + x;
      const colour = colours[at]! & 0x0f;
      keep[at] = colour === (colours[at - 1]! & 0x0f) && colour === (colours[at + 1]! & 0x0f)
        && colour === (colours[at - PICTURE_WIDTH]! & 0x0f)
        && colour === (colours[at + PICTURE_WIDTH]! & 0x0f) ? 1 : 0;
    }
  }
  return keep;
}

/** The screen a room composes: picture plus whatever the room drew over it. */
function composeRoom(room: number, cycles: number): ArrayLike<number> {
  const { machine, cycle } = bootWithCycle('hercules', 'speaker', 40);
  try {
    enterRoom(machine, room);
  } catch {
    // enterRoom unwinds the cycle it interrupts; that is how rooms change.
  }
  for (let i = 0; i < cycles; i++) if (!cycle.runOnce()) break;

  const picture = buildFrame(machine).layers.find((layer) => layer.kind === 'picture');
  assert.ok(picture && picture.kind === 'picture', `room ${room} composed a picture`);
  return picture.screen;
}

/** Every colour's mean luminance in the captures, pooled. */
function measureBrightness(): { pixels: number[]; luma: number[] } {
  const sum = new Float64Array(PALETTE_SIZE);
  const count = new Float64Array(PALETTE_SIZE);

  for (const capture of CAPTURES) {
    const image = decodePng(readFileSync(resolve(captureDir, capture.file)));
    const values = luma(image);
    const screen = composeRoom(capture.room, capture.cycles);
    const keep = interiors(screen);
    const { originX, originY, scale } = capture.geometry;

    for (let ay = 0; ay < PICTURE_HEIGHT; ay++) {
      const top = originY + (STATUS_ROWS + ay * HGC_PIXEL_HEIGHT) * scale;
      for (let ax = 0; ax < PICTURE_WIDTH; ax++) {
        if (!keep[ay * PICTURE_WIDTH + ax]) continue;
        const left = originX + ax * HGC_PIXEL_WIDTH * scale;

        // The inner part of the footprint, so a pixel beside a lit neighbour is
        // not counted as brighter than it is.
        let total = 0;
        let n = 0;
        for (let py = Math.ceil(top + 1); py < top + HGC_PIXEL_HEIGHT * scale - 1; py++) {
          if (py < 0 || py >= image.height) continue;
          for (let px = Math.ceil(left + 1); px < left + HGC_PIXEL_WIDTH * scale - 1; px++) {
            if (px < 0 || px >= image.width) continue;
            total += values[py * image.width + px]!;
            n++;
          }
        }
        if (!n) continue;
        const colour = screen[ay * PICTURE_WIDTH + ax]! & 0x0f;
        sum[colour] = sum[colour]! + total / n;
        count[colour] = count[colour]! + 1;
      }
    }
  }

  return {
    pixels: [...count],
    luma: [...sum].map((one, colour) => (count[colour] ? one / count[colour]! : Number.NaN)),
  };
}

const measured = haveCaptures ? measureBrightness() : null;

test('the captures calibrate the way the recovery recorded', { skip: !haveCaptures }, () => {
  // That the measurement is reproducible at all: the same captures, the same
  // rooms, the same numbers. Everything below rests on this.
  assert.ok(measured);
  for (const { colour, pixels, luma: recorded } of BRIGHTNESS) {
    assert.equal(measured.pixels[colour], pixels, `colour ${colour}: pixel count`);
    if (recorded === null) continue;
    assert.ok(
      Math.abs(measured.luma[colour]! - recorded) < 0.01,
      `colour ${colour}: ${measured.luma[colour]} against the recorded ${recorded}`,
    );
  }
});

test("the captures' brightness is a straight line in the table's densities",
  { skip: !haveCaptures }, () => {
    // The check the captures can actually support. A table with a wrong density
    // in it would put that colour off the line; a table with the densities in
    // the wrong order would have no line at all.
    assert.ok(measured);
    const colours = [...Array(PALETTE_SIZE).keys()]
      .filter((colour) => measured.pixels[colour]! >= ENOUGH);
    const xs = colours.map((colour) => ditherDensity(HGC_DITHER, colour) / HGC_LEVELS);
    const ys = colours.map((colour) => measured.luma[colour]!);

    const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
    const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;
    const slope = xs.reduce((sum, x, i) => sum + (x - meanX) * (ys[i]! - meanY), 0)
      / xs.reduce((sum, x) => sum + (x - meanX) ** 2, 0);
    const intercept = meanY - slope * meanX;
    const residual = ys.reduce((sum, y, i) => sum + (y - (intercept + slope * xs[i]!)) ** 2, 0);
    const spread = ys.reduce((sum, y) => sum + (y - meanY) ** 2, 0);
    const r2 = 1 - residual / spread;

    assert.ok(Math.abs(intercept - FIT.intercept) < 0.05, `intercept ${intercept.toFixed(2)}`);
    assert.ok(Math.abs(slope - FIT.slope) < 0.05, `slope ${slope.toFixed(2)}`);
    assert.ok(Math.abs(r2 - FIT.r2) < 0.001, `R2 ${r2.toFixed(4)}`);
    assert.ok(r2 > 0.94, 'and it is a line');
  });

test('every colour the captures reach is as bright as the table says',
  { skip: !haveCaptures }, () => {
    // Colour by colour rather than in aggregate, so that one wrong row cannot
    // hide inside a good fit. White is the exception and is named: its 214
    // pixels are thin highlights whose footprints carry their outlines.
    assert.ok(measured);
    const predicted = (colour: number) =>
      FIT.intercept + FIT.slope * ditherDensity(HGC_DITHER, colour) / HGC_LEVELS;

    for (const { colour, pixels, luma: recorded } of BRIGHTNESS) {
      if (recorded === null || pixels < ENOUGH) continue;
      const off = Math.abs(recorded - predicted(colour));
      if (colour === 15) {
        assert.ok(off > 20, 'white is the one that misses, and it still does');
        continue;
      }
      assert.ok(off < 12, `colour ${colour}: ${recorded} against a predicted ${predicted(colour).toFixed(1)}`);
    }
  });

test('and they are in the table\'s order, brightest to darkest',
  { skip: !haveCaptures }, () => {
    // The weaker claim, and the one that survives any gamma: whatever the curve
    // between density and brightness, it is monotone.
    assert.ok(measured);
    const colours = [...Array(PALETTE_SIZE).keys()]
      .filter((colour) => measured.pixels[colour]! >= ENOUGH && colour !== 15)
      .sort((a, b) => ditherDensity(HGC_DITHER, a) - ditherDensity(HGC_DITHER, b));

    for (let i = 1; i < colours.length; i++) {
      const [before, after] = [colours[i - 1]!, colours[i]!];
      if (ditherDensity(HGC_DITHER, before) === ditherDensity(HGC_DITHER, after)) continue;
      assert.ok(
        measured.luma[after]! > measured.luma[before]!,
        `colour ${after} is denser than ${before} and came back brighter`,
      );
    }
  });

test('every picture in the game renders in two colours', async () => {
  const driver = new HerculesDriver();

  for (const id of resources.ids('pic')) {
    const screens = Screens.fromPicture(await resources.load('pic', id));
    driver.draw(new Frame().fill(0).picture(screens.visual, PICTURE_ROW));

    for (const pixel of driver.display.pixels) {
      assert.ok(pixel <= 1, `pic ${id} drew ${pixel}`);
    }
  }
});

// --- text -------------------------------------------------------------------

test('ink never lands on its own ground', () => {
  // With two colours a collision is the common case, not a hazard: eight of
  // the sixteen are lit and eight are not, so any two from the same half would
  // be invisible against each other.
  for (let ink = 0; ink < PALETTE_SIZE; ink++) {
    for (let ground = 0; ground < PALETTE_SIZE; ground++) {
      const [f, b] = herculesTextColours(ink, ground);
      assert.notEqual(f, b, `${ink} on ${ground}`);
    }
  }
});

test('the attribute pairs the bundled game sets are all legible', () => {
  // Brown on black is the one that needs the guarantee: both are unlit, and
  // logic 52 writes its captions in it.
  const PAIRS: [number, number][] = [
    [0, 15],
    [15, 0],
    [0, 7],
    [6, 0],
    [6, 7],
    [1, 7],
  ];

  for (const [ink, ground] of PAIRS) {
    const [f, b] = herculesTextColours(ink, ground);
    assert.notEqual(f, b, `${ink} on ${ground} is unreadable`);
  }
});

test('text is solid, not dithered', () => {
  // A glyph's stroke is a pixel or two of an 18-pixel cell, so a dithered
  // stroke is a stroke with holes in it.
  const driver = new HerculesDriver();
  driver.draw(new Frame().fill(7)); // light grey: a mid grey as a picture

  const solid = herculesSolid(7);
  assert.ok(
    driver.display.pixels.every((pixel) => pixel === solid),
    'a text background is one colour, not a grey',
  );
});

// --- the command line has nowhere to go -------------------------------------

/** A machine listening for a command, with nothing typed yet. */
function typing(mode: DisplayMode): { machine: Machine; cycle: Cycle } {
  const { machine, cycle } = bootWithCycle(mode);
  machine.statusLineVisible = true;
  machine.inputAccepted = true;
  machine.prompt.visible = true;
  machine.pending = null;
  machine.textLayer.clear();
  return { machine, cycle };
}

/** Narrowing helper, so the window layers can be counted without a cast. */
const isWindow = (layer: { kind: string }) => layer.kind === 'window';

/**
 * What the game is waiting for, read through a call.
 *
 * A test that asserts `machine.pending` is null and then presses a key would
 * otherwise have the property narrowed to `null` for the rest of the test:
 * TypeScript cannot see that `handleKey` sets it.
 */
const waitingOn = (machine: Machine) => machine.pending;

test('the box only appears once the player starts typing', () => {
  // Not whenever input is accepted, which is what a row on a colour display
  // does. This box covers the scene, and a box over a scene nobody is typing
  // into is a box in the way.
  const { machine, cycle } = typing('hercules');
  assert.equal(waitingOn(machine), null, 'nothing is up before a key is pressed');
  assert.equal(buildFrame(machine, 'visual').layers.filter(isWindow).length, 0);

  machine.handleKey(keyNamed('t'));
  assert.ok(waitingOn(machine) instanceof CommandLine, 'the first character opens it');
  assert.equal(cycle.runOnce(), false, 'and the game is parked while it is up');
});

test('the box is a title, a blank line and an inverse field, and carries no `]`', () => {
  // The shape photographs of the real thing show, for the command line and for
  // the game's own "How old are you?" alike.
  const { machine } = typing('hercules');
  for (const character of 'talk girl') machine.handleKey(keyNamed(character));

  const box = buildFrame(machine, 'visual').layers.filter(isWindow)[0];
  assert.ok(box?.kind === 'window');
  assert.equal(box.window.lines.length, 3, 'a title, a blank line and a field');
  assert.match(box.window.lines[0]!, /ENTER COMMAND/);
  assert.equal(box.window.lines[1]!.trim(), '', 'the blank line keeps the two apart');
  assert.match(box.window.lines[2]!, /^talk girl_/);

  // Half way down AGI's 25-row grid, which on Hercules' 29 rows puts the title
  // on row 12 and the field on 14 -- where the photograph has them.
  assert.equal(box.window.row, 12);

  // The `]` is what AGI keeps in string 0 and this game writes there, and it
  // belongs to the input row. The box announces itself with its title instead.
  assert.equal(machine.state.getString(0), ']', 'the game did set a marker');
  assert.ok(!box.window.lines[2]!.includes(']'), 'and the field does not use it');

  // And the field again over the window's third line, ink and ground swapped,
  // which on two colours is the only way to show that it is a field.
  const inverse = buildFrame(machine, 'visual').layers.find(
    (layer) => layer.kind === 'text' && layer.row === box.window.row + 2,
  );
  assert.ok(inverse?.kind === 'text');
  assert.equal(inverse.foreground, box.window.background);
  assert.equal(inverse.background, box.window.foreground);
});

test("the game's own questions take the same shape on a mono display", () => {
  // Logic 0 asks the player's age with `get.num`, and a photograph of the real
  // thing shows it in the command line's box: the question on one line, a
  // blank line, then the answer in an inverse field.
  const { machine } = typing('hercules');
  const question = new NumberQuestion('How old are you?', 200);
  question.key(machine, keyNamed('2'));

  const frame = new Frame();
  question.draw(frame, machine);

  const box = frame.layers.filter(isWindow)[0];
  assert.ok(box?.kind === 'window');
  assert.equal(box.window.lines.length, 3);
  assert.match(box.window.lines[0]!, /How old are you\?/);
  assert.equal(box.window.lines[1]!.trim(), '');
  assert.match(box.window.lines[2]!, /^2_/);
  assert.equal(box.window.row, 12, 'and in the same place as the command line');
});

test('on a colour display a question is one line, prompt and answer together', () => {
  // Unchanged, and it has to be: this is what AGI does on every adapter with a
  // row to spare, and the golden tests hold it still.
  const { machine } = typing('ega');
  const question = new NumberQuestion('How old are you?', 200);
  question.key(machine, keyNamed('2'));

  const frame = new Frame();
  question.draw(frame, machine);

  const box = frame.layers.filter(isWindow)[0];
  assert.ok(box?.kind === 'window');
  assert.equal(box.window.lines.length, 1, 'one line, wrapped from the message');
  assert.match(box.window.lines[0]!, /How old are you\? *2_/);
});

test('Enter hands the line over and lets the game run again', () => {
  const { machine, cycle } = typing('hercules');
  for (const character of 'look') machine.handleKey(keyNamed(character));

  machine.handleKey(keyNamed('Enter'));

  assert.equal(machine.pending, null, 'the box is gone');
  assert.equal(machine.lastLine, 'look', 'and the scripts have the line');
  assert.equal(machine.state.getFlag(FLAG.PLAYER_COMMAND_ENTERED), true);
  assert.notEqual(cycle.runOnce(), false, 'the game is running again');
});

test('Escape abandons the line, and so does backspacing it away', () => {
  const escaped = typing('hercules').machine;
  for (const character of 'look') escaped.handleKey(keyNamed(character));
  escaped.handleKey(keyNamed('Escape'));

  assert.equal(escaped.pending, null);
  assert.equal(escaped.lastLine, '', 'nothing was submitted');

  // The box opened on a keystroke, so un-typing that keystroke closes it
  // rather than leaving the player shut in.
  const emptied = typing('hercules').machine;
  emptied.handleKey(keyNamed('x'));
  assert.ok(waitingOn(emptied) instanceof CommandLine);

  emptied.handleKey(keyNamed('Backspace'));
  assert.equal(emptied.pending, null, 'emptied, it goes');
  assert.equal(emptied.lastLine, '');
});

test('an arrow key still walks ego rather than opening the box', () => {
  const { machine } = typing('hercules');
  machine.handleKey(keyNamed('ArrowLeft'));
  assert.equal(machine.pending, null);
});

test('on a colour display the command line is still a row', () => {
  const { machine } = typing('ega');
  machine.handleKey(keyNamed('t'));

  assert.equal(machine.pending, null, 'nothing parks the game');
  const frame = buildFrame(machine, 'visual');
  assert.equal(frame.layers.filter(isWindow).length, 0);
  assert.ok(
    frame.layers.some((layer) => layer.kind === 'text' && layer.row === machine.layout.inputRow),
    'the row is drawn, marker and all',
  );
});

test('toggle.monitor moves the command line, and moves it back', () => {
  // The game offers Ctrl-R on a CGA screen. Telling the scripts the display is
  // mono is what turns the command line into a box, so the engine's own
  // furniture follows the same fact the scripts read -- which is why this is
  // keyed on the monitor variable and not on which driver is running.
  const { machine } = typing('cga');

  machine.handleKey(keyNamed('t'));
  assert.equal(waitingOn(machine), null, 'a colour display types on its row');

  machine.toggleMonitor();
  assert.equal(machine.state.getVar(VAR.MONITOR_TYPE), MONITOR.MONO);
  machine.handleKey(keyNamed('t'));
  assert.ok(waitingOn(machine) instanceof CommandLine, 'told it is mono, it opens a box');

  machine.dismissPending();
  machine.toggleMonitor();
  machine.handleKey(keyNamed('t'));
  assert.equal(waitingOn(machine), null, 'and back');
});

// --- and it leaves the mode that is known to be right alone -----------------

test('Hercules is the driver for the mode, and EGA is untouched', async () => {
  assert.equal(createDriver('hercules').mode, 'hercules');

  const id = resources.ids('pic')[0]!;
  const screens = Screens.fromPicture(await resources.load('pic', id));
  const frame = new Frame().fill(0).picture(screens.visual, PICTURE_ROW);

  const ega = new EgaDriver();
  ega.draw(frame);
  const before = ega.display.pixels.slice();

  new HerculesDriver().draw(frame);
  ega.draw(frame);

  assert.deepEqual(ega.display.pixels, before);
  assert.equal(ega.display.width, 320, 'and is still 320x200');
  assert.equal(ega.display.height, 200);
});
