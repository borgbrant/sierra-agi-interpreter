/**
 * CGA: four colours, and the sixteen the game draws in reached by dithering.
 *
 * The plan warned that this milestone carries a risk no test can carry for it:
 * a palette that is merely wrong-looking passes every assertion a test can
 * make. So these tests do not try to say the mapping is *right*. They say what
 * it is, what it costs, and that the costs are the ones recorded beside it --
 * measured against the game's own pictures, so a change to the table has to be
 * justified rather than merely typed.
 *
 * The judgement that a test cannot make was made by rendering the game's own
 * pictures in each candidate mapping and looking at them; `cga.ts` records what
 * that showed and what it changed.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EGA_PALETTE } from 'agi-extract/pic';

import { DEFAULT_PICTURE_ROW } from '../src/engine/layout.ts';
import { PALETTE_SIZE } from '../src/render/display.ts';
import {
  CGA_COLLISIONS,
  CGA_COST,
  CGA_DITHER,
  CGA_FILL,
  CGA_PALETTE_RGB,
  CGA_SOLID,
  CgaDriver,
  cgaTextColours,
} from '../src/render/drivers/cga.ts';
import {
  CGA_MONO_HEIGHT,
  CGA_MONO_PALETTE_RGB,
  CGA_MONO_WIDTH,
  cgaMonoSolid,
  cgaMonoTextColours,
  CgaMonoDriver,
} from '../src/render/drivers/cgamono.ts';
import { createDriver, hasMonoVariant } from '../src/render/drivers/index.ts';
import { EgaDriver } from '../src/render/drivers/ega.ts';
import { Frame } from '../src/render/frame.ts';
import {
  CGA_MONO_PIXELS,
  CGA_TABLES,
  CGA_TABLES_AT,
  decodeCgaTables,
  monoDensity,
} from '../src/render/cgatables.ts';
import { Renderer } from '../src/render/renderer.ts';
import { PICTURE_HEIGHT, PICTURE_WIDTH, Screens } from '../src/render/screens.ts';
import { layOutWindow, TextLayer } from '../src/render/text.ts';
import { ResourceManager } from '../src/resources/manager.ts';
import { DiskSource } from './helpers/disk-source.ts';

const source = await DiskSource.open();
const manager = await ResourceManager.open(source);

/** How many CGA colours there are: four, and every table has to agree. */
const CGA_COLOURS = CGA_PALETTE_RGB.length / 3;

// --- the tables ------------------------------------------------------------

test('four colours, and every table covers all sixteen', () => {
  assert.equal(CGA_COLOURS, 4);
  assert.equal(CGA_DITHER.length, PALETTE_SIZE);
  assert.equal(CGA_SOLID.length, PALETTE_SIZE);

  for (const [colour, patterns] of CGA_DITHER.entries()) {
    assert.equal(patterns.length, 2, `colour ${colour} has a pattern for each row`);
    for (const pair of patterns) {
      assert.equal(pair.length, 2, `colour ${colour}`);
      for (const index of pair) {
        assert.ok(index >= 0 && index < CGA_COLOURS, `colour ${colour} uses CGA ${index}`);
      }
    }
  }

  // The order is the original's and it is not sorted. Green is 1,1 on even rows
  // and 1,0 on odd ones; cyan is the background on even rows and 0,1 on odd.
  assert.deepEqual(CGA_DITHER[2], [[1, 1], [1, 0]]);
  assert.deepEqual(CGA_DITHER[3], [[0, 0], [0, 1]]);

  for (const index of CGA_SOLID) assert.ok(index >= 0 && index < CGA_COLOURS);
});

test('sixteen colours reach fifteen appearances, of the sixteen there are', () => {
  // An appearance is a *pair* of patterns now, not one, which is why fifteen of
  // the sixteen colours are distinguishable where the one-pattern reading
  // managed twelve.
  const used = new Set(CGA_DITHER.map((patterns) => JSON.stringify(patterns)));
  assert.equal(used.size, CGA_COST.appearances);
  assert.equal(used.size, 15, 'only black and blue share one');
});

