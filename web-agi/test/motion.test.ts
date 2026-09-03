import assert from 'node:assert/strict';
import { test } from 'node:test';

import { drawObjects, eraseObjects } from '../src/engine/animate.ts';
import { buildHandlers } from '../src/engine/commands/index.ts';
import {
  advanceCel,
  checkAllMotions,
  checkFooting,
  collides,
  directionTowards,
  EDGE,
  fitsOnScreen,
  fixPosition,
  KEEP_LOOP,
  loopForDirection,
  priorityForRow,
  updatePositions,
} from '../src/engine/motion.ts';
import { Machine } from '../src/engine/machine.ts';
import { FLAG, VAR } from '../src/engine/state.ts';
import { CYCLE, DIRECTION, MOTION, ViewObject, type View } from '../src/engine/viewtable.ts';
import { Keyboard } from '../src/input/keyboard.ts';
import { CONTROL, PICTURE_WIDTH, Screens } from '../src/render/screens.ts';
import { TRANSPARENT, type Cel } from '../src/render/sprite.ts';
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

/** A one-loop view of solid blocks, so a test can position something real. */
function blockView(width = 4, height = 4, colour = 1, loops = 1): View {
  const cel: Cel = {
    width,
    height,
    transparent: 0,
    mirrored: false,
    sourceLoop: 0,
    pixels: new Uint8Array(width * height).fill(colour),
  };
  return {
    loops: Array.from({ length: loops }, (_, loop) => ({ loop, cels: [cel] })),
    description: null,
  };
}

/** An animated, drawn, updating object standing at a point. */
function standing(m: Machine, number: number, x: number, y: number, view = blockView()): ViewObject {
  const object = m.viewTable.at(number)!;
  object.setView(90 + number, view);
  object.animated = true;
  object.drawn = true;
  object.update = true;
  object.x = x;
  object.y = y;
  object.previousX = x;
  object.previousY = y;
  object.priority = priorityForRow(y);
  return object;
}

/** A machine with a blank, walkable background and no horizon in the way. */
function walkable(): Machine {
  const m = machine();
  m.background.priority.fill(7);
  m.background.visual.fill(15);
  m.screens.copyFrom(m.background);
  m.horizon = 0;
  return m;
}

// --- Priority bands --------------------------------------------------------

test('priority follows the band the object stands in', () => {
  assert.equal(priorityForRow(0), 4, 'the top of the picture is all one band');
  assert.equal(priorityForRow(47), 4);
  assert.equal(priorityForRow(48), 5, 'below 48 the bands are 12 rows each');
  assert.equal(priorityForRow(59), 5);
  assert.equal(priorityForRow(60), 6);
  assert.equal(priorityForRow(167), 14, 'the bottom row is the nearest band');
});

test('priority 15 is never handed out by the bands', () => {
  // It is reserved for objects a script pins in front of everything, and it is
  // also the value that switches off the control-line checks.
  for (let y = 0; y < 168; y++) assert.notEqual(priorityForRow(y), 15);
});

// --- Control lines ---------------------------------------------------------

test('each control colour decides whether an object may stand on it', () => {
  // The rules are asserted against the four control values directly rather
  // than through a room, so a change in meaning shows up here and not as a
  // character mysteriously walking through a wall three milestones later.
  const cases = [
    { control: CONTROL.UNCONDITIONAL_OBSTACLE, allowed: false, note: 'a wall stops everyone' },
    { control: CONTROL.CONDITIONAL_OBSTACLE, allowed: false, note: 'a conditional wall stops an object that observes blocks' },
    { control: CONTROL.ALARM, allowed: true, note: 'a trigger line is crossed, not blocked' },
    { control: CONTROL.WATER, allowed: true, note: 'water is walkable unless the object is confined to land' },
  ];

  for (const { control, allowed, note } of cases) {
    const m = walkable();
    const object = standing(m, 1, 20, 100);
    for (let i = 0; i < object.width; i++) {
      m.background.priority[Screens.index(20 + i, 100)] = control;
    }

    assert.equal(checkFooting(m.background, object, object.priority).allowed, allowed, note);
  }
});

test('ignoring blocks passes the conditional obstacle and nothing else', () => {
  const m = walkable();
  const object = standing(m, 1, 20, 100);
  object.ignoresBlocks = true;

  const paint = (control: number) => {
    for (let i = 0; i < object.width; i++) {
      m.background.priority[Screens.index(20 + i, 100)] = control;
    }
  };

  paint(CONTROL.CONDITIONAL_OBSTACLE);
  assert.equal(checkFooting(m.background, object, object.priority).allowed, true);

  paint(CONTROL.UNCONDITIONAL_OBSTACLE);
  assert.equal(checkFooting(m.background, object, object.priority).allowed, false);
});

