import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildHandlers } from '../src/engine/commands/index.ts';
import { EDGE } from '../src/engine/motion.ts';
import { Machine } from '../src/engine/machine.ts';
import { enterRoom, repositionEgoForEdge } from '../src/engine/room.ts';
import { VAR } from '../src/engine/state.ts';
import { MAX_VIEW_OBJECTS, ViewObject, ViewTable, type View } from '../src/engine/viewtable.ts';
import { PICTURE_HEIGHT, PICTURE_WIDTH } from '../src/render/screens.ts';
import type { Cel } from '../src/render/sprite.ts';
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

/** A view with `loops` loops of `cels` cels each, all one pixel. */
function view(loops: number, cels: number): View {
  const cel: Cel = {
    width: 3,
    height: 2,
    transparent: 0,
    mirrored: false,
    sourceLoop: 0,
    pixels: new Uint8Array(6).fill(1),
  };
  return {
    loops: Array.from({ length: loops }, (_, loop) => ({
      loop,
      cels: new Array(cels).fill(cel),
    })),
    description: null,
  };
}

test('the table has a fixed number of slots and ego is the first', () => {
  const table = new ViewTable();
  assert.equal(table.objects.length, MAX_VIEW_OBJECTS);
  assert.equal(table.ego, table.at(0));
  assert.equal(table.ego.number, 0);
  assert.equal(table.at(MAX_VIEW_OBJECTS), undefined, 'a slot past the end is not invented');
});

test('a loop or cel past the end of the view is ignored, not applied', () => {
  // The original leaves the object showing what it was showing, and scripts
  // depend on that: blanking it instead makes a character vanish.
  const object = new ViewObject(1);
  object.setView(5, view(2, 3));
  object.setLoop(1);
  object.setCel(2);

  object.setLoop(9);
  assert.equal(object.loop, 1);

  object.setCel(9);
  assert.equal(object.cel, 2);
});

test('changing to a shorter loop pulls the cel back into range', () => {
  const object = new ViewObject(1);
  object.setView(5, { loops: [view(1, 4).loops[0]!, view(1, 2).loops[0]!], description: null });
  object.setCel(3);

  object.setLoop(1);
  assert.equal(object.cel, 1, 'the last cel the new loop has');
});

test('an object reports the size of the cel it is showing', () => {
  const object = new ViewObject(1);
  assert.equal(object.width, 0, 'a slot with no view has no size');

  object.setView(5, view(1, 1));
  assert.equal(object.width, 3);
  assert.equal(object.height, 2);
});

test('an object is only advanced when it is animated, drawn and updating', () => {
  const table = new ViewTable();
  const object = table.at(1)!;

  object.animated = true;
  assert.equal(table.active().length, 0);

  object.drawn = true;
  assert.deepEqual(table.active(), [object]);

  object.update = false;
  assert.equal(table.active().length, 0);
  assert.deepEqual(table.visible(), [object], 'but it is still on screen');
});

test('claiming a slot for animation clears every pin the last occupant left', () => {
  // The original assigns the object's whole flag word here rather than adding
  // to it. That is not a detail: the game pins ego's loop for its opening
  // cinematic and never releases it, and this is what unpins him.
  const object = new ViewObject(0);
  object.setView(44, view(4, 2));

  object.fixedLoop = true;
  object.fixedPriority = true;
  object.ignoresHorizon = true;
  object.ignoresBlocks = true;
  object.ignoresObjects = true;
  object.onWater = true;

  object.animate();

  assert.equal(object.fixedLoop, false, 'the loop is free to follow the direction again');
  assert.equal(object.fixedPriority, false);
  assert.equal(object.ignoresHorizon, false);
  assert.equal(object.ignoresBlocks, false);
  assert.equal(object.ignoresObjects, false);
  assert.equal(object.onWater, false);

  assert.equal(object.animated, true);
  assert.equal(object.update, true);
  assert.equal(object.cycling, true, 'cycling starts on, which is why scripts stop it');
  assert.equal(object.drawn, false, 'and it is not on screen until something draws it');
});

test('a room change releases the slots but leaves their pins to animate.obj', () => {
  // The two resets are deliberately different, and mixing them up hides the
  // bug above: if a room change cleared the pins, nothing would depend on
  // animate.obj clearing them and the real defect would only show up in the
  // one game that relies on it.
  const object = new ViewObject(0);
  object.animated = true;
  object.drawn = true;
  object.fixedLoop = true;

  object.reset();

  assert.equal(object.animated, false, 'the slot is free');
  assert.equal(object.drawn, false);
  assert.equal(object.fixedLoop, true, 'but the pin is still there');
});

test('a new room clears the table and keeps ego', () => {
  const m = machine();
  const other = m.viewTable.at(3)!;
  other.animated = true;
  other.drawn = true;

  const ego = m.viewTable.ego;
  ego.setView(44, view(4, 2));
  ego.x = 90;
  ego.y = 120;

  enterRoom(m, 7);

  assert.equal(other.animated, false, 'the room its objects belonged to is gone');
  assert.equal(other.drawn, false);
  assert.equal(ego.view, 44, 'ego is the thing that walked here, and keeps its view');
  assert.equal(ego.x, 90, 'and its position, unless it left by an edge');
});

test('ego arrives at the far side of the screen it walked off', () => {
  const m = machine();
  const ego = m.viewTable.ego;
  ego.setView(44, view(4, 2));

  const cases = [
    { edge: EDGE.LEFT, expect: () => assert.equal(ego.x, PICTURE_WIDTH - ego.width) },
    { edge: EDGE.RIGHT, expect: () => assert.equal(ego.x, 0) },
    { edge: EDGE.TOP, expect: () => assert.equal(ego.y, PICTURE_HEIGHT - 1) },
    { edge: EDGE.BOTTOM, expect: () => assert.equal(ego.y, 37) },
  ];

  for (const { edge, expect } of cases) {
    ego.x = 80;
    ego.y = 100;
    repositionEgoForEdge(m, edge);
    expect();
  }

  ego.x = 80;
  ego.y = 100;
  repositionEgoForEdge(m, EDGE.NONE);
  assert.equal(ego.x, 80, 'a room entered by a script leaves ego where it was');
  assert.equal(ego.y, 100);
});

test('entering a room reads the edge ego left by before clearing it', () => {
  const m = machine();
  const ego = m.viewTable.ego;
  ego.setView(44, view(4, 2));
  ego.x = 2;
  m.state.setVar(VAR.EGO_EDGE_TOUCHED, EDGE.LEFT);

  enterRoom(m, 5);

  assert.equal(ego.x, PICTURE_WIDTH - ego.width, 'ego walked in from the right');
  assert.equal(m.state.getVar(VAR.EGO_EDGE_TOUCHED), 0, 'and the edge belonged to the old room');
});