test('a fill and a picture are the same table, drawn the same way', () => {
  // They were once believed to be two tables. M20 measured the running
  // interpreter and found one: the three-byte entry holds a row phase, not a
  // separate fill pattern.
  assert.equal(CGA_FILL, CGA_DITHER);
});

test('the four colours are the palette the original selected', () => {
  // Palette 0 at low intensity, with the background register set to colour 1 --
  // so the darkest thing on a CGA screen is blue and nothing is ever black.
  assert.deepEqual([...CGA_PALETTE_RGB], [
    0, 0, 170,
    0, 170, 0,
    170, 0, 0,
    170, 85, 0,
  ]);
});

test('ink never lands on its own ground', () => {
  // Every pair the bundled game sets survives the solid table on its own; this
  // is the guarantee for the game that is not this one.
  for (let ink = 0; ink < PALETTE_SIZE; ink++) {
    for (let ground = 0; ground < PALETTE_SIZE; ground++) {
      if (ink === ground) continue;
      const [f, b] = cgaTextColours(ink, ground);
      assert.notEqual(f, b, `${ink} on ${ground}`);
    }
  }

  // Cyan on light cyan is the case that needs the fallback: both are the same
  // solid, so the ink is pushed to whatever stands out against the ground.
  const [f, b] = cgaTextColours(3, 11);
  assert.equal(CGA_SOLID[3], CGA_SOLID[11], 'these two really do collide');
  assert.notEqual(f, b, 'and the ink moved rather than vanishing');
});

test('the attribute pairs the bundled game sets are all legible', () => {
  // Measured from its bytecode: 21 `set.text.attribute` calls, six distinct
  // pairs. Black on white and white on black are the status line and the input
  // line; brown on black is what logic 52 writes its captions in.
  const PAIRS: [number, number][] = [
    [0, 15],
    [15, 0],
    [0, 7],
    [6, 0],
    [6, 7],
    [1, 7],
  ];

  for (const [ink, ground] of PAIRS) {
    const [f, b] = cgaTextColours(ink, ground);
    assert.notEqual(f, b, `${ink} on ${ground} is unreadable`);
  }
});

// --- what it costs, from the game's own pictures ----------------------------

/**
 * Every picture in the game, counted: how many pixels of each colour, and how
 * often each pair of colours meets.
 *
 * The same measurement the table was derived against. Recomputed here rather
 * than recorded, so the numbers in `cga.ts` are checked against the game
 * instead of being a comment nobody can falsify.
 */
const measured = await (async () => {
  const pixels = new Array(PALETTE_SIZE).fill(0);
  const adjacent = Array.from({ length: PALETTE_SIZE }, () => new Array(PALETTE_SIZE).fill(0));
  let pictures = 0;

  for (const id of manager.ids('pic')) {
    const visual = Screens.fromPicture(await manager.load('pic', id)).visual;
    pictures++;

    for (let y = 0; y < PICTURE_HEIGHT; y++) {
      for (let x = 0; x < PICTURE_WIDTH; x++) {
        const colour = visual[y * PICTURE_WIDTH + x]!;
        pixels[colour]++;

        if (x + 1 < PICTURE_WIDTH) {
          const right = visual[y * PICTURE_WIDTH + x + 1]!;
          if (right !== colour) adjacent[colour]![right]++, adjacent[right]![colour]++;
        }
        if (y + 1 < PICTURE_HEIGHT) {
          const below = visual[(y + 1) * PICTURE_WIDTH + x]!;
          if (below !== colour) adjacent[colour]![below]++, adjacent[below]![colour]++;
        }
      }
    }
  }

  return { pictures, pixels, adjacent };
})();

test('the game draws every colour, so none is free to collide', () => {
  // The reason there is no cheap collision to find: with all sixteen in use,
  // every group in CGA_COLLISIONS costs something.
  assert.ok(measured.pictures > 40, `${measured.pictures} pictures`);
  for (const [colour, count] of measured.pixels.entries()) {
    assert.ok(count > 0, `colour ${colour} is never drawn`);
  }
});

