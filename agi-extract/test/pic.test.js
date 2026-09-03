import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inflateSync } from 'node:zlib';

import {
  decodePicture,
  EGA_PALETTE,
  PICTURE_HEIGHT,
  PICTURE_WIDTH,
  PictureScreens,
  RED,
  round,
  WHITE,
} from '../src/agi/pic.js';
import { encodeIndexedPng, scalePixels } from '../src/util/png.js';

/** Colour index of the visual screen at (x, y). */
const at = (screens, x, y) => screens.visual[y * PICTURE_WIDTH + x];
const pri = (screens, x, y) => screens.priority[y * PICTURE_WIDTH + x];

/** Render a command stream, appending the end marker. */
const draw = (...bytes) => decodePicture(Uint8Array.from([...bytes, 0xff]));

test('both screens start white and red', () => {
  const screens = new PictureScreens();
  assert.equal(screens.visual.length, PICTURE_WIDTH * PICTURE_HEIGHT);
  assert.ok(screens.visual.every((v) => v === WHITE));
  assert.ok(screens.priority.every((v) => v === RED));
});

test('nothing is drawn until a colour enables a screen', () => {
  const screens = draw(0xf6, 0x00, 0x00, 0x0a, 0x00);
  assert.ok(screens.visual.every((v) => v === WHITE));
  assert.ok(screens.priority.every((v) => v === RED));
});

test('round() breaks ties in the direction the line travels', () => {
  assert.equal(round(3.5, 1), 4);
  assert.equal(round(3.5, -1), 3);
  assert.equal(round(3.4, 1), 3);
  assert.equal(round(3.6, -1), 4);
  assert.equal(round(7, 1), 7);
});

test('0xF6 draws an absolute horizontal line in the chosen colour', () => {
  const screens = draw(0xf0, 0x01, 0xf6, 0x02, 0x05, 0x08, 0x05);

  for (let x = 2; x <= 8; x++) assert.equal(at(screens, x, 5), 1, `x=${x}`);
  assert.equal(at(screens, 1, 5), WHITE);
  assert.equal(at(screens, 9, 5), WHITE);
});

test('0xF6 draws a diagonal line and chains through every point', () => {
  const screens = draw(0xf0, 0x02, 0xf6, 0x00, 0x00, 0x04, 0x04, 0x08, 0x00);

  for (let i = 0; i <= 4; i++) assert.equal(at(screens, i, i), 2, `down ${i}`);
  for (let i = 0; i <= 4; i++) assert.equal(at(screens, 4 + i, 4 - i), 2, `up ${i}`);
});

test('0xF7 decodes signed 4-bit relative displacements', () => {
  // 0xCC is documented as (x-4, y-4).
  const screens = draw(0xf0, 0x03, 0xf7, 0x10, 0x10, 0xcc);

  assert.equal(at(screens, 0x10, 0x10), 3, 'start plotted');
  assert.equal(at(screens, 0x10 - 4, 0x10 - 4), 3, 'end plotted');
});

test('0xF4 draws a Y corner, changing the vertical component first', () => {
  const screens = draw(0xf0, 0x00, 0xf4, 0x16, 0x16, 0x18, 0x12);

  for (let y = 0x16; y <= 0x18; y++) assert.equal(at(screens, 0x16, y), 0, `vertical y=${y}`);
  for (let x = 0x12; x <= 0x16; x++) assert.equal(at(screens, x, 0x18), 0, `horizontal x=${x}`);
  assert.equal(at(screens, 0x12, 0x16), WHITE, 'no diagonal shortcut');
});

test('0xF5 draws an X corner, changing the horizontal component first', () => {
  const screens = draw(0xf0, 0x00, 0xf5, 0x16, 0x16, 0x18, 0x12);

  for (let x = 0x16; x <= 0x18; x++) assert.equal(at(screens, x, 0x16), 0, `horizontal x=${x}`);
  for (let y = 0x12; y <= 0x16; y++) assert.equal(at(screens, 0x18, y), 0, `vertical y=${y}`);
});

test('0xF8 fills a bounded region and stops at the boundary', () => {
  const screens = draw(
    0xf0, 0x01,
    // A 10x10 box outline.
    0xf6, 0x0a, 0x0a, 0x14, 0x0a, 0x14, 0x14, 0x0a, 0x14, 0x0a, 0x0a,
    0xf0, 0x02,
    0xf8, 0x0f, 0x0f,
  );

  assert.equal(at(screens, 15, 15), 2, 'inside filled');
  assert.equal(at(screens, 11, 11), 2, 'corner inside filled');
  assert.equal(at(screens, 10, 10), 1, 'outline untouched');
  assert.equal(at(screens, 25, 25), WHITE, 'outside untouched');
});

