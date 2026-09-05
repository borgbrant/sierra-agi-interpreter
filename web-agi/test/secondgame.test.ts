/**
 * A second AGI game, which is what M18 exists for.
 *
 * `agi-extract/data` holds a directory per game. `lsl1` is the one copied into
 * `public/game` and every other test runs against it; `kq1` is King's Quest I,
 * an AGI 2.917 game the engine was never pointed at while it was being built.
 * Neither is this project's to redistribute, so these tests skip when the
 * directory is not there -- the same rule the Hercules capture tests follow.
 *
 * What they hold is the claim M18 is about: that an engine with no
 * game-specific code in it runs a game it has never seen, and that what it
 * takes from the interpreter beside the game comes from *that* game's copy.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildHandlers } from '../src/engine/commands/index.ts';
import { Cycle } from '../src/engine/cycle.ts';
import { MessageWindow } from '../src/engine/interaction.ts';
import { Machine } from '../src/engine/machine.ts';
import { VAR } from '../src/engine/state.ts';
import { keyNamed } from '../src/input/keyboard.ts';
import { decodeLogic } from '../src/logic/reader.ts';
import { parseLogic } from '../src/logic/resource.ts';
import { buildFrame } from '../src/engine/present.ts';
import { Renderer } from '../src/render/renderer.ts';
import { findTables, readInterpreterTables } from '../src/render/agidata.ts';
import { CGA_TABLES_AT } from '../src/render/cgatables.ts';
import { HGC_DITHER, HGC_DITHER_OFFSET } from '../src/render/hgcdither.ts';
import { ResourceManager } from '../src/resources/manager.ts';
import { readInterpreterVersion } from '../src/resources/interpreter.ts';
import { parseObjectFile } from '../src/resources/objects.ts';
import { Vocabulary } from '../src/resources/words.ts';
import { DiskSource } from './helpers/disk-source.ts';

const KQ1 = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'agi-extract',
  'data',
  'kq1',
);

const present = existsSync(KQ1);
const skip = present ? false : 'agi-extract/data/kq1 is not here';

/** Where King's Quest I keeps what Larry keeps 436 bytes lower. */
const KQ1_TABLES_AT = 0x1d2c;

async function openGame() {
  const source = await DiskSource.open(KQ1);
  const resources = await ResourceManager.open(source);
  await resources.preload();
  return { source, resources };
}

test('a second game’s resources open and decode', { skip }, async () => {
  const { source, resources } = await openGame();

  const objects = parseObjectFile((await source.read('OBJECT'))!);
  const vocabulary = Vocabulary.parse((await source.read('WORDS.TOK'))!);
  assert.ok(objects.items.length > 0);
  assert.ok(vocabulary !== undefined);

  const interpreter = readInterpreterVersion((await source.read('AGIDATA.OVL'))!);
  assert.equal(interpreter.version, '2.917', 'a different interpreter from the bundled game');
  assert.equal(interpreter.read, true);

  // Every script, and every jump landing on an instruction boundary -- the
  // same whole-game check M3 used to validate the opcode table.
  let decoded = 0;
  for (let id = 0; id < 256; id++) {
    if (!resources.isPresent('logic', id)) continue;

    const logic = parseLogic(resources.loadSync('logic', id));
    const instructions = decodeLogic(logic.bytecode, interpreter.commandCount);
    const boundaries = new Set(instructions.map((i) => i.at));
    boundaries.add(logic.bytecode.length);

    for (const instruction of instructions) {
      if (instruction.kind === 'action') continue;
      assert.ok(
        boundaries.has(instruction.target),
        `logic ${id}: a jump to ${instruction.target} is not an instruction`,
      );
    }
    decoded++;
  }

  assert.ok(decoded > 50, `only ${decoded} scripts`);
});

test('a second game’s tables are read from its own copy', { skip }, async () => {
  const { source } = await openGame();
  const bytes = (await source.read('AGIDATA.OVL'))!;

  const sites = findTables(bytes);

  assert.equal(sites?.fill, KQ1_TABLES_AT, 'not where the bundled game keeps them');
  assert.equal(sites!.fill - CGA_TABLES_AT.fill, 436);
  assert.deepEqual(readInterpreterTables(bytes).sites, sites);
});