test('the recorded collisions are the collisions the table has', () => {
  const groups = new Map<string, number[]>();
  CGA_DITHER.forEach((patterns, colour) => {
    const key = JSON.stringify(patterns);
    groups.set(key, [...(groups.get(key) ?? []), colour]);
  });

  const actual = [...groups.values()]
    .filter((colours) => colours.length > 1)
    .map((colours) => colours.join(','))
    .sort();
  const recorded = CGA_COLLISIONS.map((group) => group.colours.join(',')).sort();

  assert.deepEqual(actual, recorded);
});

test('each collision costs what it is recorded as costing', () => {
  let total = 0;

  for (const { colours, lostEdges } of CGA_COLLISIONS) {
    let edges = 0;
    for (let i = 0; i < colours.length; i++) {
      for (let j = i + 1; j < colours.length; j++) {
        edges += measured.adjacent[colours[i]!]![colours[j]!]!;
      }
    }
    assert.equal(edges, lostEdges, `colours ${colours.join(' = ')}`);
    total += edges;
  }

  assert.equal(total, CGA_COST.lostEdges);

  // One group, so it is the whole cost: black against blue, which no
  // rearrangement recovers -- both are the background register, and there is no
  // fifth colour to move one of them to.
  assert.equal(CGA_COLLISIONS.length, 1);
  assert.ok(total / 277937 < 0.1, "and it is a tenth of the game's boundaries");
});

test('the colours the row phase gave back are the ones the game notices', () => {
  // Under the one-pattern reading three groups collided and the game lost
  // 30,549 boundary pixels. Two of those groups are gone, and what they were
  // worth is measured here rather than asserted in the abstract: yellow against
  // white is the expensive one, and dark grey -- which also came free of the
  // background -- turns out to be worth almost nothing in this game.
  for (const [a, b] of [[14, 15], [12, 13], [8, 0]] as const) {
    assert.notDeepEqual(CGA_DITHER[a], CGA_DITHER[b], `${a} still looks like ${b}`);
  }

  const recovered =
    measured.adjacent[14]![15]! + measured.adjacent[12]![13]! + measured.adjacent[8]![0]!;
  assert.deepEqual(
    [measured.adjacent[14]![15], measured.adjacent[12]![13], measured.adjacent[8]![0]],
    [2276, 654, 5],
  );
  assert.equal(30549 - CGA_COST.lostEdges, recovered, 'which is the whole improvement');
});

// --- what the driver draws --------------------------------------------------

/** A frame with a real picture, the status line, an input line and a window. */
function frameOf(visual: Screens['visual']): Frame {
  const cells = new TextLayer();
  cells.write(' Score:0 of 222', 0, 0, 0, 15);

  return new Frame()
    .fill(0)
    .picture(visual, DEFAULT_PICTURE_ROW)
    .cells(cells)
    .text(']', 0, 23, 15, 0)
    .window(layOutWindow('a message over the scene', { row: 14 }));
}

test('every picture in the game renders through the CGA driver', () => {
  assert.equal(createDriver('cga').mode, 'cga');
});

test('a CGA frame holds nothing but the four colours it has', async () => {
  const driver = new CgaDriver();

  for (const id of manager.ids('pic')) {
    const screens = Screens.fromPicture(await manager.load('pic', id));
    driver.draw(frameOf(screens.visual));

    for (const pixel of driver.display.pixels) {
      assert.ok(pixel < CGA_COLOURS, `pic ${id} drew CGA colour ${pixel}`);
    }
  }
});

