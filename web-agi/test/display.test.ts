import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  Display,
  DISPLAY_HEIGHT,
  DISPLAY_WIDTH,
  PALETTE_RGB,
  PALETTE_SIZE,
  PICTURE_TOP,
  PIXEL_ASPECT,
} from '../src/render/display.ts';
import { CHAR_HEIGHT } from '../src/render/font.ts';
import { PICTURE_HEIGHT, PICTURE_WIDTH } from '../src/render/screens.ts';

const pixelAt = (display: Display, x: number, y: number) =>
  display.pixels[y * DISPLAY_WIDTH + x]!;

test('the display is 320x200 and the picture area sits below the status line', () => {
  assert.equal(DISPLAY_WIDTH, 320);
  assert.equal(DISPLAY_HEIGHT, 200);
  assert.equal(PICTURE_TOP, CHAR_HEIGHT);
  // Status line, picture, then the prompt area: 8 + 168 + 24 = 200.
  assert.equal(CHAR_HEIGHT + PICTURE_HEIGHT + 24, DISPLAY_HEIGHT);
});

test('a screen is doubled horizontally into the picture area', () => {
  const display = new Display();
  const screen = new Uint8Array(PICTURE_WIDTH * PICTURE_HEIGHT);
  screen[0] = 9; // top-left game pixel
  screen[PICTURE_WIDTH - 1] = 12; // top-right game pixel

  display.drawScreen(screen);

  for (let n = 0; n < PIXEL_ASPECT; n++) {
    assert.equal(pixelAt(display, n, PICTURE_TOP), 9, `left pixel column ${n}`);
    assert.equal(pixelAt(display, DISPLAY_WIDTH - 1 - n, PICTURE_TOP), 12, `right column ${n}`);
  }
});

test('drawing a screen leaves the status line and prompt area alone', () => {
  const display = new Display();
  display.fill(7);
  display.drawScreen(new Uint8Array(PICTURE_WIDTH * PICTURE_HEIGHT).fill(1));

  for (let y = 0; y < PICTURE_TOP; y++) {
    assert.equal(pixelAt(display, 0, y), 7, `status row ${y} untouched`);
  }
  for (let y = PICTURE_TOP + PICTURE_HEIGHT; y < DISPLAY_HEIGHT; y++) {
    assert.equal(pixelAt(display, 0, y), 7, `prompt row ${y} untouched`);
  }
  assert.equal(pixelAt(display, 0, PICTURE_TOP), 1, 'picture area was drawn');
});

test('the picture area covers exactly the rows it should', () => {
  const display = new Display();
  display.drawScreen(new Uint8Array(PICTURE_WIDTH * PICTURE_HEIGHT).fill(5));

  assert.equal(pixelAt(display, 0, PICTURE_TOP - 1), 0, 'row above is clear');
  assert.equal(pixelAt(display, 0, PICTURE_TOP), 5, 'first picture row');
  assert.equal(pixelAt(display, 0, PICTURE_TOP + PICTURE_HEIGHT - 1), 5, 'last picture row');
  assert.equal(pixelAt(display, 0, PICTURE_TOP + PICTURE_HEIGHT), 0, 'row below is clear');
});

test('fillRows clips to the display', () => {
  const display = new Display();
  display.fillRows(-10, 20, 3);
  assert.equal(pixelAt(display, 0, 0), 3);
  assert.equal(pixelAt(display, 0, 10), 0);

  display.fillRows(DISPLAY_HEIGHT - 2, 50, 4);
  assert.equal(pixelAt(display, 0, DISPLAY_HEIGHT - 1), 4);
});

test('the palette holds the 16 EGA colours', () => {
  assert.equal(PALETTE_SIZE, 16);
  assert.deepEqual([...PALETTE_RGB.subarray(0, 3)], [0, 0, 0], 'colour 0 is black');
  assert.deepEqual([...PALETTE_RGB.subarray(45, 48)], [255, 255, 255], 'colour 15 is white');
});

test('expanding to RGBA maps palette indices and is fully opaque', () => {
  const display = new Display();
  display.fill(15);
  display.pixels[0] = 4; // red

  const rgba = display.toRgba();

  assert.equal(rgba.length, DISPLAY_WIDTH * DISPLAY_HEIGHT * 4);
  assert.deepEqual([...rgba.subarray(0, 4)], [0xaa, 0x00, 0x00, 255], 'first pixel is red');
  assert.deepEqual([...rgba.subarray(4, 8)], [0xff, 0xff, 0xff, 255], 'second is white');
});

test('expanding reuses a caller-supplied buffer', () => {
  const display = new Display();
  const buffer = new Uint8ClampedArray(DISPLAY_WIDTH * DISPLAY_HEIGHT * 4);
  assert.equal(display.toRgba(buffer), buffer);
});