test('a fill escaping a one-pixel gap floods the screen', () => {
  // The same box with a single pixel missing from the top edge, at x=15. This
  // is the failure mode a wrong line algorithm produces, so it is worth
  // pinning down that the fill really does escape through it.
  const screens = draw(
    0xf0, 0x01,
    0xf6, 0x0a, 0x0a, 0x0e, 0x0a,
    0xf6, 0x10, 0x0a, 0x14, 0x0a, 0x14, 0x14, 0x0a, 0x14, 0x0a, 0x0a,
    0xf0, 0x02,
    0xf8, 0x0f, 0x0f,
  );

  assert.equal(at(screens, 15, 10), 2, 'the gap itself was filled');
  assert.equal(at(screens, 100, 100), 2, 'leaked outside the box');
});

test('a fill with only priority drawing enabled spreads across red', () => {
  const screens = draw(0xf3, 0xf2, 0x06, 0xf8, 0x50, 0x50);

  assert.equal(pri(screens, 80, 80), 6);
  assert.ok(screens.visual.every((v) => v === WHITE), 'visual screen untouched');
});

test('a combined fill stops at a boundary that exists only on the visual screen', () => {
  const screens = draw(
    // A visual-only box outline, drawn with priority off.
    0xf3, 0xf0, 0x01,
    0xf6, 0x0a, 0x0a, 0x14, 0x0a, 0x14, 0x14, 0x0a, 0x14, 0x0a, 0x0a,
    // Now fill inside it with both screens enabled.
    0xf0, 0x02, 0xf2, 0x07,
    0xf8, 0x0f, 0x0f,
  );

  assert.equal(pri(screens, 15, 15), 7, 'priority filled inside');
  assert.equal(pri(screens, 100, 100), RED, 'priority did not leak past the visual outline');
});

test('a fill of white onto white changes nothing', () => {
  const screens = draw(0xf0, 0x0f, 0xf8, 0x50, 0x50);
  assert.ok(screens.visual.every((v) => v === WHITE));
});

test('0xF1 and 0xF3 disable their screens', () => {
  const screens = draw(
    0xf0, 0x01, 0xf2, 0x02,
    0xf1, // picture off, priority still on
    0xf6, 0x00, 0x00, 0x0a, 0x00,
  );

  assert.equal(at(screens, 5, 0), WHITE, 'visual untouched');
  assert.equal(pri(screens, 5, 0), 2, 'priority drawn');
});

test('a solid circle pen plots the documented shape', () => {
  // Pen size 3, solid circle: 4 wide, 7 tall, corners cut.
  const screens = draw(0xf0, 0x00, 0xf9, 0x03, 0xfa, 0x32, 0x32);

  const rows = [];
  for (let y = 0; y < 7; y++) {
    let row = '';
    for (let x = 0; x < 4; x++) {
      row += at(screens, 0x32 - 2 + x, 0x32 - 3 + y) === 0 ? '#' : '.';
    }
    rows.push(row);
  }

  assert.deepEqual(rows, ['.##.', '.##.', '####', '####', '####', '.##.', '.##.']);
});

test('a solid rectangle pen fills its whole box', () => {
  // Pen size 2, rectangle: 3 wide, 5 tall.
  const screens = draw(0xf0, 0x00, 0xf9, 0x12, 0xfa, 0x32, 0x32);

  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 3; x++) {
      assert.equal(at(screens, 0x32 - 1 + x, 0x32 - 2 + y), 0, `${x},${y}`);
    }
  }
});

test('a size 0 pen plots a single pixel at the given coordinate', () => {
  const screens = draw(0xf0, 0x00, 0xf9, 0x00, 0xfa, 0x32, 0x32);

  assert.equal(at(screens, 0x32, 0x32), 0);
  assert.equal(at(screens, 0x33, 0x32), WHITE);
  assert.equal(at(screens, 0x32, 0x33), WHITE);
});

test('a splatter pen consumes texture bits only inside the shape', () => {
  // Texture number 0 starts at bit 0 of the texture table, whose first bytes
  // are 0x20, 0x94: bits 00100000 10010100...
  // A size 3 circle takes rows of 2,2,4,4,4,2,2 pixels from that stream.
  const screens = draw(0xf0, 0x00, 0xf9, 0x23, 0xfa, 0x00, 0x32, 0x32);

  const rows = [];
  for (let y = 0; y < 7; y++) {
    let row = '';
    for (let x = 0; x < 4; x++) {
      row += at(screens, 0x32 - 2 + x, 0x32 - 3 + y) === 0 ? '#' : '.';
    }
    rows.push(row);
  }

  const bits = '0010000010010100';
  let i = 0;
  const widths = [2, 2, 4, 4, 4, 2, 2];
  const expected = widths.map((w, r) => {
    const pad = (4 - w) / 2;
    let row = '.'.repeat(pad);
    for (let c = 0; c < w; c++) row += bits[i++] === '1' ? '#' : '.';
    return row + '.'.repeat(pad);
  });

  assert.deepEqual(rows, expected);
});

