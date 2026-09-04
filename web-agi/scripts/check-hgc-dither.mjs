/**
 * The Hercules dither table, dumped from the interpreter's own data and checked
 * against captures of the game running on a Hercules.
 *
 * There is nothing to recover any more. The table is 128 bytes at offset
 * `0x1bea` of `AGIDATA.OVL`, indexed by the blit in `HGC_GRAF.OVL` as
 * `colour * 8 + (row and 3) * 2`, and `render/hgcdither.ts` records how that
 * arithmetic was read off the driver's code. What is left is to check it, and
 * to keep the check honest about how it reads a capture.
 *
 * ## Why the check measures brightness and not bits
 *
 * Because thresholding a capture destroys the thing being measured. Half of
 * this table's patterns alternate on a one-pixel pitch -- light grey is
 * `55 aa 55 aa`, a checkerboard -- and a capture smooths those into a flat
 * half-tone before it is ever saved. Threshold that and light grey comes back
 * as solid amber, cyan as solid black, and the conclusion is that the original
 * hardly dithered at all. This project reached exactly that conclusion once.
 *
 * The mean luminance of a colour's regions does survive. So the check fits
 * `luma = a + b x density` over the colours the captures cover, and asks for a
 * straight line: an R^2 near one, with the residual curving the way a display
 * gamma curves rather than jumping about.
 *
 * ```text
 * cyan        16/64   mean luma  37.4      predicted  40.0
 * light grey  32/64              80.4                 74.3
 * light cyan  56/64             135.4                125.7
 * ```
 *
 * Only AGI pixels whose four neighbours share their colour count, and the
 * footprint sampled is the inner part of each AGI pixel, because an edge in a
 * smoothed upscale carries its neighbour's light.
 *
 * ## What it composes to compare against
 *
 * Not a PICTURE resource: the screen the *room* composes. A room draws over its
 * picture -- `add.to.pic` plants objects, scripts overdraw -- and those pixels
 * are not the colour the PICTURE holds underneath them. Which room a capture
 * shows is searched rather than assumed.
 *
 * Usage:
 *   node scripts/check-hgc-dither.mjs [--table] [--fixture]
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodePng, luma, otsu, calibrate, STATUS_ROWS } from './rectify-screenshot.mjs';
// The script reaches into the engine to compose a room, and into the tests for
// the one thing that reads the bundled game off disk rather than over HTTP.
import { buildHandlers } from '../src/engine/commands/index.ts';
import { Cycle } from '../src/engine/cycle.ts';
import { Machine } from '../src/engine/machine.ts';
import { buildFrame } from '../src/engine/present.ts';
import { enterRoom } from '../src/engine/room.ts';
import {
  decodeHgcDither,
  ditherDensity,
  HGC_CELL_HEIGHT,
  HGC_DITHER,
  HGC_DITHER_OFFSET,
  HGC_LEVELS,
} from '../src/render/hgcdither.ts';
import { PICTURE_HEIGHT, PICTURE_WIDTH } from '../src/render/screens.ts';
import { ResourceManager } from '../src/resources/manager.ts';
import { parseObjectFile } from '../src/resources/objects.ts';
import { Vocabulary } from '../src/resources/words.ts';
import { DiskSource, GAME_DIR } from '../test/helpers/disk-source.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const CAPTURES = resolve(HERE, '..', 'screenshots-from-original');

const COLOURS = 16;
const NAMES = ['black', 'blue', 'green', 'cyan', 'red', 'magenta', 'brown', 'light grey',
  'dark grey', 'light blue', 'light green', 'light cyan', 'light red', 'light magenta',
  'yellow', 'white'];

/** How many rooms to try, and how far into each. */
const ROOMS = 70;
const CYCLES = [20, 60];

/** How many AGI pixels a colour needs before the fit will use it. */
const ENOUGH = 50;

const flags = process.argv.slice(2);

const source = await DiskSource.open();
const resources = await ResourceManager.open(source);
await resources.preload();
const objects = parseObjectFile(await source.read('OBJECT'));
const vocabulary = Vocabulary.parse(await source.read('WORDS.TOK'));

// The engine's own seed, fixed, so a room composes the same way twice.
let seed = 0x2f6e2b1;
Math.random = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x80000000;
};

/** The table, from the bundled interpreter data if it is there. */
const bundled = await source.read('AGIDATA.OVL');
const table = bundled ? decodeHgcDither(bundled) : HGC_DITHER;

console.log(bundled
  ? `AGIDATA.OVL is bundled: reading the table at 0x${HGC_DITHER_OFFSET.toString(16)}`
  : 'AGIDATA.OVL is not bundled: using the table shipped in hgcdither.ts');

const shipped = HGC_DITHER.every((rows, colour) =>
  rows.every((row, y) => row === table[colour][y]));
console.log(`the shipped constant ${shipped ? 'matches' : 'DIFFERS FROM'} that table`);

