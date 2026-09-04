/**
 * The page shell stays out of the game's keyboard space.
 *
 * M14 keeps the developer tools, but moves them behind the developer panel and
 * refuses any shortcut the loaded game has already claimed. These tests keep
 * that rule out of the DOM, where it can be checked without a browser.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { KeyBindings } from '../src/engine/menu.ts';
import { fitPresentation } from '../src/shell/canvas.ts';
import {
  debugActionForEvent,
  type DebugKeyEvent,
} from '../src/shell/debug.ts';

function event(values: Partial<DebugKeyEvent>): DebugKeyEvent {
  return {
    key: '',
    code: '',
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...values,
  };
}

test('unmodified function keys are not shell debug shortcuts', () => {
  const unclaimed = () => false;

  assert.equal(debugActionForEvent(event({ key: 'F7', code: 'F7' }), unclaimed), null);
  assert.equal(debugActionForEvent(event({ key: 'F8', code: 'F8' }), unclaimed), null);
  assert.equal(debugActionForEvent(event({ key: 'F9', code: 'F9' }), unclaimed), null);
});

test('developer shortcuts require both Alt and Shift', () => {
  const unclaimed = () => false;

  assert.equal(debugActionForEvent(event({ key: 'P', code: 'KeyP', altKey: true }), unclaimed), null);
  assert.equal(debugActionForEvent(event({ key: 'P', code: 'KeyP', shiftKey: true }), unclaimed), null);
  assert.equal(
    debugActionForEvent(event({ key: 'P', code: 'KeyP', altKey: true, shiftKey: true }), unclaimed),
    'priority',
  );
});

test('developer shortcuts are refused when the game has claimed the key', () => {
  const bindings = new KeyBindings();
  bindings.bind(0, 25, 99); // Alt+P: scan code 25, no character.

  const claimed = debugActionForEvent(
    event({ key: 'P', code: 'KeyP', altKey: true, shiftKey: true }),
    (key) => bindings.controllerFor(key) !== undefined,
  );

  assert.equal(claimed, null);
});

test('developer shortcuts map to the three debug actions when unclaimed', () => {
  const unclaimed = () => false;

  assert.equal(
    debugActionForEvent(event({ key: 'P', code: 'KeyP', altKey: true, shiftKey: true }), unclaimed),
    'priority',
  );
  assert.equal(
    debugActionForEvent(event({ key: 'S', code: 'KeyS', altKey: true, shiftKey: true }), unclaimed),
    'state',
  );
  assert.equal(
    debugActionForEvent(event({ key: 'D', code: 'KeyD', altKey: true, shiftKey: true }), unclaimed),
    'disassembly',
  );
});

/**
 * How big the canvas is drawn, which until M17 was decided from the window's
 * width alone.
 *
 * The arithmetic is a pure function so it can be held here rather than in a
 * browser: `fitPresentation` is given a framebuffer and the box the page has,
 * and returns what the element is sized to.
 */
const EGA = { width: 320, height: 200, pixelAspect: 1 } as const;
const CGA_MONO = { width: 640, height: 200, pixelAspect: 0.5 } as const;
const HERCULES = { width: 720, height: 348, pixelAspect: 1 } as const;

/** Every mode a player can choose, at the size each is presented. */
const MODES = [
  { name: 'ega', buffer: EGA },
  { name: 'cga', buffer: { width: 320, height: 200, pixelAspect: 1 } as const },
  { name: 'cga 640x200', buffer: CGA_MONO },
  { name: 'hercules', buffer: HERCULES },
];

test('the canvas is never taller than the box it is given', () => {
  // The M17 defect, in the size that showed it: a 1440x900 window left a
  // ~700-pixel stage, and the old rule picked scale 4 from the width and
  // returned an 800-pixel-tall canvas.
  const stage = { width: 1440, height: 700 };

  for (const mode of MODES) {
    const shown = fitPresentation(mode.buffer, stage);
    assert.ok(
      shown.height <= stage.height,
      `${mode.name} is ${shown.height} tall in a ${stage.height} stage`,
    );
    assert.ok(shown.width <= stage.width, `${mode.name} is ${shown.width} wide`);
  }
});

test('enlarging is by whole multiples, which is what keeps a dither a dither', () => {
  for (const mode of MODES) {
    const shown = fitPresentation(mode.buffer, { width: 1920, height: 1080 });
    assert.ok(shown.scale >= 1, `${mode.name} was shrunk in a 1920x1080 stage`);
    assert.equal(shown.whole, true, `${mode.name} was scaled by ${shown.scale}`);
  }
});

test('a buffer wider than the stage is shrunk rather than allowed to overflow', () => {
  // Hercules' 720 pixels do not fit a phone at any whole multiple, and before
  // M17 `Math.max(1, ...)` gave it scale 1 and a canvas twice the screen.
  const phone = { width: 360, height: 620 };
  const shown = fitPresentation(HERCULES, phone);

  assert.ok(shown.width <= phone.width, `${shown.width} wide on a 360 screen`);
  assert.ok(shown.scale < 1);
  assert.equal(shown.whole, false);
});

test('the display modes are presented at comparable sizes', () => {
  // The second M17 defect: whole multiples applied to each driver's raw
  // buffer with no reference to the others put EGA at 1280x800 and Hercules
  // at 720x348 in the same window -- a third of the width for the mode that
  // draws the most pixels.
  //
  // The stage taking the page's full width is what settles it, because
  // Hercules' 2x is exactly 1440 and 32 pixels of padding is the difference
  // between 2x and 1x.
  for (const stage of [
    { width: 1440, height: 700 },
    { width: 1920, height: 880 },
    { width: 2560, height: 1240 },
  ]) {
    const heights = MODES.map((mode) => fitPresentation(mode.buffer, stage).height);
    const tallest = Math.max(...heights);
    const shortest = Math.min(...heights);

    assert.ok(
      shortest >= tallest * 0.8,
      `in a ${stage.width}x${stage.height} stage the modes are ${heights.join(', ')} tall`,
    );
  }
});

test('an unlaid-out stage asks for nothing rather than for a 1x1 canvas', () => {
  const shown = fitPresentation(EGA, { width: 0, height: 0 });

  assert.equal(shown.scale, 0);
  assert.equal(shown.width, 0);
});
