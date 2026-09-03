import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { buildHandlers } from '../src/engine/commands/index.ts';
import { Cycle, MAX_CATCH_UP, TICK_MS } from '../src/engine/cycle.ts';
import { EngineError, Machine, Unwind } from '../src/engine/machine.ts';
import { DEFAULT_HORIZON, enterRoom } from '../src/engine/room.ts';
import { FLAG, GameState, LAST_RESERVED_FLAG, LAST_RESERVED_VAR, VAR } from '../src/engine/state.ts';
import { KeyPress, MessageWindow } from '../src/engine/interaction.ts';
import { TextLayer } from '../src/render/text.ts';
import { DIRECTION, MOTION } from '../src/engine/viewtable.ts';
import { CONTROL, Screens, WHITE } from '../src/render/screens.ts';
import { keyNamed } from '../src/input/keyboard.ts';
import { ResourceManager } from '../src/resources/manager.ts';
import { parseObjectFile } from '../src/resources/objects.ts';
import { DiskSource } from './helpers/disk-source.ts';

const source = await DiskSource.open();
const resources = await ResourceManager.open(source);
await resources.preload();
const objects = parseObjectFile((await source.read('OBJECT'))!);

function machine(): Machine {
  const m = new Machine({ resources, objects });
  m.setHandlers(buildHandlers());
  return m;
}

// --- Runaway scripts --------------------------------------------------------

test("the game's own help screen waits for a key instead of spinning", () => {
  // Logic 55 is the help screen, and it ends the way the original's screens do:
  // `if (!have.key()) goto self`, satisfied in the original by reading the
  // keyboard from inside the loop. Here the cycle has to park instead.
  const m = machine();
  const script = m.run(55);

  const step = script.next();

  assert.equal(step.done, false, 'the script has not finished');
  assert.ok(step.value instanceof KeyPress, `parked on ${step.value?.constructor.name}`);
  assert.equal(m.textLayer.rowIsEmpty(1), false, 'and it has written its screen first');
});

test('a key ends the wait and the script carries on to its next page', () => {
  const m = machine();
  const script = m.run(55);
  script.next();

  // The key goes in where a keypress would put it, through the interaction.
  const parked = m.pending ?? null;
  assert.equal(parked, null, 'the machine parks the cycle, not itself');

  const first = m.textLayer.chars.slice();
  const wait = new KeyPress();
  assert.equal(wait.key(m, keyNamed('a')), true);
  script.next();

  assert.notDeepEqual(m.textLayer.chars, first, 'the next page is on screen');
});

test('a spin on anything else is reported rather than left to hang', () => {
  // A jump straight back to itself, with no command in between and nothing to
  // wait for. Before the limit this locked the tab up in silence.
  const bytecode = Uint8Array.of(0xfe, 0xfd, 0xff); // goto -3, to itself
  const payload = Uint8Array.of(bytecode.length, 0, ...bytecode, 0, 0, 0);
  const resources = {
    loadSync: () => payload,
    isPresent: () => true,
  } as unknown as ResourceManager;

  const m = new Machine({ resources, objects });
  m.setHandlers(buildHandlers());

  assert.throws(() => [...m.run(1)], (error: Error) => {
    assert.ok(error instanceof EngineError, error.name);
    assert.match(error.message, /looping/);
    return true;
  });
});

test('a text screen is cleared as it is switched to', () => {
  // The original is switching video modes, so nothing of the last screen
  // survives. Keeping the cells shows the help's second page through its first.
  const m = machine();
  // A row the help screen leaves alone, so what is tested is the clearing.
  m.textLayer.write('left over', 0, 20, 15, 0);
  assert.equal(m.textLayer.rowIsEmpty(20), false);

  // Far enough into the help screen to have switched modes, not so far that it
  // parks on its wait.
  const script = m.run(55);
  script.next();

  assert.equal(m.textLayer.rowIsEmpty(1), false, 'the help wrote its own rows');
  const row = m.textLayer.chars.slice(TextLayer.index(0, 20), TextLayer.index(0, 21));
  assert.equal(String.fromCharCode(...row).replace(/\0/g, '').trim(), '', 'and nothing of ours');
});

// --- State -----------------------------------------------------------------

test('reserved slots are named, and cover the ranges the interpreter owns', () => {
  assert.equal(VAR.CURRENT_ROOM, 0);
  assert.equal(LAST_RESERVED_VAR, VAR.MONITOR_TYPE);
  assert.equal(LAST_RESERVED_FLAG, FLAG.LEAVE_WINDOW_OPEN);
  assert.equal(LAST_RESERVED_VAR, 26, 'variables 0-26 belong to the interpreter');
  assert.equal(LAST_RESERVED_FLAG, 15, 'flags 0-15 belong to the interpreter');
});