test('a splatter pen only draws where its texture bit is set', () => {
  const solid = draw(0xf0, 0x00, 0xf9, 0x03, 0xfa, 0x32, 0x32);
  const splattered = draw(0xf0, 0x00, 0xf9, 0x23, 0xfa, 0x00, 0x32, 0x32);

  const count = (s) => s.visual.reduce((n, v) => n + (v === 0 ? 1 : 0), 0);
  assert.ok(count(splattered) > 0, 'drew something');
  assert.ok(count(splattered) < count(solid), 'drew less than the solid pen');
});

test('the end marker stops interpretation', () => {
  const screens = decodePicture(
    Uint8Array.from([0xf0, 0x01, 0xf6, 0x00, 0x00, 0x05, 0x00, 0xff, 0xf0, 0x02, 0xf8, 0x50, 0x50]),
  );

  assert.equal(at(screens, 3, 0), 1);
  assert.equal(at(screens, 80, 80), WHITE, 'commands after 0xFF ignored');
});

test('a truncated stream keeps what was drawn before the damage', () => {
  const screens = decodePicture(Uint8Array.from([0xf0, 0x01, 0xf6, 0x00, 0x00, 0x05, 0x00, 0xf6, 0x0a]));
  assert.equal(at(screens, 3, 0), 1);
});

test('unused action codes are skipped with their arguments', () => {
  const screens = draw(0xf0, 0x01, 0xfb, 0x01, 0x02, 0x03, 0xf6, 0x00, 0x00, 0x05, 0x00);
  assert.equal(at(screens, 3, 0), 1);
});

test('coordinates outside the screen are clipped away, not wrapped', () => {
  const screens = draw(0xf0, 0x01, 0xf6, 0x9f, 0x00, 0xef, 0x00);

  assert.equal(at(screens, 159, 0), 1, 'last column drawn');
  assert.equal(at(screens, 0, 1), WHITE, 'nothing wrapped onto the next row');
});

// --- PNG -------------------------------------------------------------------

/** Minimal PNG reader, enough to verify what the encoder produced. */
function decodePng(buffer) {
  assert.deepEqual([...buffer.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const chunks = {};
  let at = 8;
  while (at < buffer.length) {
    const length = buffer.readUInt32BE(at);
    const type = buffer.toString('ascii', at + 4, at + 8);
    const data = buffer.subarray(at + 8, at + 8 + length);

    // Verify the stored CRC over type + data.
    let c = -1;
    for (const byte of buffer.subarray(at + 4, at + 8 + length)) {
      c = (c ^ byte) | 0;
      for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) | 0 : c >>> 1;
    }
    assert.equal((c ^ -1) >>> 0, buffer.readUInt32BE(at + 8 + length), `${type} CRC`);

    chunks[type] = chunks[type] ? Buffer.concat([chunks[type], data]) : data;
    at += 12 + length;
  }

  const width = chunks.IHDR.readUInt32BE(0);
  const height = chunks.IHDR.readUInt32BE(4);
  const raw = inflateSync(chunks.IDAT);

  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    assert.equal(raw[y * (width + 1)], 0, 'filter type None');
    pixels.set(raw.subarray(y * (width + 1) + 1, (y + 1) * (width + 1)), y * width);
  }

  return { width, height, bitDepth: chunks.IHDR[8], colourType: chunks.IHDR[9], palette: chunks.PLTE, pixels };
}

test('encodes an indexed PNG that round-trips', () => {
  const pixels = Uint8Array.from([0, 1, 2, 3, 15, 4]);
  const png = encodeIndexedPng({ width: 3, height: 2, pixels, palette: EGA_PALETTE });
  const decoded = decodePng(png);

  assert.equal(decoded.width, 3);
  assert.equal(decoded.height, 2);
  assert.equal(decoded.bitDepth, 8);
  assert.equal(decoded.colourType, 3);
  assert.deepEqual([...decoded.pixels], [...pixels]);
  assert.deepEqual([...decoded.palette.subarray(0, 3)], [0, 0, 0]);
  assert.deepEqual([...decoded.palette.subarray(45, 48)], [255, 255, 255]);
});

test('rejects a pixel buffer that does not match the dimensions', () => {
  assert.throws(
    () => encodeIndexedPng({ width: 4, height: 4, pixels: new Uint8Array(3), palette: EGA_PALETTE }),
    /expected 16/,
  );
});

test('scalePixels replicates whole pixels', () => {
  const { width, height, pixels } = scalePixels(Uint8Array.from([1, 2]), 2, 1, 2, 3);

  assert.equal(width, 4);
  assert.equal(height, 3);
  assert.deepEqual([...pixels], [1, 1, 2, 2, 1, 1, 2, 2, 1, 1, 2, 2]);
});

test('scalePixels returns the input unchanged at 1:1', () => {
  const pixels = Uint8Array.from([1, 2, 3, 4]);
  assert.equal(scalePixels(pixels, 2, 2, 1, 1).pixels, pixels);
});