test('a trigger line is reported without blocking, and water only when the whole base is wet', () => {
  const m = walkable();
  const object = standing(m, 1, 20, 100);

  m.background.priority[Screens.index(21, 100)] = CONTROL.ALARM;
  const overAlarm = checkFooting(m.background, object, object.priority);
  assert.equal(overAlarm.allowed, true);
  assert.equal(overAlarm.signal, true);
  assert.equal(overAlarm.water, false, 'one dry pixel is enough to be on land');

  for (let i = 0; i < object.width; i++) {
    m.background.priority[Screens.index(20 + i, 100)] = CONTROL.WATER;
  }
  assert.equal(checkFooting(m.background, object, object.priority).water, true);
});

test('an object confined to one surface may not step off it', () => {
  const m = walkable();
  const object = standing(m, 1, 20, 100);

  object.onWater = true;
  assert.equal(checkFooting(m.background, object, object.priority).allowed, false, 'dry land is out of bounds');

  for (let i = 0; i < object.width; i++) {
    m.background.priority[Screens.index(20 + i, 100)] = CONTROL.WATER;
  }
  assert.equal(checkFooting(m.background, object, object.priority).allowed, true);

  object.onWater = false;
  object.onLand = true;
  assert.equal(checkFooting(m.background, object, object.priority).allowed, false, 'and so is water');
});

test('priority 15 puts an object outside the scene entirely', () => {
  const m = walkable();
  const object = standing(m, 1, 20, 100);
  for (let i = 0; i < object.width; i++) {
    m.background.priority[Screens.index(20 + i, 100)] = CONTROL.UNCONDITIONAL_OBSTACLE;
  }

  assert.equal(checkFooting(m.background, object, 15).allowed, true);
});

// --- Movement --------------------------------------------------------------

test('a step into a wall is undone rather than clamped', () => {
  const m = walkable();
  const ego = standing(m, 0, 20, 100);
  ego.direction = DIRECTION.SOUTH_EAST;
  ego.stepSize = 2;

  // A wall on the row below, but only to the right of where ego is.
  for (let x = 20; x < 40; x++) m.background.priority[Screens.index(x, 102)] = CONTROL.UNCONDITIONAL_OBSTACLE;

  updatePositions(m);

  assert.equal(ego.x, 20, 'refused diagonally, ego does not slide along the wall');
  assert.equal(ego.y, 100);
  assert.equal(ego.didNotMove, true);
});

test('an unobstructed step moves by the step size', () => {
  const m = walkable();
  const ego = standing(m, 0, 20, 100);
  ego.direction = DIRECTION.EAST;
  ego.stepSize = 3;

  updatePositions(m);

  assert.equal(ego.x, 23);
  assert.equal(ego.y, 100);
  assert.equal(ego.didNotMove, false);
});

test('a script that placed an object this cycle stops the engine stepping it too', () => {
  const m = walkable();
  const ego = standing(m, 0, 20, 100);
  ego.direction = DIRECTION.EAST;
  ego.stepSize = 3;
  ego.repositioned = true;

  updatePositions(m);
  assert.equal(ego.x, 20, 'the script decided where it is');

  updatePositions(m);
  assert.equal(ego.x, 23, 'and the next cycle moves it normally again');
});

test('each screen edge is reported through the reserved variables', () => {
  const cases = [
    { direction: DIRECTION.WEST, x: 1, y: 100, edge: EDGE.LEFT },
    { direction: DIRECTION.EAST, x: 155, y: 100, edge: EDGE.RIGHT },
    { direction: DIRECTION.SOUTH, x: 20, y: 166, edge: EDGE.BOTTOM },
    { direction: DIRECTION.NORTH, x: 20, y: 40, edge: EDGE.TOP },
  ];

  for (const { direction, x, y, edge } of cases) {
    const m = walkable();
    m.horizon = 36;
    const ego = standing(m, 0, x, y);
    ego.direction = direction;
    ego.stepSize = 5;

    updatePositions(m);

    assert.equal(m.state.getVar(VAR.EGO_EDGE_TOUCHED), edge, `direction ${direction}`);
  }
});

