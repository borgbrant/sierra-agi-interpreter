/**
 * A CGA on a composite monitor.
 *
 * The claim this mode rests on is that the interpreter's own 640x200 table is
 * a table of *artefact colours*: four CGA pixels are one NTSC colour cycle, and
 * the table gives every AGI colour a four-pixel pattern of its own. These tests
 * hold what that predicts, and record what it does not.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { hasInputRow, MONITOR, monitorTypeFor } from '../src/engine/hardware.ts';
import { CGA_TABLES } from '../src/render/cgatables.ts';
import { PALETTE_RGB } from '../src/render/display.ts';
import { CGA_MONO_HEIGHT, CGA_MONO_WIDTH, CgaMonoDriver } from '../src/render/drivers/cgamono.ts';
import {
  CgaCompositeDriver,
  COMPOSITE_CHROMA_TAPS,
  compositeColour,
} from '../src/render/drivers/composite.ts';
import { createDriver, hasMonoVariant } from '../src/render/drivers/index.ts';
import { Frame } from '../src/render/frame.ts';
import { PICTURE_HEIGHT, PICTURE_WIDTH } from '../src/render/screens.ts';

/** Hue in degrees, or null for something too grey to have one. */
function hue(rgb: readonly number[]): number | null {
  const [r, g, b] = rgb.map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 0.06) return null;

  let h = 0;
  if (max === r) h = ((g - b) / (max - min)) % 6;
  else if (max === g) h = (b - r) / (max - min) + 2;
  else h = (r - g) / (max - min) + 4;
  return (((h * 60) % 360) + 360) % 360;
}

/** How far apart two hues are, in degrees, the short way round. */
function apart(a: number, b: number): number {
  return Math.abs(((((a - b) % 360) + 540) % 360) - 180);
}

const palette = (colour: number) => [0, 1, 2].map((c) => PALETTE_RGB[colour * 3 + c]!);

test('the card is the two-colour one, and only the monitor differs', () => {
  const composite = new CgaCompositeDriver();
  const mono = new CgaMonoDriver();

  assert.equal(composite.display.width, CGA_MONO_WIDTH);
  assert.equal(composite.display.height, CGA_MONO_HEIGHT);
  assert.equal(composite.cell.width, mono.cell.width);
  assert.equal(composite.pixelAspect, mono.pixelAspect);

  // The same frame, and the same pixels underneath.
  const screen = new Uint8Array(PICTURE_WIDTH * PICTURE_HEIGHT);
  for (let i = 0; i < screen.length; i++) screen[i] = i % 16;
  const frame = new Frame().fill(0).picture(screen, 1);

  composite.draw(frame);
  mono.draw(frame);

  assert.deepEqual([...composite.display.pixels], [...mono.display.pixels]);
});

test('black and white come through the wire unchanged', () => {
  assert.deepEqual(compositeColour(0), [0, 0, 0]);
  assert.deepEqual(compositeColour(15), [255, 255, 255]);
});

test('the two greys are the one grey a composite monitor can show', () => {
  // 0101 and 1010 differ only in phase, and phase is what a composite monitor
  // reads as hue -- but at twice the subcarrier there is no hue to read. Both
  // land on the same mid grey, which is a loss this mode cannot avoid and the
  // original could not either.
  const light = compositeColour(7);
  const dark = compositeColour(8);

  assert.equal(hue(light), null, `light grey came out ${light.join(',')}`);
  assert.equal(hue(dark), null, `dark grey came out ${dark.join(',')}`);
  for (let c = 0; c < 3; c++) assert.ok(Math.abs(light[c]! - dark[c]!) <= 8);
});