test('variables are 8-bit and wrap', () => {
  const state = new GameState();
  state.setVar(10, 300);
  assert.equal(state.getVar(10), 300 & 0xff);
});

test('strings are limited in number and length', () => {
  const state = new GameState();
  state.setString(0, 'x'.repeat(100));
  assert.equal(state.getString(0).length, 40);
  state.setString(99, 'ignored');
  assert.equal(state.getString(99), '');
});

// --- Commands --------------------------------------------------------------

test('arithmetic commands read and write variables', () => {
  // Drive the handlers directly; the dispatch path itself is covered by
  // booting the real game further down.
  const m = machine();
  const handlers = buildHandlers();
  handlers[0x03]!(m, [5, 40]); // assignn v5, 40
  assert.equal(m.state.getVar(5), 40);

  handlers[0x05]!(m, [5, 2]); // addn v5, 2
  assert.equal(m.state.getVar(5), 42);

  handlers[0x01]!(m, [5]); // increment
  assert.equal(m.state.getVar(5), 43);
});

test('increment and decrement clamp instead of wrapping', () => {
  const m = machine();
  const handlers = buildHandlers();

  m.state.setVar(7, 255);
  handlers[0x01]!(m, [7]);
  assert.equal(m.state.getVar(7), 255, 'a counter at the top stays there');

  m.state.setVar(7, 0);
  handlers[0x02]!(m, [7]);
  assert.equal(m.state.getVar(7), 0, 'and at the bottom too');
});

test('flag commands set, reset and toggle', () => {
  const m = machine();
  const handlers = buildHandlers();

  handlers[0x0c]!(m, [30]);
  assert.equal(m.state.getFlag(30), true);
  handlers[0x0e]!(m, [30]);
  assert.equal(m.state.getFlag(30), false);
  handlers[0x0d]!(m, [30]);
  assert.equal(m.state.getFlag(30), false);
});

test('terrain flags are refreshed when a script tests them', () => {
  const bytecode = Uint8Array.of(
    0x0e,
    FLAG.EGO_ON_WATER, // reset(0), as logic 0 does before room logic
    0xff,
    0x07,
    FLAG.EGO_ON_WATER,
    0xff,
    0x02,
    0x00, // if (isset(0)); skip set(30) when false
    0x0c,
    30, // set(30)
    0x00,
  );
  const payload = Uint8Array.of(bytecode.length, 0, ...bytecode, 0, 0, 0);
  const resources = {
    loadSync: () => payload,
    isPresent: () => true,
  } as unknown as ResourceManager;

  const m = new Machine({ resources, objects });
  m.setHandlers(buildHandlers());
  m.background.priority.fill(7);
  const ego = m.viewTable.ego;
  ego.setView(1, {
    loops: [
      {
        loop: 0,
        cels: [
          {
            width: 2,
            height: 1,
            transparent: 0,
            mirrored: false,
            sourceLoop: 0,
            pixels: Uint8Array.of(1, 1),
          },
        ],
      },
    ],
    description: null,
  });
  ego.x = 20;
  ego.y = 100;
  ego.priority = 7;
  m.background.priority[Screens.index(20, 100)] = CONTROL.WATER;
  m.background.priority[Screens.index(21, 100)] = CONTROL.WATER;

  m.execute(0);

  assert.equal(m.state.getFlag(30), true);
  assert.equal(m.state.getFlag(FLAG.EGO_ON_WATER), true);
});

test('unimplemented commands are counted rather than fatal', () => {
  const reached: string[] = [];
  const m = new Machine({ resources, objects, onStub: (name) => reached.push(name) });
  m.setHandlers(buildHandlers());

  const handlers = buildHandlers();
  // An opcode past everything the 2.440 interpreter knows: nothing can ever
  // implement it, so it stays the honest example of an unimplemented command.
  const unknown = 0xaa;
  handlers[unknown]!(m, [1]);
  handlers[unknown]!(m, [1]);

  assert.equal(m.stubs.get('unknown170'), 2, 'counted every time');
  assert.deepEqual(reached, ['unknown170'], 'reported once');
});

// --- Control flow ----------------------------------------------------------