test('what lies at the old offset in it is refused', { skip }, async () => {
  const { source } = await openGame();
  const bytes = (await source.read('AGIDATA.OVL'))!;

  // The defect that started M18, stated as what it is: the bytes this engine
  // used to read as a dither table are a printf format string, and the table
  // they would make has black at 33/64 and white at 0/64.
  const atTheOldOffset = [...bytes.subarray(HGC_DITHER_OFFSET, HGC_DITHER_OFFSET + 8)]
    .map((b) => String.fromCharCode(b))
    .join('');
  assert.equal(atTheOldOffset, 'store in');

  const tables = readInterpreterTables(bytes);
  assert.notDeepEqual(
    tables.hercules.map((rows) => rows.slice()),
    Array.from({ length: 16 }, (_, colour) =>
      [...bytes.subarray(HGC_DITHER_OFFSET + colour * 8, HGC_DITHER_OFFSET + colour * 8 + 8)]),
    'the string is not what the driver got',
  );

  // And what it did get is a table: black draws nothing, white draws all 64.
  assert.deepEqual(tables.hercules[0], HGC_DITHER[0]);
  assert.deepEqual(tables.hercules[15], HGC_DITHER[15]);
});

test('a second game runs, and its ego walks', { skip }, async () => {
  const { source, resources } = await openGame();
  const objects = parseObjectFile((await source.read('OBJECT'))!);
  const vocabulary = Vocabulary.parse((await source.read('WORDS.TOK'))!);
  const interpreter = readInterpreterVersion((await source.read('AGIDATA.OVL'))!);

  const machine = new Machine({
    resources,
    objects,
    vocabulary,
    commandCount: interpreter.commandCount,
  });
  machine.setHandlers(buildHandlers());

  const cycle = new Cycle(machine);
  cycle.start(0);

  const room = () => machine.state.getVar(VAR.CURRENT_ROOM);
  // Enter, both to dismiss what the game waits on and, every so often, because
  // its title screen sits there until a key is pressed. This is a player being
  // impatient rather than a script: nothing here knows anything about KQ1.
  const step = (cycles: number) => {
    for (let i = 0; i < cycles; i++) {
      if (machine.pending instanceof MessageWindow) machine.handleKey(keyNamed('Enter'));
      if (!cycle.runOnce()) {
        if (!machine.pending) break;
        machine.handleKey(keyNamed('Enter'));
      }
      if (i % 100 === 99) machine.handleKey(keyNamed('Enter'));
    }
  };

  step(400);

  assert.equal(machine.stopped, false, 'the game did not stop itself');
  assert.equal(room(), 1, 'past the title screen and into the first room');

  // Something was drawn: an all-black screen is what a game that loaded and
  // did nothing looks like.
  let drawn = 0;
  for (const pixel of machine.screens.visual) if (pixel !== 0) drawn++;
  assert.ok(drawn > machine.screens.visual.length / 4, `only ${drawn} pixels drawn`);

  // And the player can move, which is the whole of M5 and M17 holding for a
  // game neither was written against.
  const ego = machine.viewTable.ego;
  const walked = new Set<string>();
  for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
    const from = `${ego.x},${ego.y}`;
    for (let i = 0; i < 25; i++) {
      machine.handleKey(keyNamed(key));
      cycle.runOnce();
    }
    if (`${ego.x},${ego.y}` !== from) walked.add(key);
    machine.handleKey(keyNamed(key));
    step(3);
  }

  assert.equal(walked.size, 4, `ego moved in ${[...walked].join(', ') || 'no direction'}`);

  // Nothing it reached is missing. A stub here is not a failure of this test
  // so much as the list of what a third game would need, so it is named.
  assert.deepEqual([...machine.stubs.keys()], [], 'commands reached but not implemented');
});

