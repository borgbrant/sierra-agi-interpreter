/**
 * The display seam.
 *
 * The point of this milestone is a change that shows nothing on screen, so
 * these tests are about the shape of the seam rather than about pixels: that a
 * frame says what to draw without saying how big anything is, that a second
 * driver can therefore answer at a different size with a different cell, and
 * that swapping drivers repaints in full rather than inheriting a state.
 *
 * The EGA output itself is held still by the golden tests, which this
 * deliberately does not duplicate.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PICTURE_ROW } from '../src/engine/layout.ts';
import { Display } from '../src/render/display.ts';
import type { DisplayDriver, DisplayMode } from '../src/render/drivers/driver.ts';
import { EgaDriver } from '../src/render/drivers/ega.ts';
import { createDriver } from '../src/render/drivers/index.ts';
import { Frame } from '../src/render/frame.ts';
import { Renderer } from '../src/render/renderer.ts';
import { PICTURE_HEIGHT, PICTURE_WIDTH } from '../src/render/screens.ts';
import { type CellMetrics, layOutWindow, TextLayer } from '../src/render/text.ts';

/** A frame with one of every kind of layer in it. */
function everything(): Frame {
  const cells = new TextLayer();
  cells.write('cells', 3, 4, 1, 0);

  return new Frame()
    .fill(2)
    .picture(new Uint8Array(PICTURE_WIDTH * PICTURE_HEIGHT).fill(5), PICTURE_ROW)
    .cells(cells)
    .text('status', 0, 0, 0, 15)
    .rows(24, 24, 1)
    .window(layOutWindow('a message', { column: 5, row: 5 }));
}

test('a driver reports the mode it was asked for', () => {
  for (const mode of ['ega', 'cga', 'hercules'] as DisplayMode[]) {
    assert.equal(createDriver(mode).mode, mode, mode);
  }
});

test('EGA is 320x200 with square pixels and sixteen colours', () => {
  const driver = new EgaDriver();
  assert.equal(driver.display.width, 320);
  assert.equal(driver.display.height, 200);
  assert.equal(driver.pixelAspect, 1, 'the 160-wide picture has already been doubled');
  assert.equal(driver.display.palette.length / 3, 16);
  assert.equal(driver.monochrome, false);
});

test('a driver keeps nothing between frames, so switching repaints in full', () => {
  // What makes a mid-room mode change possible: the frame is the whole input,
  // so a driver that has drawn something else is not a different driver.
  const fresh = new EgaDriver();
  fresh.draw(everything());

  const used = new EgaDriver();
  used.draw(new Frame().fill(9).text('something else entirely', 0, 12, 4, 7));
  used.draw(everything());

  assert.deepEqual(used.display.pixels, fresh.display.pixels);
});

test('the renderer swaps drivers, and says when it did not have to', () => {
  const renderer = new Renderer('ega');
  const first = renderer.driver;

  assert.equal(renderer.setMode('ega'), false, 'the same mode is not a swap');
  assert.equal(renderer.driver, first);

  assert.equal(renderer.setMode('hercules'), true);
  assert.equal(renderer.driver.mode, 'hercules');
  assert.notEqual(renderer.driver, first);
});

/**
 * A driver at Hercules' size, with a cell of its own.
 *
 * The interface was designed against the mode that moves the most -- 720x348,
 * two colours, and an 8x12 font in a cell wider than its glyph -- and this is
 * what says it can carry that. It is not the Hercules driver of M13: nothing
 * here is a claim about what a Hercules card looked like, only that a frame the
 * engine describes can be answered at another size.
 */
class WideDriver implements DisplayDriver {
  readonly mode: DisplayMode = 'hercules';
  readonly display = new Display(720, 348, new Uint8Array([0, 0, 0, 255, 255, 255]));
  readonly pixelAspect = 720 / 348 / (4 / 3);
  readonly monochrome = true;

  /** 40 columns across 720 pixels is an 18-wide cell, holding an 8x12 glyph. */
  readonly cell: CellMetrics = {
    width: 18,
    height: 12,
    glyph: (code) => (code === 0x20 ? new Uint8Array(12) : new Uint8Array(12).fill(0xff)),
  };

  draw(frame: Frame): void {
    for (const layer of frame.layers) {
      switch (layer.kind) {
        case 'fill':
          this.display.fill(layer.colour);
          break;
        case 'picture':
          // 160 wide becomes 640 and 168 tall becomes 336: the same picture,
          // stretched to a screen the engine has never heard of.
          this.display.drawScreen(layer.screen, layer.row * this.cell.height, 4, 2);
          break;
        case 'cells':
          layer.cells.draw(this.display, this.cell);
          break;
        default:
          // The rest is not what this test is asking about.
          break;
      }
    }
  }

  toRgba(into?: Uint8ClampedArray): Uint8ClampedArray {
    return this.display.toRgba(into);
  }
}

test('the same frame draws at another size, with another cell', () => {
  const frame = everything();

  const wide = new WideDriver();
  wide.draw(frame);

  assert.equal(wide.display.pixels.length, 720 * 348);
  assert.notEqual(wide.pixelAspect, 1, 'a 720x348 buffer is not square-pixelled');

  // The picture landed where the wide driver put it, not where EGA would have.
  const pictureRow = wide.cell.height * 720;
  assert.equal(wide.display.pixels[pictureRow], 5, 'the picture starts under the status row');
  assert.equal(wide.display.pixels[pictureRow + 639], 5, 'and is 640 pixels across');
  assert.equal(wide.display.pixels[pictureRow + 640], 2, 'with the fill beside it');

  // A cell 12 rows tall means the text layer's row 4 is 48 pixels down, which
  // is a row EGA's 8-pixel cells would have called row 6.
  const cellRow = 4 * 12;
  assert.equal(wide.display.pixels[cellRow * 720 + 3 * 18], 1, 'the cells follow the cell size');
});

test('a two-colour palette survives being handed a fifteen', () => {
  // The engine writes the colour numbers the game was drawn for. A driver with
  // fewer colours has to answer for all sixteen of them rather than read past
  // the end of its palette.
  const wide = new WideDriver();
  wide.display.fill(15);

  const rgba = wide.toRgba();
  assert.equal(rgba.length, 720 * 348 * 4);
  assert.ok(
    [...rgba.subarray(0, 4)].every((value) => Number.isFinite(value)),
    'every channel has a value',
  );
});
