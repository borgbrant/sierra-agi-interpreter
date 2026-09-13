/**
 * A third AGI game: Police Quest I, and the interpreter the version table had
 * never been asked about.
 *
 * `secondgame.test.ts` made the claim that an engine with no game-specific code
 * runs a game it has never seen. King's Quest I tested that claim at an
 * interpreter the engine already knew -- 2.917 is in the version table, and its
 * scripts turned out to decode at 2.440's command count anyway, which is why
 * that file calls the version reading "insurance rather than a repair".
 *
 * Police Quest I is the case that insurance was bought for: AGI 2.903, a
 * version the specification's table does not list at all. Before M24 it fell
 * through to the bundled game's count with a `why` attached. The count is the
 * same number either way -- see `logic/opcodes.ts` for why 170 is measured
 * rather than guessed -- so what these tests pin is that it is now *read*, and
 * that a game the engine has never run decodes, boots and walks.
 *
 * As with the second game, the data is not this project's to redistribute, so
 * these skip when the directory is not there.
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
import { findTables, readInterpreterTables } from '../src/render/agidata.ts';
import { CGA_TABLES_AT } from '../src/render/cgatables.ts';
import { HGC_DITHER } from '../src/render/hgcdither.ts';
import { ResourceManager } from '../src/resources/manager.ts';
import { readInterpreterVersion } from '../src/resources/interpreter.ts';
import { parseObjectFile } from '../src/resources/objects.ts';
import { Vocabulary } from '../src/resources/words.ts';
import { DiskSource } from './helpers/disk-source.ts';

const PQ1 = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'agi-extract',
  'data',
  'pq1',
);

const present = existsSync(PQ1);
const skip = present ? false : 'agi-extract/data/pq1 is not here';

/** Where Police Quest I keeps what Larry keeps 402 bytes lower. */
const PQ1_TABLES_AT = 0x1d0a;

/** The highest action opcode anywhere in its 118 scripts: close.window. */
const HIGHEST_OPCODE = 0xa9;

async function openGame() {
  const source = await DiskSource.open(PQ1);
  const resources = await ResourceManager.open(source);
  await resources.preload();
  const objects = parseObjectFile((await source.read('OBJECT'))!);
  const vocabulary = Vocabulary.parse((await source.read('WORDS.TOK'))!);
  const interpreter = readInterpreterVersion((await source.read('AGIDATA.OVL'))!);
  return { source, resources, objects, vocabulary, interpreter };
}

function start(game: Awaited<ReturnType<typeof openGame>>) {
  const machine = new Machine({
    resources: game.resources,
    objects: game.objects,
    vocabulary: game.vocabulary,
    commandCount: game.interpreter.commandCount,
  });
  machine.setHandlers(buildHandlers());

  const cycle = new Cycle(machine);
  cycle.start(0);
  return { machine, cycle };
}

test('a third game’s interpreter version is read rather than assumed', { skip }, async () => {
  const { interpreter } = await openGame();

  assert.equal(interpreter.version, '2.903', 'a third interpreter, distinct from both others');
  assert.equal(interpreter.read, true, 'read from the file, not fallen back to');
  assert.equal(interpreter.why, undefined, 'so there is nothing to explain away');
  assert.equal(interpreter.commandCount, 170);
});

test('a third game’s resources open and decode', { skip }, async () => {
  const { source, resources, objects, vocabulary, interpreter } = await openGame();

  assert.ok(objects.items.length > 0);
  assert.ok(vocabulary !== undefined);
  assert.ok((await source.read('HGC_FONT'))!.length === 3072, 'its own Hercules font');

  // Every script, every jump landing on an instruction boundary, and the
  // highest opcode any of them reaches -- the measurement `opcodes.ts` cites
  // for 2.903, kept here so it fails if it ever stops being true.
  let decoded = 0;
  let highest = -1;
  for (let id = 0; id < 256; id++) {
    if (!resources.isPresent('logic', id)) continue;

    const logic = parseLogic(resources.loadSync('logic', id));
    const instructions = decodeLogic(logic.bytecode, interpreter.commandCount);
    const boundaries = new Set(instructions.map((i) => i.at));
    boundaries.add(logic.bytecode.length);

    for (const instruction of instructions) {
      if (instruction.kind === 'action') {
        if (instruction.opcode > highest) highest = instruction.opcode;
        continue;
      }
      assert.ok(
        boundaries.has(instruction.target),
        `logic ${id}: a jump to ${instruction.target} is not an instruction`,
      );
    }
    decoded++;
  }

  assert.equal(decoded, 118, 'every script this game ships');
  assert.equal(highest, HIGHEST_OPCODE, 'and none of them needs a command 2.903 lacks');
});

test('a third game’s tables are read from its own copy', { skip }, async () => {
  const { source } = await openGame();
  const bytes = (await source.read('AGIDATA.OVL'))!;

  const sites = findTables(bytes);

  assert.equal(sites?.fill, PQ1_TABLES_AT, 'its own offset, not either other game’s');
  assert.equal(sites!.fill - CGA_TABLES_AT.fill, 402);
  assert.deepEqual(readInterpreterTables(bytes).sites, sites);

  // And what was found is a dither table rather than whatever else lies there:
  // black draws nothing, white draws all 64.
  const tables = readInterpreterTables(bytes);
  assert.deepEqual(tables.hercules[0], HGC_DITHER[0]);
  assert.deepEqual(tables.hercules[15], HGC_DITHER[15]);
});

test('a third game runs, and its ego walks', { skip }, async () => {
  const game = await openGame();
  const { machine, cycle } = start(game);

  // Enter, both to dismiss what the game waits on and, every so often, because
  // its title screen sits there until a key is pressed. A player being
  // impatient rather than a script: nothing here knows anything about PQ1.
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
  assert.notEqual(machine.state.getVar(VAR.CURRENT_ROOM), 0, 'past the title screen');

  // Something was drawn: an all-black screen is what a game that loaded and
  // did nothing looks like.
  let drawn = 0;
  for (const pixel of machine.screens.visual) if (pixel !== 0) drawn++;
  assert.ok(drawn > machine.screens.visual.length / 4, `only ${drawn} pixels drawn`);

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

  // Nothing it reached is missing. A stub here is the list of what this game
  // needs that the engine has not got, so it is named rather than counted.
  assert.deepEqual([...machine.stubs.keys()], [], 'commands reached but not implemented');
});