if (flags.includes('--table')) {
  console.log('\ncolour            bytes                     density   cell');
  for (let colour = 0; colour < COLOURS; colour++) {
    const rows = table[colour];
    const bytes = rows.map((row) => row.toString(16).padStart(2, '0')).join(' ');
    const density = ditherDensity(table, colour);
    console.log(`${String(colour).padStart(2)} ${NAMES[colour].padEnd(14)} ${bytes}  `
      + `${String(density).padStart(2)}/${HGC_LEVELS}`);
    for (const row of rows) {
      console.log(`   ${row.toString(2).padStart(HGC_CELL_HEIGHT, '0').replace(/0/g, '.').replace(/1/g, '#')}`);
    }
  }
}

/**
 * The screen a room composes, in AGI colours.
 *
 * Booted, run past its opening, dropped into the room, run again so the room's
 * script can draw. What comes back is picture plus everything the room added.
 */
function compose(room, cycles) {
  seed = 0x2f6e2b1;
  const machine = new Machine({ resources, objects, vocabulary });
  machine.setHandlers(buildHandlers());
  machine.setDisplayMode('hercules');

  const cycle = new Cycle(machine);
  cycle.start(0);
  for (let i = 0; i < 40; i++) if (!cycle.runOnce()) break;
  try {
    enterRoom(machine, room);
  } catch {
    // enterRoom unwinds the cycle it interrupts, which is how rooms change.
  }
  for (let i = 0; i < cycles; i++) if (!cycle.runOnce()) break;

  const picture = buildFrame(machine).layers.find((layer) => layer.kind === 'picture');
  return picture ? picture.screen : null;
}

/** The AGI pixels whose four neighbours share their colour. */
function interiors(screen) {
  const keep = new Uint8Array(PICTURE_WIDTH * PICTURE_HEIGHT);
  for (let y = 1; y < PICTURE_HEIGHT - 1; y++) {
    for (let x = 1; x < PICTURE_WIDTH - 1; x++) {
      const at = y * PICTURE_WIDTH + x;
      const colour = screen[at] & 0x0f;
      keep[at] = colour === (screen[at - 1] & 0x0f) && colour === (screen[at + 1] & 0x0f)
        && colour === (screen[at - PICTURE_WIDTH] & 0x0f)
        && colour === (screen[at + PICTURE_WIDTH] & 0x0f) ? 1 : 0;
    }
  }
  return keep;
}

/**
 * The mean luminance of every AGI pixel, from the capture.
 *
 * The inner part of each AGI pixel's footprint, so that a pixel beside a lit
 * neighbour is not counted as brighter than it is.
 */
function brightness(image, values, geometry) {
  const out = new Float64Array(PICTURE_WIDTH * PICTURE_HEIGHT).fill(NaN);
  const { originX, originY, scale } = geometry;

  for (let ay = 0; ay < PICTURE_HEIGHT; ay++) {
    const top = originY + (STATUS_ROWS + ay * 2) * scale;
    for (let ax = 0; ax < PICTURE_WIDTH; ax++) {
      const left = originX + ax * 4 * scale;
      let sum = 0;
      let count = 0;
      for (let py = Math.ceil(top + 1); py < top + 2 * scale - 1; py++) {
        if (py < 0 || py >= image.height) continue;
        for (let px = Math.ceil(left + 1); px < left + 4 * scale - 1; px++) {
          if (px < 0 || px >= image.width) continue;
          sum += values[py * image.width + px];
          count++;
        }
      }
      if (count) out[ay * PICTURE_WIDTH + ax] = sum / count;
    }
  }
  return out;
}

/**
 * Which room a capture shows.
 *
 * How much of the variation in an AGI pixel's brightness the room's colours
 * account for: the within-colour scatter against the whole. The right room
 * stands clear of every other by a wide margin.
 */
function identify(bright, screens) {
  const ranked = [];
  for (const { room, cycles, screen } of screens) {
    const sum = new Float64Array(COLOURS);
    const squares = new Float64Array(COLOURS);
    const count = new Float64Array(COLOURS);
    const keep = interiors(screen);

    for (let at = 0; at < bright.length; at++) {
      if (!keep[at] || Number.isNaN(bright[at])) continue;
      const colour = screen[at] & 0x0f;
      sum[colour] += bright[at];
      squares[colour] += bright[at] ** 2;
      count[colour]++;
    }

    let within = 0;
    let all = 0;
    let allSquares = 0;
    let n = 0;
    for (let colour = 0; colour < COLOURS; colour++) {
      if (!count[colour]) continue;
      within += squares[colour] - sum[colour] ** 2 / count[colour];
      all += sum[colour];
      allSquares += squares[colour];
      n += count[colour];
    }
    const total = allSquares - all ** 2 / n;
    ranked.push({ room, cycles, explained: total ? 1 - within / total : 0 });
  }
  ranked.sort((a, b) => b.explained - a.explained);
  return ranked;
}

if (!existsSync(CAPTURES)) {
  console.log(`\nno captures at ${CAPTURES}: nothing to check the table against`);
  process.exit(0);
}