test('the dither is a checkerboard, because the pattern turns over each row', () => {
  // M16 read this the other way -- CGA_GRAF.OVL has no `and dx, 3` where
  // HGC_GRAF.OVL does -- and drew vertical stripes. M20 measured the running
  // 2.917 interpreter instead and found two patterns a colour, chosen by row.
  const driver = new CgaDriver();
  const flat = new Uint8Array(PICTURE_WIDTH * PICTURE_HEIGHT).fill(7); // light grey
  driver.draw(new Frame().fill(0).picture(flat, DEFAULT_PICTURE_ROW));

  const [even, odd] = CGA_DITHER[7]!;
  assert.notDeepEqual(even, odd, 'light grey differs by row, or this proves nothing');

  const at = (x: number, y: number) => driver.display.pixels[y * driver.display.width + x]!;
  const top = DEFAULT_PICTURE_ROW * 8;
  assert.equal(top % 2, 0, 'the picture starts on an even row');

  for (const row of [top, top + 2]) {
    assert.deepEqual([at(0, row), at(1, row)], [...even], `row ${row}`);
  }
  for (const row of [top + 1, top + 3]) {
    assert.deepEqual([at(0, row), at(1, row)], [...odd], `row ${row}`);
  }
});

test('a fill is dithered the way the picture is', () => {
  const driver = new CgaDriver();
  driver.draw(new Frame().fill(2)); // green

  const at = (x: number, y: number) => driver.display.pixels[y * driver.display.width + x]!;
  const [even, odd] = CGA_DITHER[2]!;
  assert.deepEqual([even, odd], [[1, 1], [1, 0]]);
  assert.deepEqual([at(0, 0), at(1, 0), at(2, 0), at(3, 0)], [1, 1, 1, 1]);
  assert.deepEqual([at(0, 1), at(1, 1), at(2, 1), at(3, 1)], [1, 0, 1, 0]);
});

test('a solid colour stays solid: text is not dithered', () => {
  // A glyph's stroke is one or two pixels of an eight-pixel cell, so a
  // dithered stroke is a stroke with holes in it. Ink and ground are both one
  // colour, whatever the blend table would have said.
  const driver = new CgaDriver();
  driver.draw(new Frame().fill(11)); // light cyan: a mixed blend as a picture

  const solid = CGA_SOLID[11]!;
  assert.ok(
    driver.display.pixels.every((pixel) => pixel === solid),
    'the text background is one colour, not a blend',
  );
});

test('CGA leaves EGA alone', async () => {
  // The mode nobody here can check against real hardware must not be able to
  // disturb the one mode that is known to be right.
  const id = manager.ids('pic')[0]!;
  const frame = frameOf(Screens.fromPicture(await manager.load('pic', id)).visual);

  const ega = new EgaDriver();
  ega.draw(frame);
  const before = ega.display.pixels.slice();

  new CgaDriver().draw(frame);
  ega.draw(frame);

  assert.deepEqual(ega.display.pixels, before);
  assert.equal(ega.display.palette.length / 3, PALETTE_SIZE, 'and still has sixteen colours');
});

// --- the tables are the interpreter's -------------------------------------

test("the shipped tables are the bytes in the game's own AGIDATA.OVL", async () => {
  // The strongest test here: the constants in cgatables.ts are not derived and
  // not measured, they are a copy, and this is what says so.
  const bytes = await source.read('AGIDATA.OVL');
  assert.ok(bytes, 'AGIDATA.OVL is bundled');

  const fromFile = decodeCgaTables(bytes);
  assert.deepEqual([...fromFile.colour], [...CGA_TABLES.colour]);
  assert.deepEqual([...fromFile.mono], [...CGA_TABLES.mono]);
  assert.deepEqual([...fromFile.monoFill], [...CGA_TABLES.monoFill]);
  assert.deepEqual(fromFile.fill.map((pair) => [...pair]), CGA_TABLES.fill.map((pair) => [...pair]));

  // And the offsets are where the driver's code loads them from.
  assert.deepEqual({ ...CGA_TABLES_AT }, { fill: 0x1b78, mono: 0x1ba8, colour: 0x1bb8 });
});

