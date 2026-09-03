import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Display } from '../src/render/display.ts';
import { CHAR_HEIGHT, FIRST_GLYPH, glyph, hasGlyph, LAST_GLYPH } from '../src/render/font.ts';
import {
  COLUMNS,
  drawChar,
  drawText,
  drawWindow,
  layOutWindow,
  WINDOW_BORDER_COLOUR,
  DEFAULT_BACKGROUND_COLOUR,
  DEFAULT_TEXT_COLOUR,
  ROWS,
  TextLayer,
  wrapText,
} from '../src/render/text.ts';

// --- The font --------------------------------------------------------------

test('the font covers printable ASCII and nothing else', () => {
  assert.equal(FIRST_GLYPH, 0x20);
  assert.equal(LAST_GLYPH, 0x7e);
  assert.equal(hasGlyph(0x20), true);
  assert.equal(hasGlyph(0x7e), true);
  assert.equal(hasGlyph(0x1f), false);
  assert.equal(hasGlyph(0x7f), false);
});

test('a character the font does not have draws as a gap, not as another letter', () => {
  assert.deepEqual([...glyph(0x00)], new Array(CHAR_HEIGHT).fill(0));
  assert.deepEqual([...glyph(0xff)], new Array(CHAR_HEIGHT).fill(0));
});

test('space is blank and every other glyph has ink', () => {
  // Catches a whole row of the table being shifted: a blank glyph in the
  // middle of the alphabet is the shape that mistake takes.
  assert.deepEqual([...glyph(0x20)], new Array(CHAR_HEIGHT).fill(0));

  for (let code = 0x21; code <= LAST_GLYPH; code++) {
    const rows = glyph(code);
    assert.ok(
      rows.some((row) => row !== 0),
      `'${String.fromCharCode(code)}' (0x${code.toString(16)}) is blank`,
    );
  }
});

test('the letters that should be symmetric are', () => {
  // A cheap check with real reach: one wrong byte in any of these shows up as
  // an asymmetry, which is easy to assert and impossible to fake.
  //
  // The symmetry is within each glyph's own width, not within the 8-pixel
  // cell. The font's letters are six pixels wide with the rest of the cell
  // left as the gap between characters, so the axis has to be found from the
  // glyph rather than assumed to be the middle of the byte.
  // Not the zero: it carries a diagonal slash so it cannot be mistaken for an
  // O, and the slash is the point of it.
  for (const character of 'AHIMOTUVWXY8') {
    const rows = [...glyph(character.charCodeAt(0))];

    let left = 8;
    let right = -1;
    for (const row of rows) {
      for (let column = 0; column < 8; column++) {
        if (row & (0x80 >> column)) {
          left = Math.min(left, column);
          right = Math.max(right, column);
        }
      }
    }

    rows.forEach((row, index) => {
      for (let column = left; column <= right; column++) {
        const mirrored = left + right - column;
        assert.equal(
          (row & (0x80 >> column)) !== 0,
          (row & (0x80 >> mirrored)) !== 0,
          `'${character}' row ${index} is not symmetric about its own width`,
        );
      }
    });
  }
});

test('the underscore is a full-width rule on the bottom row', () => {
  const rows = [...glyph('_'.charCodeAt(0))];
  assert.deepEqual(rows.slice(0, 7), new Array(7).fill(0));
  assert.equal(rows[7], 0xff);
});

test('the letters and digits keep a gap on the right, so words stay readable', () => {
  // Not true of every glyph -- the asterisk and the underscore deliberately
  // run the full width of the cell -- but a letter that did would run into the
  // next one.
  for (const character of 'ABCXYZabcxyz0189') {
    for (const row of glyph(character.charCodeAt(0))) {
      assert.equal(row & 1, 0, `'${character}' reaches the last column`);
    }
  }
});

// --- Drawing ---------------------------------------------------------------

test('a character is drawn into its cell, in the colours asked for', () => {
  const display = new Display();
  display.fill(5);
  drawChar(display, '_'.charCodeAt(0), 2, 3, 1, 9);

  // The underscore's bottom row is solid, so the whole cell row is foreground.
  const bottom = (3 * 8 + 7) * 320 + 2 * 8;
  for (let x = 0; x < 8; x++) assert.equal(display.pixels[bottom + x], 1);

  // And the row above it is all background, not the fill it replaced.
  const above = (3 * 8 + 6) * 320 + 2 * 8;
  for (let x = 0; x < 8; x++) assert.equal(display.pixels[above + x], 9);
});

test('text is clipped at the right edge rather than wrapping round', () => {
  const display = new Display();
  drawText(display, 'AB', COLUMNS - 1, 0, 1, 0);

  // The A lands in the last cell; the B has nowhere to go and must not appear
  // at the start of the next row.
  const nextRowStart = 1 * 8 * 320;
  for (let i = 0; i < 8 * 320; i++) {
    assert.equal(display.pixels[nextRowStart + i], 0, 'nothing spilled onto the next row');
  }
});

// --- Wrapping --------------------------------------------------------------

test('wrapping breaks on spaces and never exceeds the width', () => {
  const lines = wrapText('the quick brown fox jumps over the lazy dog', 10);
  for (const line of lines) assert.ok(line.length <= 10, `"${line}" is too long`);
  assert.equal(lines.join(' '), 'the quick brown fox jumps over the lazy dog');
});

