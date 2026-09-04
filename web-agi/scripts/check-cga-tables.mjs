/**
 * The CGA tables, dumped from the interpreter's own data with the argument for
 * how they are read.
 *
 * `src/render/cgatables.ts` records what `CGA_GRAF.OVL` does with them. This
 * prints them, decodes each under both readings, and prints the checks that
 * settle which is which -- so the assignment is an argument on screen rather
 * than a paragraph in a comment.
 *
 * There is no capture of this game on a CGA in `screenshots-from-original/`, so
 * unlike Hercules there is nothing to hold the result against. That is exactly
 * why the tables being *read* matters more here: the only check available is
 * that the reading is self-consistent, and the last section is that check.
 *
 * Usage:
 *   node scripts/check-cga-tables.mjs
 */
import {
  CGA_TABLES,
  CGA_TABLES_AT,
  CGA_TABLE_ENTRIES,
  colourPixels,
  decodeCgaTables,
  monoDensity,
} from '../src/render/cgatables.ts';
import { CGA_PALETTE_RGB } from '../src/render/drivers/cga.ts';
import { DiskSource } from '../test/helpers/disk-source.ts';

const NAMES = ['black', 'blue', 'green', 'cyan', 'red', 'magenta', 'brown', 'light grey',
  'dark grey', 'light blue', 'light green', 'light cyan', 'light red', 'light magenta',
  'yellow', 'white'];

/** AGI's own sixteen, for the semantic check. */
const AGI_RGB = [
  [0, 0, 0], [0, 0, 170], [0, 170, 0], [0, 170, 170],
  [170, 0, 0], [170, 0, 170], [170, 85, 0], [170, 170, 170],
  [85, 85, 85], [85, 85, 255], [85, 255, 85], [85, 255, 255],
  [255, 85, 85], [255, 85, 255], [255, 255, 85], [255, 255, 255],
];

const source = await DiskSource.open();
const bytes = await source.read('AGIDATA.OVL');

const tables = bytes ? decodeCgaTables(bytes) : CGA_TABLES;
console.log(bytes
  ? `AGIDATA.OVL is bundled: reading the tables at `
    + Object.entries(CGA_TABLES_AT).map(([name, at]) => `${name} 0x${at.toString(16)}`).join(', ')
  : 'AGIDATA.OVL is not bundled: using the tables shipped in cgatables.ts');

const same = (a, b) => a.every((one, i) => one === b[i]);
const shipped = same(tables.colour, CGA_TABLES.colour)
  && same(tables.mono, CGA_TABLES.mono)
  && same(tables.monoFill, CGA_TABLES.monoFill)
  && tables.fill.every(([a, b], i) => a === CGA_TABLES.fill[i][0] && b === CGA_TABLES.fill[i][1]);
console.log(`the shipped constants ${shipped ? 'match' : 'DIFFER FROM'} those tables`);

const cga = (index) => [...CGA_PALETTE_RGB.subarray(index * 3, index * 3 + 3)];
const blend = (pixels) => [0, 1, 2].map((channel) =>
  Math.round(pixels.reduce((sum, index) => sum + cga(index)[channel], 0) / pixels.length));
const distance = (a, b) => Math.round(Math.hypot(
  (a[0] - b[0]) * 0.9, (a[1] - b[1]) * 1.2, (a[2] - b[2]) * 0.7));

console.log('\n--- the four-colour picture, 0x1bb8 -------------------------------------');
console.log('colour            nibble  pixels  blends to        AGI wants        off by');
for (let colour = 0; colour < CGA_TABLE_ENTRIES; colour++) {
  const nibble = tables.colour[colour];
  const pixels = colourPixels(nibble);
  const got = blend(pixels);
  const want = AGI_RGB[colour];
  console.log(`${String(colour).padStart(2)} ${NAMES[colour].padEnd(14)}   0x${nibble.toString(16)}    `
    + `${pixels.join(',')}     ${got.join(',').padEnd(15)}  ${want.join(',').padEnd(15)}  `
    + `${String(distance(got, want)).padStart(4)}`);
}