test('new.room unwinds out of the running script', () => {
  const m = machine();
  assert.throws(() => m.newRoom(12), (error: unknown) => {
    assert.ok(error instanceof Unwind);
    assert.equal(error.kind, 'new-room');
    assert.equal(error.room, 12);
    return true;
  });
  assert.equal(m.pendingRoom, 12);
});

test('quit unwinds and stops the machine', () => {
  const m = machine();
  assert.throws(() => m.quit(), Unwind);
  assert.equal(m.stopped, true);
});

test('a script nested too deep is reported rather than overflowing the stack', () => {
  const m = machine();
  // Any command re-entering logic 0 recurses forever; the guard turns that
  // into a named failure with the script and the position rather than a stack
  // overflow with none.
  m.setHandlers(buildHandlers().map(() => (machine: Machine) => machine.execute(0)));

  assert.throws(() => m.execute(0), EngineError);
});

// --- Rooms -----------------------------------------------------------------

test('entering a room moves the room numbers and resets contact state', () => {
  const m = machine();
  m.state.room = 3;
  m.state.setVar(VAR.EGO_EDGE_TOUCHED, 2);
  m.state.setVar(VAR.UNKNOWN_WORD, 4);

  enterRoom(m, 9);

  assert.equal(m.state.room, 9);
  assert.equal(m.state.getVar(VAR.CURRENT_ROOM), 9);
  assert.equal(m.state.getVar(VAR.PREVIOUS_ROOM), 3);
  assert.equal(m.state.getVar(VAR.EGO_EDGE_TOUCHED), 0, 'edge contact belonged to the old room');
  assert.equal(m.state.getVar(VAR.UNKNOWN_WORD), 0);
  assert.equal(m.state.getFlag(FLAG.NEW_ROOM), true);
  assert.equal(m.horizon, DEFAULT_HORIZON);
});

// --- The cycle -------------------------------------------------------------

test('the cycle interval comes from the delay the game asked for', () => {
  const cycle = new Cycle(machine());
  cycle.machine.state.setVar(VAR.CYCLE_DELAY, 4);
  assert.equal(cycle.intervalMs, 4 * TICK_MS);
});

test('a slow frame runs several cycles but never an unbounded burst', () => {
  const cycle = new Cycle(machine());
  cycle.start(0);

  const ran = cycle.advance(cycle.intervalMs * 1000);
  assert.equal(ran, MAX_CATCH_UP, 'catch-up is capped');
});

test('time too short for a cycle runs none', () => {
  const cycle = new Cycle(machine());
  cycle.start(0);
  assert.equal(cycle.advance(1), 0);
});

test('the first-time flag is raised for logic 0 and gone the cycle after', () => {
  const m = machine();
  const cycle = new Cycle(m);
  cycle.start(0);

  assert.equal(m.state.getFlag(FLAG.LOGIC_ZERO_FIRST_TIME), true, 'set before the first cycle');

  cycle.runOnce();
  assert.equal(
    m.state.getFlag(FLAG.LOGIC_ZERO_FIRST_TIME),
    false,
    'and cleared once logic 0 has seen it, so its one-time block runs once',
  );

  // A restart is a fresh game, so the one-time block gets to run again.
  cycle.restart();
  assert.equal(m.state.getFlag(FLAG.LOGIC_ZERO_FIRST_TIME), true, 'raised again by a restart');
});

// --- The game actually boots ----------------------------------------------

test('the game boots into its first room and puts the picture on screen', () => {
  const m = machine();
  const cycle = new Cycle(m);
  cycle.start(0);

  for (let i = 0; i < 20 && cycle.runOnce(); i++) {
    /* run the opening */
  }

  assert.ok(cycle.count > 0, 'cycles ran');
  assert.equal(m.stopped, false, 'the game did not quit');
  assert.ok(m.state.getVar(VAR.CURRENT_ROOM) > 0, 'logic 0 moved the game into a room');
  assert.equal(m.currentPicture !== null, true, 'a picture was drawn');
  assert.equal(m.pictureShown, true, 'and published to the visible screen');

  const painted = m.screens.visual.reduce((n, colour) => n + (colour !== WHITE ? 1 : 0), 0);
  assert.ok(painted > 1000, `the screen has a picture on it, painted ${painted} pixels`);
});