test("the author's own line breaks are kept", () => {
  assert.deepEqual(wrapText('one\ntwo', 40), ['one', 'two']);
  assert.deepEqual(wrapText('one\n\ntwo', 40), ['one', '', 'two'], 'a blank line survives');
});

test('a word longer than the line is broken rather than left to overflow', () => {
  // Messages substitute values whose length is unknown when the text is
  // written, so this is a real case and not a pathological one.
  const lines = wrapText('short aaaaaaaaaaaaaaa end', 6);
  for (const line of lines) assert.ok(line.length <= 6, `"${line}" is too long`);
  assert.equal(lines.join('').includes('aaaaaaaaaaaaaaa'), true, 'no characters lost');
});

// --- Windows ---------------------------------------------------------------

test('a window is sized to its text and centred', () => {
  const window = layOutWindow('hello');
  assert.deepEqual(window.lines, ['hello']);
  assert.equal(window.column, Math.floor((COLUMNS - 5) / 2));
});

test('a window asked for a position off the screen is pulled back on', () => {
  const window = layOutWindow('a fairly long line of text', { column: 38 });
  assert.ok(window.column + 26 <= COLUMNS, 'the whole width fits');
  assert.ok(window.column >= 0);
});

test('a window tall enough to reach the bottom still starts below the status line', () => {
  const window = layOutWindow(new Array(40).fill('line').join('\n'));
  assert.ok(window.row >= 1, 'the status line is not covered');
});

test('a window rules its border inside a padded box, as the original does', () => {
  const display = new Display();
  display.fill(5);
  const window = layOutWindow('hi', { column: 10, row: 10, foreground: 0, background: 15 });
  drawWindow(display, window);

  assert.equal(window.border, WINDOW_BORDER_COLOUR, 'red unless a caller says otherwise');

  const at = (x: number, y: number) => display.pixels[y * 320 + x];
  const textLeft = 10 * 8;
  const textTop = 10 * 8;

  // Straight up from the top-left of the text: padding, then the ruled line,
  // then the margin outside it, then the picture.
  assert.equal(at(textLeft, textTop - 1), 15, 'the padding the text sits in');
  assert.equal(at(textLeft, textTop - 6), WINDOW_BORDER_COLOUR, 'the line');
  assert.equal(at(textLeft, textTop - 8), 15, 'background outside the line as well as inside');
  assert.equal(at(textLeft, textTop - 9), 5, 'and the picture beyond the box');

  // And exactly the same across: the padding above and below matches the
  // padding at the sides, which is the point of measuring it in pixels.
  assert.equal(at(textLeft - 1, textTop), 15, 'padding to the left of the text');
  assert.equal(at(textLeft - 6, textTop), WINDOW_BORDER_COLOUR, 'the line down the side');
  assert.equal(at(textLeft - 8, textTop), 15, 'background outside it');
  assert.equal(at(textLeft - 9, textTop), 5, 'and the picture beyond');
});

test('a message box is white whatever the text attribute has been set to', () => {
  // set.text.attribute colours text written into cells, not message boxes. A
  // game that leaves it on white-on-black asked for that on the status line,
  // not for a black window.
  const display = new Display();
  const window = layOutWindow('hi', { column: 10, row: 10 });

  assert.equal(window.background, DEFAULT_BACKGROUND_COLOUR);
  assert.equal(window.foreground, DEFAULT_TEXT_COLOUR);

  drawWindow(display, window);
  assert.equal(display.pixels[(10 * 8 - 1) * 320 + 10 * 8], DEFAULT_BACKGROUND_COLOUR);
});

// --- The text layer --------------------------------------------------------

test('unwritten cells are transparent, so the picture shows through', () => {
  const layer = new TextLayer();
  const display = new Display();
  display.fill(7);

  layer.write('X', 0, 5, 1, 0);
  layer.draw(display);

  // The cell next to the X was never written and keeps the picture's colour.
  assert.equal(display.pixels[5 * 8 * 320 + 8], 7);
});

test('clearing to a colour writes that colour; erasing makes cells transparent', () => {
  const layer = new TextLayer();

  layer.write('hello', 0, 22, 1, 0);
  assert.equal(layer.rowIsEmpty(22), false);

  layer.fillRows(22, 22, 4);
  assert.equal(layer.rowIsEmpty(22), false, 'filled cells are still written cells');
  assert.equal(layer.background[TextLayer.index(0, 22)], 4);

  layer.erase(0, 22, COLUMNS - 1, 22);
  assert.equal(layer.rowIsEmpty(22), true, 'now the picture shows through again');
});

test('writing off the edges is clipped, not wrapped', () => {
  const layer = new TextLayer();
  layer.write('overflowing', COLUMNS - 2, 4, 1, 0);

  assert.equal(layer.chars[TextLayer.index(COLUMNS - 1, 4)], 'v'.charCodeAt(0));
  assert.equal(layer.rowIsEmpty(5), true, 'nothing reached the next row');

  // A write past the bottom of the grid has nowhere to land, so it must leave
  // the layer exactly as it was rather than wrapping round to the top.
  const before = layer.chars.slice();
  layer.write('ignored', 0, ROWS + 5, 1, 0);
  assert.deepEqual([...layer.chars], [...before], 'a write off the grid changed nothing');
});