test('an object other than ego reports which object touched the edge', () => {
  const m = walkable();
  const object = standing(m, 3, 1, 100);
  object.direction = DIRECTION.WEST;
  object.stepSize = 5;

  updatePositions(m);

  assert.equal(m.state.getVar(VAR.OBJECT_TOUCHING_EDGE), 3);
  assert.equal(m.state.getVar(VAR.OBJECT_EDGE_TOUCHED), EDGE.LEFT);
  assert.equal(m.state.getVar(VAR.EGO_EDGE_TOUCHED), 0, "ego's own slot is left alone");
});

test('the horizon is a wall for objects that observe it', () => {
  const m = walkable();
  m.horizon = 50;
  const ego = standing(m, 0, 20, 52);
  ego.direction = DIRECTION.NORTH;
  ego.stepSize = 4;

  updatePositions(m);
  assert.equal(ego.y, 51, 'stopped just below the horizon');

  ego.ignoresHorizon = true;
  ego.direction = DIRECTION.NORTH;
  updatePositions(m);
  assert.equal(ego.y, 47, 'and free to cross it once told to ignore it');
});

test('ego reports the ground it is standing on through its flags', () => {
  const m = walkable();
  const ego = standing(m, 0, 20, 100);
  for (let i = 0; i < ego.width; i++) {
    m.background.priority[Screens.index(20 + i, 100)] = CONTROL.WATER;
  }

  updatePositions(m);
  assert.equal(m.state.getFlag(FLAG.EGO_ON_WATER), true);

  m.background.priority[Screens.index(21, 100)] = CONTROL.ALARM;
  updatePositions(m);
  assert.equal(m.state.getFlag(FLAG.EGO_ON_WATER), false);
  assert.equal(m.state.getFlag(FLAG.EGO_TOUCHED_SIGNAL), true);
});

test('objects that observe each other cannot stand in the same place', () => {
  const m = walkable();
  const mover = standing(m, 0, 20, 100);
  standing(m, 1, 24, 100);

  assert.equal(collides(m.viewTable, mover), true);

  mover.ignoresObjects = true;
  assert.equal(collides(m.viewTable, mover), false, 'until one of them ignores objects');
});

test('an object is only outside the screen when it does not fit', () => {
  const m = walkable();
  const object = standing(m, 1, 156, 100);
  assert.equal(fitsOnScreen(object, 0), true, 'a four-wide object just fits at 156');

  object.x = 157;
  assert.equal(fitsOnScreen(object, 0), false);
});

// --- Direction and loops ---------------------------------------------------

test('a destination is reached rather than overshot', () => {
  assert.equal(directionTowards(10, 10, 20, 10, 2), DIRECTION.EAST);
  assert.equal(directionTowards(10, 10, 10, 20, 2), DIRECTION.SOUTH);
  assert.equal(directionTowards(20, 20, 10, 10, 2), DIRECTION.NORTH_WEST);
  assert.equal(
    directionTowards(10, 10, 11, 10, 4),
    DIRECTION.NONE,
    'a gap smaller than one step counts as arrived',
  );
});

test('a four-loop view faces the way it walks', () => {
  assert.equal(loopForDirection(DIRECTION.EAST, 4), 0);
  assert.equal(loopForDirection(DIRECTION.WEST, 4), 1);
  assert.equal(loopForDirection(DIRECTION.SOUTH, 4), 2);
  assert.equal(loopForDirection(DIRECTION.NORTH, 4), 3);
  assert.equal(
    loopForDirection(DIRECTION.NONE, 4),
    KEEP_LOOP,
    'standing still keeps the object facing the way it was going',
  );
});

test('a two-loop view only faces left and right', () => {
  // Two-loop views number their loops the other way round from four-loop ones:
  // loop 0 faces west, loop 1 faces east. It looks like a mistake and is not --
  // swapping them makes every two-loop character in the game walk backwards.
  assert.equal(loopForDirection(DIRECTION.EAST, 2), 1);
  assert.equal(loopForDirection(DIRECTION.WEST, 2), 0);
  assert.equal(loopForDirection(DIRECTION.NORTH, 2), KEEP_LOOP);
  assert.equal(loopForDirection(DIRECTION.SOUTH, 2), KEEP_LOOP);
});

test('a view with one loop never changes loop', () => {
  for (let direction = 0; direction <= 8; direction++) {
    assert.equal(loopForDirection(direction, 1), KEEP_LOOP);
  }
});

// --- Cel cycling -----------------------------------------------------------

/** An object with `count` cels, so cycling has something to walk through. */
function cycler(count: number): ViewObject {
  const object = new ViewObject(1);
  const cel: Cel = {
    width: 1,
    height: 1,
    transparent: 0,
    mirrored: false,
    sourceLoop: 0,
    pixels: Uint8Array.of(1),
  };
  object.setView(1, { loops: [{ loop: 0, cels: new Array(count).fill(cel) }], description: null });
  return object;
}