test('one bit is a dark colour and three bits a light one, without exception', () => {
  // The structure that makes the table a table of artefact colours. Luminance
  // is how many of the four pixels are lit, so the four single-bit patterns are
  // AGI's dark hues -- blue, green, red, brown -- and the four three-bit ones
  // are light colours. Not pair by pair: a three-bit pattern is the complement
  // of a one-bit pattern, so it carries the *opposite* hue. What holds is the
  // separation, and it is complete.
  const luma = (colour: number) => {
    const rgb = compositeColour(colour);
    return (rgb[0]! + rgb[1]! + rgb[2]!) / 3;
  };

  const oneBit = [1, 2, 4, 6].map(luma);
  const threeBit = [9, 11, 12, 14].map(luma);

  assert.ok(
    Math.min(...threeBit) > Math.max(...oneBit),
    `dimmest light ${Math.min(...threeBit).toFixed(0)} against ` +
      `brightest dark ${Math.max(...oneBit).toFixed(0)}`,
  );
});

test('most of the sixteen decode to the hue the palette gives them', () => {
  // The measurement the mode is justified by, and the one it is honest about.
  // Eight of the twelve chromatic colours land within 30 degrees of their own
  // hue, and the mean error is 27. A demodulator that had nothing to do with
  // these patterns would average 90.
  let within = 0;
  let total = 0;
  let counted = 0;
  let worst = { colour: -1, off: 0 };

  for (let colour = 0; colour < 16; colour++) {
    const want = hue(palette(colour));
    const got = hue(compositeColour(colour));
    if (want === null || got === null) continue;

    const off = apart(got, want);
    total += off;
    counted++;
    if (off <= 30) within++;
    if (off > worst.off) worst = { colour, off };
  }

  assert.equal(counted, 12, 'twelve of the sixteen have a hue at all');
  assert.ok(within >= 8, `only ${within} of 12 within 30 degrees`);
  assert.ok(total / counted < 30, `mean hue error ${(total / counted).toFixed(1)} degrees`);

  // Recorded rather than asserted away: one pattern is a long way out, and it
  // is the same one every time.
  assert.equal(worst.colour, 13, 'light magenta is the outlier');
});

test('no two colours are the same, except the pair that cannot differ', () => {
  const seen = new Map<string, number[]>();
  for (let colour = 0; colour < 16; colour++) {
    const key = compositeColour(colour).map((v) => Math.round(v / 8)).join(',');
    seen.set(key, [...(seen.get(key) ?? []), colour]);
  }

  const collisions = [...seen.values()].filter((group) => group.length > 1);
  assert.deepEqual(collisions, [[7, 8]], 'only the two greys collide');
});

test('the colour of a pixel depends on its neighbours, which is what fringing is', () => {
  // A real composite picture is soft in colour and sharp in luminance, because
  // the chroma filter is wider than one pixel. A boundary between two colours
  // is therefore not instant -- and a driver that decoded each four-pixel group
  // on its own would be a palette lookup wearing a costume.
  const driver = new CgaCompositeDriver();
  const { pixels, width } = driver.display;

  // White on the left, black on the right.
  for (let x = 0; x < width; x++) pixels[x] = x < width / 2 ? 1 : 0;

  const rgba = driver.toRgba();
  const at = (x: number) => [rgba[x * 4]!, rgba[x * 4 + 1]!, rgba[x * 4 + 2]!];

  const edge = width / 2;
  assert.equal(hue(at(edge - 20)), null, 'white is white away from the edge');
  assert.notEqual(hue(at(edge)), null, 'and there is colour at the edge itself');
  assert.ok(COMPOSITE_CHROMA_TAPS > 4, 'which needs a filter wider than one cycle');
});

test('the mode is a CGA to the scripts, and keeps its input row', () => {
  assert.equal(monitorTypeFor('composite'), MONITOR.CGA);
  assert.equal(monitorTypeFor('composite'), monitorTypeFor('cga'));
  assert.equal(hasInputRow('composite'), true);
});

test('the game asking for mono changes nothing on a screen already in it', () => {
  // `toggle.monitor` puts a CGA into 640x200. This mode is there already --
  // that is what it is for -- so the request reaches the scripts and stops.
  assert.equal(hasMonoVariant('composite'), false);

  const asked = createDriver('composite', { monochrome: true, cgaTables: CGA_TABLES });
  const not = createDriver('composite', { monochrome: false, cgaTables: CGA_TABLES });

  assert.equal(asked.mode, 'composite');
  assert.equal(asked.display.width, not.display.width);
});