test('a second game’s title screen writes white on black', { skip }, async () => {
  // King's Quest I's credits scroll, and the defect it found. Logic 83 draws
  // them with `display.v` and never calls `set.text.attribute` -- the game does
  // that once, in logic 53, long after this screen -- so what they are written
  // in is the interpreter's default. This engine had that default as a message
  // window's black on white, which laid a white box over a scroll the picture
  // paints black.
  const { source, resources } = await openGame();
  const objects = parseObjectFile((await source.read('OBJECT'))!);
  const vocabulary = Vocabulary.parse((await source.read('WORDS.TOK'))!);
  const interpreter = readInterpreterVersion((await source.read('AGIDATA.OVL'))!);

  const machine = new Machine({
    resources,
    objects,
    vocabulary,
    commandCount: interpreter.commandCount,
  });
  machine.setHandlers(buildHandlers());

  const cycle = new Cycle(machine);
  cycle.start(0);

  // No keys: the title screen waits for one, and the credits are what it shows
  // while it waits.
  for (let i = 0; i < 250 && !machine.pending; i++) cycle.runOnce();

  assert.equal(machine.state.getVar(VAR.CURRENT_ROOM), 83, 'still on the title screen');

  const layer = machine.textLayer;
  let written = 0;
  for (let cell = 0; cell < layer.chars.length; cell++) {
    if (layer.chars[cell] === 0) continue;
    written++;
    assert.equal(layer.foreground[cell], 15, `cell ${cell} is not white`);
    assert.equal(layer.background[cell], 0, `cell ${cell} is not on black`);
  }

  assert.ok(written > 50, `only ${written} cells were written`);
});

test('a second game’s title credits stay inside the scroll they are drawn into', { skip }, async () => {
  // The picture's row, end to end. King's Quest I's title screen asks for the
  // play window at row 0 and then draws thirteen rows of credits into a scroll
  // its own picture paints black. With the picture pinned to row 1 the top row
  // of credits landed on the banner above the scroll and cut a black band
  // through it.
  //
  // Measured rather than eyeballed: render the frame, render it again with the
  // text taken away, and count the picture pixels the text covered that were
  // not black to begin with.
  const { source, resources } = await openGame();
  const objects = parseObjectFile((await source.read('OBJECT'))!);
  const vocabulary = Vocabulary.parse((await source.read('WORDS.TOK'))!);
  const interpreter = readInterpreterVersion((await source.read('AGIDATA.OVL'))!);

  const machine = new Machine({
    resources,
    objects,
    vocabulary,
    commandCount: interpreter.commandCount,
  });
  machine.setHandlers(buildHandlers());

  const cycle = new Cycle(machine);
  cycle.start(0);
  for (let i = 0; i < 250 && !machine.pending; i++) cycle.runOnce();

  assert.equal(machine.layout.minPrintRow, 0, 'the game asked for the play window at the top');

  const renderer = new Renderer();
  renderer.render(buildFrame(machine, 'visual'));
  const withText = renderer.display.pixels.slice();

  const chars = machine.textLayer.chars.slice();
  machine.textLayer.chars.fill(0);
  renderer.render(buildFrame(machine, 'visual'));
  const picture = renderer.display.pixels.slice();
  machine.textLayer.chars.set(chars);

  let covered = 0;
  for (let at = 0; at < picture.length; at++) {
    if (picture[at] !== 0 && withText[at] !== picture[at]) covered++;
  }

  assert.equal(covered, 0, `${covered} picture pixels were painted over by text`);
});

test('a second game’s title keeps the lines it prints below the picture', { skip }, async () => {
  // The copyright and "Press any key to continue.", which logic 83 displays on
  // rows 22 and 24 *before* it calls show.pic. They were thrown away while
  // show.pic cleared all twenty-five rows rather than the twenty-one the
  // picture covers.
  const { source, resources } = await openGame();
  const objects = parseObjectFile((await source.read('OBJECT'))!);
  const vocabulary = Vocabulary.parse((await source.read('WORDS.TOK'))!);
  const interpreter = readInterpreterVersion((await source.read('AGIDATA.OVL'))!);

  const machine = new Machine({
    resources,
    objects,
    vocabulary,
    commandCount: interpreter.commandCount,
  });
  machine.setHandlers(buildHandlers());

  const cycle = new Cycle(machine);
  cycle.start(0);
  for (let i = 0; i < 60 && !machine.pending; i++) cycle.runOnce();

  const textAt = (row: number) =>
    [...machine.textLayer.chars.subarray(row * 40, row * 40 + 40)]
      .map((code) => (code ? String.fromCharCode(code) : ' '))
      .join('')
      .trim();

  assert.match(textAt(22), /copyright SIERRA/);
  assert.match(textAt(24), /Press any key/);
});
