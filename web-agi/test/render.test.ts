import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decodeView } from 'agi-extract/view';

import { ResourceManager } from '../src/resources/manager.ts';
import { Display, DISPLAY_WIDTH, PICTURE_TOP } from '../src/render/display.ts';
import { Renderer } from '../src/render/renderer.ts';
import { PICTURE_HEIGHT, PICTURE_WIDTH, RED, Screens, WHITE } from '../src/render/screens.ts';
import { drawCel, type Cel } from '../src/render/sprite.ts';
import { DiskSource } from './helpers/disk-source.ts';

const manager = await ResourceManager.open(await DiskSource.open());

/** The first picture that draws something, so the assertions have substance. */
async function firstDrawnPicture(): Promise<{ id: number; screens: Screens }> {
  for (const id of manager.ids('pic')) {
    const screens = Screens.fromPicture(await manager.load('pic', id));
    if (screens.visual.some((colour) => colour !== WHITE)) return { id, screens };
  }
  throw new Error('no picture in this game draws anything');
}

const picture = await firstDrawnPicture();

test('a real PICTURE decodes onto both screens', () => {
  const { screens } = picture;

  assert.equal(screens.visual.length, PICTURE_WIDTH * PICTURE_HEIGHT);
  assert.equal(screens.priority.length, PICTURE_WIDTH * PICTURE_HEIGHT);
  assert.ok(screens.visual.some((c) => c !== WHITE), 'the visual screen was drawn on');
  assert.ok(screens.visual.every((c) => c <= 15), 'only EGA colours');
  assert.ok(screens.priority.every((p) => p <= 15), 'only valid priority values');
});

test('some pictures carry depth and control information, others do not', () => {
  // A picture is free to leave the priority screen untouched -- a plain
  // backdrop with nothing to walk behind needs no depth. So this is a property
  // of the game as a whole, not of any one picture.
  assert.ok(
    picture.screens.priority.every((p) => p <= 15),
    'whatever this picture set, it is in range',
  );
});

test('at least one picture in the game draws on the priority screen', async () => {
  for (const id of manager.ids('pic')) {
    const screens = Screens.fromPicture(await manager.load('pic', id));
    if (screens.priority.some((p) => p !== RED)) return;
  }
  assert.fail('no picture draws priority information, which cannot be right');
});

test('every picture in the game decodes without throwing', async () => {
  for (const id of manager.ids('pic')) {
    const screens = Screens.fromPicture(await manager.load('pic', id));
    assert.equal(screens.visual.length, PICTURE_WIDTH * PICTURE_HEIGHT, `pic ${id}`);
  }
});

test('composing puts the picture in the picture area', () => {
  const renderer = new Renderer();
  renderer.compose(picture.screens);

  const row = PICTURE_TOP * DISPLAY_WIDTH;
  const pictureArea = renderer.display.pixels.subarray(row, row + DISPLAY_WIDTH * PICTURE_HEIGHT);

  assert.ok(pictureArea.some((c) => c !== 0), 'something was composed');
  assert.deepEqual(
    [...renderer.display.pixels.subarray(0, DISPLAY_WIDTH)],
    new Array(DISPLAY_WIDTH).fill(0),
    'the status line stays chrome',
  );
});

test('toggling the view composes the priority screen instead', () => {
  const renderer = new Renderer();
  renderer.compose(picture.screens);
  const visual = renderer.display.pixels.slice();

  assert.equal(renderer.toggleView(), 'priority');
  renderer.compose(picture.screens);

  assert.notDeepEqual([...renderer.display.pixels], [...visual], 'a different screen is shown');
  assert.equal(renderer.toggleView(), 'visual');
});

test('a real VIEW cel composites over a real picture', async () => {
  const viewId = manager.ids('view')[0]!;
  const view = decodeView(await manager.load('view', viewId)) as {
    loops: { loop: number; cels: Cel[] }[];
  };
  const loop = view.loops.find((l) => l.cels.length > 0)!;
  const cel = loop.cels[0]!;

  const screens = picture.screens.clone();
  const before = screens.visual.slice();

  const painted = drawCel(screens, cel, {
    x: 20,
    y: PICTURE_HEIGHT - 10,
    priority: 15, // in front of everything, so the whole sprite lands
    loop: loop.loop,
  });

  assert.ok(painted > 0, 'the sprite drew pixels');
  assert.notDeepEqual([...screens.visual], [...before], 'the picture changed');
  assert.ok(
    painted < cel.width * cel.height || cel.pixels.every((p) => p !== 16),
    'transparent pixels were skipped, unless the cel has none',
  );
});

test('drawing a sprite does not disturb the background outside its box', async () => {
  const viewId = manager.ids('view')[0]!;
  const view = decodeView(await manager.load('view', viewId)) as {
    loops: { loop: number; cels: Cel[] }[];
  };
  const cel = view.loops.find((l) => l.cels.length > 0)!.cels[0]!;

  const screens = picture.screens.clone();
  const before = screens.visual.slice();
  drawCel(screens, cel, { x: 40, y: 100, priority: 15 });

  for (let y = 0; y < PICTURE_HEIGHT; y++) {
    for (let x = 0; x < PICTURE_WIDTH; x++) {
      const insideBox = x >= 40 && x < 40 + cel.width && y > 100 - cel.height && y <= 100;
      if (insideBox) continue;
      const at = Screens.index(x, y);
      assert.equal(screens.visual[at], before[at], `pixel ${x},${y} outside the cel`);
    }
  }
});

test('the display buffer expands to a full RGBA frame', () => {
  const display = new Display();
  display.drawScreen(picture.screens.visual);
  assert.equal(display.toRgba().length, DISPLAY_WIDTH * 200 * 4);
});