test('a cell of the two-colour mode is four pixels of one bit', () => {
  // Which is what makes one table serve both modes: a nibble is one AGI pixel
  // either way -- two pixels of two bits in 320x200, four of one in 640x200.
  assert.equal(CGA_MONO_PIXELS, 4);
  assert.equal(CGA_MONO_WIDTH, PICTURE_WIDTH * CGA_MONO_PIXELS);
  assert.equal(CGA_MONO_WIDTH, 640);
  assert.equal(CGA_MONO_HEIGHT, 200);
});

test('the two-colour table is a permutation, so no two colours look alike', () => {
  // Sixteen colours, sixteen distinct four-pixel patterns. More than either of
  // the other modes manages -- and the reason it can is that a pattern carries
  // more than a density: five densities over sixteen colours means eleven pairs
  // share one, and only the arrangement separates them.
  assert.equal(new Set(CGA_TABLES.mono).size, PALETTE_SIZE);
  assert.equal(monoDensity(CGA_TABLES.mono[0]!), 0, 'black is unlit');
  assert.equal(monoDensity(CGA_TABLES.mono[15]!), CGA_MONO_PIXELS, 'white is solid');

  const densities = new Set(CGA_TABLES.mono.map((nibble) => monoDensity(nibble)));
  assert.equal(densities.size, CGA_MONO_PIXELS + 1, 'five densities, 0 through 4');
});

test('the two-colour picture table and the fill column are the same table', () => {
  // Forty-eight bytes apart in the file, with no reason to agree unless both
  // have been read right. `decodeCgaTables` refuses a file where they do not.
  assert.deepEqual([...CGA_TABLES.monoFill], [...CGA_TABLES.mono]);
  assert.ok(CGA_TABLES_AT.fill < CGA_TABLES_AT.mono);
});

test('a wrong AGIDATA.OVL is refused rather than half read', () => {
  const bytes = new Uint8Array(CGA_TABLES_AT.colour + 16);
  assert.throws(() => decodeCgaTables(bytes.subarray(0, 100)), /bytes/);

  // Long enough, but the two two-colour tables disagree: the reading is wrong
  // or the file is not this one, and either way it is not usable.
  bytes[CGA_TABLES_AT.mono] = 0x22;
  assert.throws(() => decodeCgaTables(bytes), /disagree/);
});

// --- the two-colour mode ---------------------------------------------------

test('the two-colour mode draws every colour at its own density', () => {
  const driver = new CgaMonoDriver();
  const top = DEFAULT_PICTURE_ROW * 8;

  for (let colour = 0; colour < PALETTE_SIZE; colour++) {
    const flat = new Uint8Array(PICTURE_WIDTH * PICTURE_HEIGHT).fill(colour);
    driver.draw(new Frame().fill(0).picture(flat, DEFAULT_PICTURE_ROW));

    let lit = 0;
    for (let x = 0; x < CGA_MONO_PIXELS; x++) {
      lit += driver.display.pixels[top * driver.display.width + x]!;
    }
    assert.equal(lit, monoDensity(CGA_TABLES.mono[colour]!), `colour ${colour}`);
  }
});

test('the two-colour mode has no row phase either', () => {
  const driver = new CgaMonoDriver();
  const flat = new Uint8Array(PICTURE_WIDTH * PICTURE_HEIGHT).fill(9); // light blue: .###
  driver.draw(new Frame().fill(0).picture(flat, DEFAULT_PICTURE_ROW));

  const top = DEFAULT_PICTURE_ROW * 8;
  const row = (y: number) => [0, 1, 2, 3].map((x) =>
    driver.display.pixels[y * driver.display.width + x]!);

  assert.deepEqual(row(top), [0, 1, 1, 1]);
  assert.deepEqual(row(top + 1), [0, 1, 1, 1], 'the same on the next row');
});

