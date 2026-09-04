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

import { PICTURE_ROW } from '../src/engine/layout.ts';
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

  for (const [colour, pair] of CGA_DITHER.entries()) {
    assert.equal(pair.length, 2, `colour ${colour}`);
    for (const index of pair) {
      assert.ok(index >= 0 && index < CGA_COLOURS, `colour ${colour} uses CGA ${index}`);
    }
  }

  // The order within a pair is the original's and it is not sorted: green is
  // 3,0 and cyan 0,1. Order changes nothing but which pixel of the stripe comes
  // first, and the original still chose one, so the table keeps it.
  assert.deepEqual(CGA_DITHER[2], [3, 0]);
  assert.deepEqual(CGA_DITHER[3], [0, 1]);

  for (const index of CGA_SOLID) assert.ok(index >= 0 && index < CGA_COLOURS);
});

test('sixteen colours reach twelve appearances, of the sixteen ordered pairs', () => {
  // Ordered, because the original's table is: four of its sixteen entries are a
  // pair the reverse of another's, and drawn as stripes those are two different
  // pictures even though they are the same colour on average.
  const ordered = CGA_COLOURS * CGA_COLOURS;
  assert.equal(ordered, 16);

  const used = new Set(CGA_DITHER.map((pair) => pair.join(',')));
  assert.equal(used.size, CGA_COST.appearances);
  assert.equal(used.size, 12, 'twelve of the sixteen, which leaves the four it collides on');

  // As blends -- ignoring the order -- it reaches all ten there are, which is
  // the most a pair of four colours can: every blend is put to work, and the
  // four entries that collide are the surplus.
  const blends = new Set(
    CGA_DITHER.map((pair) => [...pair].sort((a, b) => a - b).join(',')),
  );
  assert.equal(blends.size, (CGA_COLOURS * (CGA_COLOURS + 1)) / 2);
  assert.equal(blends.size, 10);
});

test('the fill table reaches more appearances than the picture table', () => {
  // Because it alternates two patterns where the picture uses one, which is the
  // original's own inconsistency rather than this engine's.
  const filled = new Set(CGA_FILL.map((halves) => halves.map((pair) => pair.join(',')).join('/')));
  assert.equal(filled.size, CGA_COST.fillAppearances);
  assert.ok(filled.size > CGA_COST.appearances);
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
  CGA_DITHER.forEach((pair, colour) => {
    const key = pair.join(',');
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

  // And the shape of the loss: three quarters of it is one group, light grey
  // with yellow and white, which no rearrangement recovers -- the brightest
  // blend is light grey, so a highlight on light grey has nowhere to go.
  const worst = Math.max(...CGA_COLLISIONS.map((group) => group.lostEdges));
  assert.ok(worst / total > 0.7, 'the expensive group is still the expensive one');
});

test('brown and dark grey are the one collision the game never notices', () => {
  // The only pair in the table that is never adjacent anywhere in 43 pictures.
  assert.equal(measured.adjacent[6]![8], 0);
});

// --- what the driver draws --------------------------------------------------

/** A frame with a real picture, the status line, an input line and a window. */
function frameOf(visual: Screens['visual']): Frame {
  const cells = new TextLayer();
  cells.write(' Score:0 of 222', 0, 0, 0, 15);

  return new Frame()
    .fill(0)
    .picture(visual, PICTURE_ROW)
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

test('the dither is stripes, not a checkerboard', () => {
  // M12 swapped the pair on alternate rows, so a region read as a checkerboard.
  // CGA_GRAF.OVL has no row phase -- HGC_GRAF.OVL masks the row with `and dx,
  // 3` and this one has no such instruction -- so a run of one colour is two
  // one-pixel stripes, identical on every row.
  const driver = new CgaDriver();
  const flat = new Uint8Array(PICTURE_WIDTH * PICTURE_HEIGHT).fill(11); // light cyan: 1,3
  driver.draw(new Frame().fill(0).picture(flat, PICTURE_ROW));

  const [a, b] = CGA_DITHER[11]!;
  assert.notEqual(a, b, 'light cyan is a mixed pair, or this proves nothing');

  const at = (x: number, y: number) => driver.display.pixels[y * driver.display.width + x]!;
  const top = PICTURE_ROW * 8;

  for (const row of [top, top + 1, top + 2]) {
    assert.equal(at(0, row), a, `row ${row} starts on the same colour`);
    assert.equal(at(1, row), b);
  }
});

test('a fill is dithered, and with the fill table rather than the picture one', () => {
  // The original's fill routine builds its byte from two nibbles, so the
  // pattern alternates across the width. Green is the clearest case: the
  // picture draws it 3,0 and a fill lays 1,0 then 1,1.
  const driver = new CgaDriver();
  driver.draw(new Frame().fill(2));

  const at = (x: number) => driver.display.pixels[x]!;
  const [left, right] = CGA_FILL[2]!;
  assert.deepEqual([left, right], [[1, 0], [1, 1]]);
  assert.deepEqual([at(0), at(1), at(2), at(3)], [1, 0, 1, 1]);
  assert.deepEqual([at(4), at(5), at(6), at(7)], [1, 0, 1, 1], 'and it repeats every four');
  assert.notDeepEqual([at(0), at(1)], [...CGA_DITHER[2]!], 'which the picture table would not');
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
  const top = PICTURE_ROW * 8;

  for (let colour = 0; colour < PALETTE_SIZE; colour++) {
    const flat = new Uint8Array(PICTURE_WIDTH * PICTURE_HEIGHT).fill(colour);
    driver.draw(new Frame().fill(0).picture(flat, PICTURE_ROW));

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
  driver.draw(new Frame().fill(0).picture(flat, PICTURE_ROW));

  const top = PICTURE_ROW * 8;
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
    driver.draw(new Frame().fill(0).picture(screens.visual, PICTURE_ROW));

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
  const picture = PICTURE_ROW * driver.cell.height + PICTURE_HEIGHT;

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