test('normal cycling wraps round', () => {
  const object = cycler(3);
  const seen = [object.cel];
  for (let i = 0; i < 4; i++) {
    advanceCel(object, () => {});
    seen.push(object.cel);
  }
  assert.deepEqual(seen, [0, 1, 2, 0, 1]);
});

test('reverse cycling wraps the other way', () => {
  const object = cycler(3);
  object.cycleType = CYCLE.REVERSE;
  const seen = [object.cel];
  for (let i = 0; i < 3; i++) {
    advanceCel(object, () => {});
    seen.push(object.cel);
  }
  assert.deepEqual(seen, [0, 2, 1, 0]);
});

test('cycling to the end of a loop stops and sets its flag', () => {
  const object = cycler(3);
  object.cycleType = CYCLE.END_OF_LOOP;
  object.cycling = true;
  object.cycleFlag = 40;
  object.direction = DIRECTION.EAST;

  const flags: number[] = [];
  advanceCel(object, (flag) => flags.push(flag));
  assert.equal(flags.length, 0, 'not finished yet');

  advanceCel(object, (flag) => flags.push(flag));
  assert.deepEqual(flags, [40], 'the script waiting on this flag is now free');
  assert.equal(object.cel, 2);
  assert.equal(object.cycling, false);
  assert.equal(object.direction, DIRECTION.NONE, 'and the object has stopped walking');
});

test('cycling back to the start of a loop stops and sets its flag', () => {
  const object = cycler(3);
  object.cycleType = CYCLE.REVERSE_LOOP;
  object.cycling = true;
  object.cycleFlag = 41;
  object.setCel(2);

  const flags: number[] = [];
  advanceCel(object, (flag) => flags.push(flag));
  advanceCel(object, (flag) => flags.push(flag));

  assert.equal(object.cel, 0);
  assert.deepEqual(flags, [41]);
});

// --- Placing an object ------------------------------------------------------

test('an object placed off the screen is settled onto it', () => {
  const m = walkable();
  const object = standing(m, 1, 20, 100);

  object.x = 253;
  fixPosition(m, object);

  assert.ok(object.x >= 0, 'on the screen');
  assert.ok(object.x + object.width <= PICTURE_WIDTH, 'and wholly on it');
});

test('an object placed in a wall is moved to the nearest place it can stand', () => {
  const m = walkable();
  const object = standing(m, 1, 20, 100);

  // A wall right where the script wants to put it.
  for (let x = 18; x < 26; x++) {
    m.background.priority[Screens.index(x, 100)] = CONTROL.UNCONDITIONAL_OBSTACLE;
  }

  object.x = 20;
  object.y = 100;
  fixPosition(m, object);

  assert.equal(
    checkFooting(m.background, object, object.priority).allowed,
    true,
    `ended up somewhere it can stand, at ${object.x},${object.y}`,
  );
});

test("the game's own death sequence places ego without the room thinking he left", () => {
  // This is the defect that abandoned the death sequence half-way. The script
  // does `subn(38, 3)` on ego's x and then repositions him there. A variable
  // holds one byte, so with ego at the left edge that is 0 - 3 = 253 -- and an
  // off-screen position surviving into the cycle is clamped to the far edge
  // and reported as ego having *walked* into it. The room's exit tests read
  // that report and send the player out of the room, leaving whatever sequence
  // was running abandoned and its animation cycling for ever.
  const m = walkable();
  const ego = standing(m, 0, 0, 156);
  const handlers = buildHandlers();

  m.state.setVar(38, ego.x);
  m.state.setVar(39, ego.y);
  handlers[0x07]!(m, [38, 3]); // subn(38, 3)
  assert.equal(m.state.getVar(38), 253, 'the byte wraps, as a byte does');

  handlers[0x94]!(m, [0, 38, 39]); // reposition.to.v(0, 38, 39)
  assert.ok(ego.x + ego.width <= PICTURE_WIDTH, `ego is on the screen, at ${ego.x}`);

  m.state.setVar(VAR.EGO_EDGE_TOUCHED, 0);
  updatePositions(m);

  assert.equal(
    m.state.getVar(VAR.EGO_EDGE_TOUCHED),
    EDGE.NONE,
    'and the scripts are not told he touched an edge',
  );
});