console.log('\n--- the two-colour picture, 0x1ba8 --------------------------------------');
console.log('colour            nibble  pixels  density   AGI luminance');
const luma = (rgb) => Math.round(0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]);
for (let colour = 0; colour < CGA_TABLE_ENTRIES; colour++) {
  const nibble = tables.mono[colour];
  const drawn = nibble.toString(2).padStart(4, '0').replace(/0/g, '.').replace(/1/g, '#');
  console.log(`${String(colour).padStart(2)} ${NAMES[colour].padEnd(14)}   0x${nibble.toString(16)}    `
    + `${drawn}    ${monoDensity(nibble)}/4      ${String(luma(AGI_RGB[colour])).padStart(3)}`);
}

console.log('\n--- the checks ----------------------------------------------------------');

// 1. The two-colour table is a permutation: sixteen colours, sixteen patterns.
const monoSet = new Set(tables.mono);
console.log(`the two-colour table uses ${monoSet.size} of the 16 nibble values `
  + `${monoSet.size === 16 ? '-- a permutation, which only a 1-bit dither can be' : ''}`);

// 2. Its densities rank the colours the way luminance does.
const byDensity = [...tables.mono.keys()].sort((a, b) =>
  monoDensity(tables.mono[a]) - monoDensity(tables.mono[b]));
const byLuma = [...tables.mono.keys()].sort((a, b) => luma(AGI_RGB[a]) - luma(AGI_RGB[b]));
let inversions = 0;
for (let i = 0; i < byDensity.length; i++) {
  for (let j = i + 1; j < byDensity.length; j++) {
    const [a, b] = [byDensity[i], byDensity[j]];
    if (luma(AGI_RGB[a]) > luma(AGI_RGB[b])) inversions++;
  }
}
console.log(`its densities invert luminance ${inversions} times out of 120 pairs`);
console.log(`  darkest first by density: ${byDensity.join(' ')}`);
console.log(`  darkest first by luma:    ${byLuma.join(' ')}`);

// 3. The semantic check that assigns the tables to the modes.
const errorOf = (table) => [...table.keys()]
  .reduce((sum, colour) => sum + distance(blend(colourPixels(table[colour])), AGI_RGB[colour]), 0);
const exactOf = (table) => [...table.keys()]
  .filter((colour) => distance(blend(colourPixels(table[colour])), AGI_RGB[colour]) === 0);

console.log(`\nread as four-colour pairs, 0x1bb8 is off by ${errorOf(tables.colour)} in total`);
console.log(`                           0x1ba8 is off by ${errorOf(tables.mono)}`);
console.log(`  exactly right: 0x1bb8 gets ${exactOf(tables.colour).map((c) => NAMES[c]).join(', ') || 'none'}`);
console.log(`                 0x1ba8 gets ${exactOf(tables.mono).map((c) => NAMES[c]).join(', ') || 'none'}`);
console.log('  -- and that is the argument, rather than the totals: only one of the');
console.log('     two puts a colour on the CGA colour that *is* it. Read as pairs,');
console.log(`     0x1ba8 draws red as CGA ${colourPixels(tables.mono[4]).join(' and ')}, which is`);
console.log('     green beside the background.');

// 4. The tie between the fill table and the two-colour picture table.
const tied = tables.monoFill.every((one, colour) => one === tables.mono[colour]);
console.log(`\nthe fill table's first column ${tied ? 'equals' : 'DIFFERS FROM'} the two-colour picture table`);
console.log('  -- 48 bytes apart in the file, with no reason to agree unless both');
console.log('     have been read right');

console.log('\n--- what fills do that pictures do not ----------------------------------');
console.log('colour            picture   fill (two AGI pixels)');
let richer = 0;
for (let colour = 0; colour < CGA_TABLE_ENTRIES; colour++) {
  const [left, right] = tables.fill[colour];
  const alternates = left !== right;
  if (alternates) richer++;
  console.log(`${String(colour).padStart(2)} ${NAMES[colour].padEnd(14)}   `
    + `${colourPixels(tables.colour[colour]).join(',')}       `
    + `${colourPixels(left).join(',')} then ${colourPixels(right).join(',')}`
    + `${alternates ? '   alternating' : ''}`);
}
console.log(`\n${richer} of the sixteen fill with two different patterns, where the picture`);
console.log('uses one. Distinct appearances: '
  + `${new Set(tables.colour).size} drawing, `
  + `${new Set(tables.fill.map(([a, b]) => `${Math.min(a, b)},${Math.max(a, b)}`)).size} filling.`);