test('two colours put ink and ground on opposite sides, always', () => {
  // Brown on black is the pair the bundled game sets in five places, and both
  // are unlit: 1/4 and 0/4. Without the fallback those five lines are empty.
  assert.equal(cgaMonoSolid(6), cgaMonoSolid(0));
  const [ink, ground] = cgaMonoTextColours(6, 0);
  assert.notEqual(ink, ground);

  for (let a = 0; a < PALETTE_SIZE; a++) {
    for (let b = 0; b < PALETTE_SIZE; b++) {
      if (a === b) continue;
      const [f, g] = cgaMonoTextColours(a, b);
      assert.notEqual(f, g, `${a} on ${b}`);
    }
  }
});

test('the two-colour mode presents at the size the four-colour one does', () => {
  // Twice the pixels across the same tube, so its pixel is half as wide. The
  // canvas multiplies the two together, which is what makes the two modes the
  // same shape on screen.
  const colour = new CgaDriver();
  const mono = new CgaMonoDriver();

  assert.equal(mono.display.width * mono.pixelAspect, colour.display.width * colour.pixelAspect);
  assert.equal(mono.display.height, colour.display.height);
  assert.equal(mono.display.palette.length / 3, 2);
  assert.deepEqual([...CGA_MONO_PALETTE_RGB], [0, 0, 0, 170, 170, 170]);
});

test('every picture in the game renders in the two colours it has', async () => {
  const driver = new CgaMonoDriver();

  for (const id of manager.ids('pic')) {
    const screens = Screens.fromPicture(await manager.load('pic', id));
    driver.draw(new Frame().fill(0).picture(screens.visual, DEFAULT_PICTURE_ROW));

    for (const pixel of driver.display.pixels) {
      assert.ok(pixel <= 1, `pic ${id} drew ${pixel}`);
    }
  }
});

test('the two-colour mode keeps a row for the command line', () => {
  // Unlike Hercules, whose picture covers the grid's rows 1 to 24. This one
  // draws the picture's 168 rows in 8-row cells, so rows 22 to 24 are clear --
  // which is why the box is keyed on the screen's geometry rather than on the
  // monitor variable. See `hasInputRow`.
  const driver = new CgaMonoDriver();
  const picture = DEFAULT_PICTURE_ROW * driver.cell.height + PICTURE_HEIGHT;

  assert.equal(picture, 176);
  assert.ok(picture <= 23 * driver.cell.height, 'the input row is below the picture');
  assert.equal(driver.display.height / driver.cell.height, 25, 'and there are 25 rows');
});

// --- and the menu item that reaches it -------------------------------------

test('only CGA has a mode to switch to when the game asks for mono', () => {
  assert.equal(hasMonoVariant('cga'), true);
  assert.equal(hasMonoVariant('ega'), false);
  assert.equal(hasMonoVariant('hercules'), false, 'it is monochrome already');
});

test('the renderer answers a mono display by changing the card, on CGA', () => {
  const renderer = new Renderer('cga');
  assert.ok(renderer.driver instanceof CgaDriver);

  assert.equal(renderer.setMonochrome(true), true, 'the driver changed');
  assert.ok(renderer.driver instanceof CgaMonoDriver);
  assert.equal(renderer.driver.mode, 'cga', 'and it is still CGA above the seam');
  assert.equal(renderer.setMonochrome(true), false, 'asked twice, it does nothing');

  assert.equal(renderer.setMonochrome(false), true);
  assert.ok(renderer.driver instanceof CgaDriver);
});

test('mono survives a mode switch away and back', () => {
  // A player who moves to EGA while the game is in mono and comes back should
  // find the card as the game left it.
  const renderer = new Renderer('cga');
  renderer.setMonochrome(true);

  renderer.setMode('ega');
  assert.equal(renderer.driver.mode, 'ega', 'and EGA has no mono variant to build');

  renderer.setMode('cga');
  assert.ok(renderer.driver instanceof CgaMonoDriver);
});

test('on EGA and Hercules a mono display changes nothing about the driver', () => {
  for (const mode of ['ega', 'hercules'] as const) {
    const renderer = new Renderer(mode);
    const before = renderer.driver;
    assert.equal(renderer.setMonochrome(true), false);
    assert.equal(renderer.driver, before);
  }
});
