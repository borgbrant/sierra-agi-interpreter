import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PICTURE_HEIGHT, PICTURE_WIDTH, Screens } from '../src/render/screens.ts';
import { drawCel, TRANSPARENT, type Cel } from '../src/render/sprite.ts';

const T = TRANSPARENT;

/** Build a cel from rows of palette indices, 16 meaning transparent. */
function cel(rows: number[][], options: Partial<Cel> = {}): Cel {
  const height = rows.length;
  const width = rows[0]!.length;
  return {
    width,
    height,
    transparent: 0,
    mirrored: false,
    sourceLoop: 0,
    pixels: Uint8Array.from(rows.flat()),
    ...options,
  };
}

/** A screens pair with a uniform, low background priority. */
function screensWithPriority(priority: number): Screens {
  const screens = new Screens();
  screens.priority.fill(priority);
  return screens;
}

test('a cel is anchored by its bottom-left corner', () => {
  // AGI positions an object by the bottom of its cel, so a taller sprite grows
  // upward from the same standing point rather than downward from its top.
  const screens = screensWithPriority(4);
  drawCel(screens, cel([[1], [2], [3]]), { x: 10, y: 50, priority: 4 });

  assert.equal(screens.colourAt(10, 48), 1, 'top row is two above the anchor');
  assert.equal(screens.colourAt(10, 49), 2);
  assert.equal(screens.colourAt(10, 50), 3, 'bottom row sits on the anchor');
});

test('transparent pixels leave the background alone', () => {
  const screens = screensWithPriority(4);
  screens.visual.fill(7);

  const painted = drawCel(screens, cel([[1, T, 2]]), { x: 0, y: 0, priority: 4 });

  assert.equal(screens.colourAt(0, 0), 1);
  assert.equal(screens.colourAt(1, 0), 7, 'the hole shows the background');
  assert.equal(screens.colourAt(2, 0), 2);
  assert.equal(painted, 2);
});

test('a sprite is hidden where the background has higher priority', () => {
  const screens = screensWithPriority(4);
  screens.visual.fill(7);
  // A band of scenery in front of the object.
  for (let x = 0; x < 4; x++) screens.priority[Screens.index(x, 0)] = 10;

  drawCel(screens, cel([[1, 1, 1, 1, 1, 1]]), { x: 0, y: 0, priority: 6 });

  for (let x = 0; x < 4; x++) assert.equal(screens.colourAt(x, 0), 7, `hidden at ${x}`);
  for (let x = 4; x < 6; x++) assert.equal(screens.colourAt(x, 0), 1, `drawn at ${x}`);
});

test('a sprite draws where its priority equals the background', () => {
  const screens = screensWithPriority(6);
  drawCel(screens, cel([[1]]), { x: 0, y: 0, priority: 6 });
  assert.equal(screens.colourAt(0, 0), 1);
});

test('control lines never hide a sprite', () => {
  // Control information occupies priority 0-3 and objects are 4 or more, so the
  // ordinary comparison already lets sprites pass over control lines.
  const screens = screensWithPriority(4);
  for (let x = 0; x < 4; x++) screens.priority[Screens.index(x, 0)] = x; // all four control values

  const painted = drawCel(screens, cel([[1, 1, 1, 1]]), { x: 0, y: 0, priority: 4 });

  assert.equal(painted, 4, 'every pixel drew');
});

test('drawing stamps the object priority onto the priority screen', () => {
  const screens = screensWithPriority(4);
  drawCel(screens, cel([[1]]), { x: 5, y: 5, priority: 9 });
  assert.equal(screens.priorityAt(5, 5), 9);
});

test('writePriority false leaves the priority screen untouched', () => {
  const screens = screensWithPriority(4);
  drawCel(screens, cel([[1]]), { x: 5, y: 5, priority: 9, writePriority: false });

  assert.equal(screens.colourAt(5, 5), 1, 'still drawn');
  assert.equal(screens.priorityAt(5, 5), 4, 'priority unchanged');
});

test('a cel is clipped at every screen edge', () => {
  const screens = screensWithPriority(4);

  const acrossLeft = drawCel(screens, cel([[1, 1, 1, 1]]), { x: -2, y: 0, priority: 4 });
  assert.equal(acrossLeft, 2, 'only the on-screen half drew');

  const acrossRight = drawCel(screens, cel([[1, 1, 1, 1]]), {
    x: PICTURE_WIDTH - 2,
    y: 10,
    priority: 4,
  });
  assert.equal(acrossRight, 2);

  const belowBottom = drawCel(screens, cel([[1], [1], [1]]), {
    x: 0,
    y: PICTURE_HEIGHT + 1,
    priority: 4,
  });
  assert.equal(belowBottom, 1, 'only the row still on screen drew');

  const aboveTop = drawCel(screens, cel([[1], [1], [1]]), { x: 20, y: 1, priority: 4 });
  assert.equal(aboveTop, 2);
});

test('a mirrored cel is flipped for loops other than the one it is stored for', () => {
  const mirrored = cel([[1, 2, 3]], { mirrored: true, sourceLoop: 0 });

  const own = new Screens();
  drawCel(own, mirrored, { x: 0, y: 0, priority: 4, loop: 0 });
  assert.deepEqual([own.colourAt(0, 0), own.colourAt(1, 0), own.colourAt(2, 0)], [1, 2, 3]);

  const other = new Screens();
  drawCel(other, mirrored, { x: 0, y: 0, priority: 4, loop: 1 });
  assert.deepEqual([other.colourAt(0, 0), other.colourAt(1, 0), other.colourAt(2, 0)], [3, 2, 1]);
});

test('an unmirrored cel is never flipped, whichever loop asks for it', () => {
  const plain = cel([[1, 2, 3]]);
  const screens = new Screens();
  drawCel(screens, plain, { x: 0, y: 0, priority: 4, loop: 5 });
  assert.deepEqual([screens.colourAt(0, 0), screens.colourAt(2, 0)], [1, 3]);
});