process.stdout.write(`\ncomposing ${ROOMS} rooms at ${CYCLES.join(' and ')} cycles`);
const screens = [];
for (let room = 1; room <= ROOMS; room++) {
  for (const cycles of CYCLES) {
    let screen;
    try {
      screen = compose(room, cycles);
    } catch {
      continue;
    }
    if (screen) screens.push({ room, cycles, screen });
  }
  if (room % 10 === 0) process.stdout.write('.');
}
console.log(` ${screens.length} screens`);

const pooled = Array.from({ length: COLOURS }, () => ({ sum: 0, count: 0 }));
const used = [];

for (const name of readdirSync(CAPTURES).filter((file) => file.endsWith('.png')).sort()) {
  const file = join(CAPTURES, name);
  const image = decodePng(readFileSync(file));
  const values = luma(image);

  let geometry;
  try {
    geometry = calibrate(image, values, otsu(values));
  } catch (error) {
    console.log(`\n${name}: ${error.message}`);
    continue;
  }

  const bright = brightness(image, values, geometry);
  const ranked = identify(bright, screens);
  const best = ranked[0];
  const runnerUp = ranked.find((one) => one.room !== best.room);

  console.log(`\n${name}`);
  console.log(`  scene at (${geometry.originX}, ${geometry.originY.toFixed(1)}) at `
    + `${geometry.scale.toFixed(3)}x, status band ${geometry.statusLitRows.toFixed(2)} rows`);
  console.log(`  room ${best.room} after ${best.cycles} cycles, explaining `
    + `${(best.explained * 100).toFixed(1)}% of the brightness; `
    + `next room ${runnerUp.room} at ${(runnerUp.explained * 100).toFixed(1)}%`);

  // A capture counts only if its room is identified beyond doubt. The title
  // screen behind the age quiz is not a room's composed picture at all.
  if (!(best.explained > 0.8 && best.explained > 1.5 * runnerUp.explained)) {
    console.log('  not used: the room is not identified');
    continue;
  }
  console.log('  used');

  const screen = screens.find((one) => one.room === best.room && one.cycles === best.cycles).screen;
  const keep = interiors(screen);
  for (let at = 0; at < bright.length; at++) {
    if (!keep[at] || Number.isNaN(bright[at])) continue;
    const colour = screen[at] & 0x0f;
    pooled[colour].sum += bright[at];
    pooled[colour].count++;
  }
  used.push({ name, room: best.room, cycles: best.cycles, geometry });
}

// luma = a + b x density, over the colours with enough evidence.
const rows = [...pooled.keys()].filter((colour) => pooled[colour].count >= ENOUGH);
const xs = rows.map((colour) => ditherDensity(table, colour) / HGC_LEVELS);
const ys = rows.map((colour) => pooled[colour].sum / pooled[colour].count);
const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;
const slope = xs.reduce((sum, x, i) => sum + (x - meanX) * (ys[i] - meanY), 0)
  / xs.reduce((sum, x) => sum + (x - meanX) ** 2, 0);
const intercept = meanY - slope * meanX;
const residual = ys.reduce((sum, y, i) => sum + (y - (intercept + slope * xs[i])) ** 2, 0);
const spread = ys.reduce((sum, y) => sum + (y - meanY) ** 2, 0);
const r2 = 1 - residual / spread;

console.log(`\nluma = ${intercept.toFixed(1)} + ${slope.toFixed(1)} x density,  R2 = ${r2.toFixed(4)}`);
console.log('\ncolour            AGI px   density   mean luma   predicted');
for (const colour of rows) {
  const density = ditherDensity(table, colour);
  const mean = pooled[colour].sum / pooled[colour].count;
  console.log(`${String(colour).padStart(2)} ${NAMES[colour].padEnd(14)} `
    + `${String(pooled[colour].count).padStart(6)}   ${String(density).padStart(2)}/64   `
    + `${mean.toFixed(1).padStart(7)}   ${(intercept + slope * density / HGC_LEVELS).toFixed(1).padStart(7)}`);
}
for (const colour of [...pooled.keys()].filter((c) => pooled[c].count > 0 && pooled[c].count < ENOUGH)) {
  console.log(`${String(colour).padStart(2)} ${NAMES[colour].padEnd(14)} `
    + `${String(pooled[colour].count).padStart(6)}   too few`);
}

if (flags.includes('--fixture')) {
  console.log('\nfixture -- the brightness of each colour:');
  for (let colour = 0; colour < COLOURS; colour++) {
    const { sum, count } = pooled[colour];
    console.log(`  { colour: ${colour}, pixels: ${count}, `
      + `luma: ${count ? (sum / count).toFixed(2) : 'null'} },`);
  }
  console.log('\nfixture -- the captures:');
  for (const one of used) {
    const { originX, originY, scale } = one.geometry;
    console.log(`  {
    file: '${one.name}',
    room: ${one.room},
    cycles: ${one.cycles},
    geometry: { originX: ${originX}, originY: ${originY.toFixed(6)}, scale: ${scale.toFixed(6)} },
  },`);
  }
  console.log(`\nfixture -- the fit: intercept ${intercept.toFixed(2)}, `
    + `slope ${slope.toFixed(2)}, r2 ${r2.toFixed(4)}`);
}