test('booting reaches only commands that belong to later milestones', () => {
  const m = machine();
  const cycle = new Cycle(m);
  cycle.start(0);
  for (let i = 0; i < 400 && cycle.runOnce(); i++) {
    /* run the opening */
  }

  // Everything still missing should be text, prompt or menu work. If a command
  // from a milestone already done turns up here, it was missed.
  const done = [
    'assignn', 'set', 'reset', 'new.room', 'call', 'draw.pic', 'show.pic',
    'animate.obj', 'draw', 'erase', 'position', 'set.view', 'set.loop', 'set.cel',
    'move.obj', 'step.size', 'get.posn', 'add.to.pic', 'stop.cycling', 'start.cycling',
    'program.control', 'player.control', 'current.view',
  ];
  for (const name of done) {
    assert.equal(m.stubs.has(name), false, `${name} should be implemented`);
  }
});

// --- Objects on screen -----------------------------------------------------

test("the game's opening puts ego on screen and walks it about", () => {
  const m = machine();
  const cycle = new Cycle(m);
  cycle.start(0);

  const ego = m.viewTable.ego;
  const positions = new Set<string>();
  let everDrawn = false;

  for (let i = 0; i < 400 && cycle.runOnce(); i++) {
    if (ego.drawn) {
      everDrawn = true;
      positions.add(`${ego.x},${ego.y}`);
    }
  }

  assert.ok(ego.view !== null, 'the opening gave ego a view');
  assert.equal(everDrawn, true, 'and put it on screen');
  assert.ok(positions.size > 5, `and walked it about, through ${positions.size} positions`);
  assert.equal(m.playerControl, false, 'the opening drives ego itself');
});

test('the arrow keys walk ego once the player has control', () => {
  const m = machine();
  const cycle = new Cycle(m);
  cycle.start(0);
  for (let i = 0; i < 200 && cycle.runOnce(); i++) {
    /* let the opening set ego up with a view */
  }

  // The opening is a cinematic: it keeps ego to itself and walks it about on
  // its own. Player control is therefore taken back before every cycle, so
  // what is under test is the path from a keypress to ego's feet rather than
  // who is currently allowed to press it.
  const ego = m.viewTable.ego;
  ego.animated = true;
  ego.drawn = true;
  ego.update = true;
  ego.x = 60;
  ego.y = 120;

  const player = (cycles: number) => {
    for (let i = 0; i < cycles; i++) {
      m.playerControl = true;
      ego.motion = MOTION.NORMAL;
      cycle.runOnce();
    }
  };

  m.keyboard.press('ArrowRight');
  const startX = ego.x;
  player(5);

  assert.ok(ego.x > startX, `ego walked right, from ${startX} to ${ego.x}`);
  assert.equal(m.state.getVar(VAR.EGO_DIRECTION), DIRECTION.EAST, 'and said so through its variable');

  m.keyboard.press('ArrowRight'); // the same key again is a stop
  const stoppedAt = ego.x;
  player(5);
  assert.equal(ego.x, stoppedAt, 'and stopped when told to');
});

test('a keypress ends the title sequence and the game asks its first question', () => {
  // The opening is an attract loop that any key breaks out of, into the room
  // that checks the player's age. Until the prompt existed the question could
  // not be answered and the script quit; now it waits.
  const m = machine();
  const cycle = new Cycle(m);
  cycle.start(0);
  for (let i = 0; i < 300 && cycle.runOnce(); i++) {
    /* let the title sequence run */
  }
  assert.equal(m.stopped, false, 'left alone, the opening loops forever');
  assert.equal(m.pending === null, true, 'and asks nothing');

  m.handleKey({ char: 32, name: ' ', code: 'Space' });
  for (let i = 0; i < 20 && cycle.runOnce(); i++) {
    /* the keypress is taken by the next cycle */
  }

  assert.equal(m.stopped, false, 'the game did not quit');
  assert.ok(m.pending instanceof MessageWindow, 'it put its warning on screen');
  assert.equal(m.stubs.has('get.num'), false, 'and can ask its question');
});

// --- Golden ----------------------------------------------------------------

test('room 1 after 60 cycles draws the same screen it did before', () => {
  // One hash covering picture drawing, sprite compositing and cycle ordering:
  // almost any regression in any of them moves it. When it moves for a good
  // reason, look at the screen before replacing the value.
  const m = machine();
  const cycle = new Cycle(m);
  cycle.start(0);
  for (let i = 0; i < 60 && cycle.runOnce(); i++) {
    /* no input */
  }

  const visual = createHash('sha256').update(m.screens.visual).digest('hex').slice(0, 16);
  const priority = createHash('sha256').update(m.screens.priority).digest('hex').slice(0, 16);

  assert.equal(visual, '1e87526a804ad165', 'the visual screen');
  assert.equal(priority, 'ecefcc9dd87f2464', 'the priority screen');
});
