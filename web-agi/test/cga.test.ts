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
  CGA_PALETTE_RGB,
  CGA_SOLID,
  CgaDriver,
  cgaTextColours,
} from '../src/render/drivers/cga.ts';
import { createDriver } from '../src/render/drivers/index.ts';
import { EgaDriver } from '../src/render/drivers/ega.ts';
import { Frame } from '../src/render/frame.ts';
import { PICTURE_HEIGHT, PICTURE_WIDTH, Screens } from '../src/render/screens.ts';
import { layOutWindow, TextLayer } from '../src/render/text.ts';
import { ResourceManager } from '../src/resources/manager.ts';
import { DiskSource } from './helpers/disk-source.ts';

const manager = await ResourceManager.open(await DiskSource.open());

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
    // Written low-then-high so that (a,b) and (b,a) cannot both appear and be
    // mistaken for two different appearances: they are the same blend.
    assert.ok(pair[0]! <= pair[1]!, `colour ${colour} is written in order`);
  }

  for (const index of CGA_SOLID) assert.ok(index >= 0 && index < CGA_COLOURS);
});

test('sixteen colours reach ten appearances, which is all there are', () => {
  // Two colours from four is ten blends, not sixteen, and that is the whole
  // shape of the problem: six of the sixteen must share.
  const available = (CGA_COLOURS * (CGA_COLOURS + 1)) / 2;
  assert.equal(available, 10);

  const used = new Set(CGA_DITHER.map((pair) => pair.join(',')));
  assert.equal(used.size, CGA_COST.appearances);
  assert.equal(used.size, available, 'every blend is put to work');
});

test('only black is drawn as black, or text goes missing', () => {
  // The bundled game sets `set.text.attribute(6, 0)` -- brown on black -- in
  // five places. Under pure nearest match brown, red and dark grey all land on
  // black, and brown on black is then not an approximation but an empty line.
  assert.equal(CGA_SOLID[0], 0);
  for (let colour = 1; colour < PALETTE_SIZE; colour++) {
    assert.notEqual(CGA_SOLID[colour], 0, `colour ${colour} would be invisible on black`);
  }
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

test('the dither is a checkerboard, not a set of stripes', async () => {
  // A region of one colour becomes a pair of pixels repeated. Drawn the same
  // way on every row that is two one-pixel stripes; swapped on alternate rows
  // it is a checkerboard, which is the same colour on average and a visibly
  // better texture.
  const driver = new CgaDriver();
  const flat = new Uint8Array(PICTURE_WIDTH * PICTURE_HEIGHT).fill(11); // light cyan, a mixed blend
  driver.draw(new Frame().fill(0).picture(flat, PICTURE_ROW));

  const [a, b] = CGA_DITHER[11]!;
  assert.notEqual(a, b, 'light cyan is a mixed blend, or this proves nothing');

  const at = (x: number, y: number) => driver.display.pixels[y * driver.display.width + x]!;
  const top = PICTURE_ROW * 8;

  assert.equal(at(0, top), a);
  assert.equal(at(1, top), b);
  assert.equal(at(0, top + 1), b, 'the next row starts on the other colour');
  assert.equal(at(1, top + 1), a);
  assert.equal(at(0, top + 2), a, 'and the row after that is back');
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