test('position places an object exactly where it is told, edges and all', () => {
  // The counterpart, and the reason the two are not the same command:
  // `position` places an object before it is drawn, and the original does not
  // settle it. Making both settle would hide the difference the game relies on.
  const m = walkable();
  const object = standing(m, 1, 20, 100);
  const handlers = buildHandlers();

  handlers[0x25]!(m, [1, 150, 120]); // position(1, 150, 120)

  assert.equal(object.x, 150, 'taken literally');
  assert.equal(object.y, 120);
});

// --- move.obj --------------------------------------------------------------

test('move.obj walks an object to a point and reports arrival once', () => {
  const m = walkable();
  const object = standing(m, 1, 20, 100);
  const handlers = buildHandlers();

  // move.obj(1, x=30, y=100, step=2, flag=60)
  handlers[0x51]!(m, [1, 30, 100, 2, 60]);
  assert.equal(m.state.getFlag(60), false, 'the flag is cleared until the object arrives');
  assert.equal(object.motion, MOTION.MOVE_TO);

  // The cycle's own order: choose a direction, then take the step.
  for (let i = 0; i < 20 && object.motion === MOTION.MOVE_TO; i++) {
    checkAllMotions(m);
    updatePositions(m);
  }

  assert.equal(object.x, 30);
  assert.equal(object.y, 100);
  assert.equal(object.motion, MOTION.NORMAL, 'the object stops when it arrives');
  assert.equal(m.state.getFlag(60), true, 'and says so');
  assert.equal(object.stepSize, 1, 'the step size it borrowed is given back');
});

// --- Drawing ---------------------------------------------------------------

test('two overlapping sprites leave no trail when they move apart', () => {
  // The two-pass restore is the whole point: erasing per object would have the
  // second object's restore paint over the first object's fresh pixels.
  const m = walkable();
  const before = m.screens.visual.slice();

  const a = standing(m, 0, 20, 100, blockView(4, 4, 1));
  const b = standing(m, 1, 22, 100, blockView(4, 4, 2));

  drawObjects(m);
  assert.notDeepEqual(m.screens.visual, before, 'something was drawn');

  eraseObjects(m);
  assert.deepEqual(m.screens.visual, before, 'and taken away again exactly');

  a.x = 60;
  b.x = 90;
  drawObjects(m);
  eraseObjects(m);
  assert.deepEqual(m.screens.visual, before, 'wherever they went');
});

test('sprites do not write to the priority screen', () => {
  const m = walkable();
  const priority = m.screens.priority.slice();
  standing(m, 0, 20, 100);

  drawObjects(m);

  assert.deepEqual(m.screens.priority, priority, 'depth belongs to the scene, not to the sprite');
});

test('a nearer object is drawn over a further one', () => {
  const m = walkable();
  const far = standing(m, 0, 20, 60, blockView(4, 4, 1));
  const near = standing(m, 1, 20, 100, blockView(4, 4, 2));
  // Put them on the same pixels while keeping their bands apart.
  near.y = 60;
  near.priority = 9;
  far.priority = 5;

  drawObjects(m);

  assert.equal(m.screens.colourAt(20, 60), 2, 'the nearer colour wins');
});

test('a transparent cel shows what is behind it', () => {
  const m = walkable();
  m.screens.visual.fill(7);
  const view = blockView(2, 1, 3);
  view.loops[0]!.cels[0]!.pixels = Uint8Array.of(3, TRANSPARENT);
  standing(m, 0, 20, 100, view);

  drawObjects(m);

  assert.equal(m.screens.colourAt(20, 100), 3);
  assert.equal(m.screens.colourAt(21, 100), 7);
});

// --- The keyboard ----------------------------------------------------------

test('an arrow key sets ego walking and pressing it again stops', () => {
  const keyboard = new Keyboard();

  keyboard.press('ArrowRight');
  assert.equal(keyboard.direction, DIRECTION.EAST);

  keyboard.press('ArrowRight');
  assert.equal(keyboard.direction, DIRECTION.NONE, 'the same key again is a stop');

  keyboard.press('ArrowUp');
  assert.equal(keyboard.direction, DIRECTION.NORTH);
});

test('the keypad supplies the diagonals', () => {
  const keyboard = new Keyboard();
  keyboard.press('9', 'Numpad9');
  assert.equal(keyboard.direction, DIRECTION.NORTH_EAST);
  keyboard.press('5', 'Numpad5');
  assert.equal(keyboard.direction, DIRECTION.NONE);
});

test('a key is reported to exactly one cycle', () => {
  const keyboard = new Keyboard();
  keyboard.note('a'.charCodeAt(0));
  assert.equal(keyboard.takeKey(), 'a'.charCodeAt(0));
  assert.equal(keyboard.takeKey(), 0, 'and is gone afterwards');
});
