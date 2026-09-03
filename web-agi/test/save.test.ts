import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { buildHandlers } from '../src/engine/commands/index.ts';
import { Cycle } from '../src/engine/cycle.ts';
import { MessageWindow } from '../src/engine/interaction.ts';
import { Machine } from '../src/engine/machine.ts';
import { enterRoom } from '../src/engine/room.ts';
import {
  applySnapshot,
  captureSnapshot,
  SaveError,
  SNAPSHOT_VERSION,
  type Snapshot,
} from '../src/engine/snapshot.ts';
import { VAR } from '../src/engine/state.ts';
import { RestoreScreen, SaveScreen } from '../src/engine/savegame.ts';
import { keyNamed } from '../src/input/keyboard.ts';
import {
  exportSaves,
  importSaves,
  SaveStore,
  StorageError,
  type KeyValueStore,
} from '../src/storage/saves.ts';
import { ResourceManager } from '../src/resources/manager.ts';
import { parseObjectFile } from '../src/resources/objects.ts';
import { Vocabulary } from '../src/resources/words.ts';
import { DiskSource } from './helpers/disk-source.ts';

const source = await DiskSource.open();
const resources = await ResourceManager.open(source);
await resources.preload();
const objects = parseObjectFile((await source.read('OBJECT'))!);
const vocabulary = Vocabulary.parse((await source.read('WORDS.TOK'))!);

/**
 * A fixed random sequence, rewound for every run.
 *
 * The whole point of the round trip is that the same input twice gives the same
 * screen, and the game chooses parts of its opening at random.
 */
const FIRST_SEED = 0x2f6e2b1;
let seed = FIRST_SEED;
Math.random = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x80000000;
};

/** A game being played, thin enough to be driven a keystroke at a time. */
class Player {
  readonly machine: Machine;
  readonly cycle: Cycle;

  constructor() {
    seed = FIRST_SEED;
    this.machine = new Machine({ resources, objects, vocabulary });
    this.machine.setHandlers(buildHandlers());
    this.cycle = new Cycle(this.machine);
    this.cycle.start(0);
  }

  key(name: string): void {
    this.machine.handleKey(keyNamed(name));
  }

  run(cycles: number): void {
    for (let i = 0; i < cycles; i++) if (!this.cycle.runOnce()) break;
  }

  type(line: string): void {
    for (const character of line) this.key(character);
    this.key('Enter');
  }

  dismiss(limit = 20): void {
    for (let i = 0; i < limit; i++) {
      if (!(this.machine.pending instanceof MessageWindow)) return;
      this.key('Enter');
      this.run(10);
    }
  }

  /** Into the first room the player actually plays. */
  playOpening(): void {
    this.run(300);
    this.key(' ');
    this.run(20);
    this.dismiss();
    this.type('30');
    this.run(5);
    this.dismiss();

    for (let step = 0; step < 400 && this.room === 6; step++) {
      if (this.machine.pending) {
        this.key('Enter');
        this.run(10);
      } else if (this.machine.window) {
        const choice = Math.min(4, Math.max(1, this.machine.state.getVar(93)));
        this.key(String.fromCharCode(96 + choice));
        this.run(15);
      } else {
        this.run(10);
      }
    }

    this.dismiss();
    this.run(80);
  }

  get room(): number {
    return this.machine.state.getVar(VAR.CURRENT_ROOM);
  }

  /**
   * A stretch of play with something of everything in it.
   *
   * The plan asks for a window, a scripted walk and a room change, because
   * those are where the state a snapshot might miss actually lives: a message
   * waiting to be dismissed, an object part-way through a move, and the whole
   * of a room's setup.
   */
  playAWhile(): void {
    this.key('ArrowLeft');
    this.run(40);
    this.type('look');
    this.run(30);
    this.dismiss();
    this.key('ArrowRight');
    this.run(60);
    this.type('look at sign');
    this.run(30);
    this.dismiss();
    this.run(40);
  }

  /** Everything the player can see, as one value. */
  fingerprint(): string {
    const hash = createHash('sha256');
    hash.update(this.machine.screens.visual);
    hash.update(this.machine.screens.priority);
    hash.update(this.machine.textLayer.chars);
    hash.update(Buffer.from(this.machine.state.variables));
    hash.update(Buffer.from(this.machine.state.flags));
    hash.update(String(this.room));
    return hash.digest('hex');
  }
}

// --- The round trip ---------------------------------------------------------

test('a restored game plays on identically to the one that was saved', () => {
  // The test the milestone stands on. A field left out of the snapshot cannot
  // be found by reading the list of fields -- that is exactly how it came to be
  // left out -- but it shows up here as a screen that diverges.
  //
  // The random sequence is not part of the game's state and is rewound by hand,
  // because the same input has to mean the same play for the comparison to say
  // anything.
  const player = new Player();
  player.playOpening();

  const snapshot = captureSnapshot(player.machine);
  const seedAtSave = seed;

  player.playAWhile();
  const expected = player.fingerprint();

  // Away from the save in every way the game allows: more play, a room the
  // save knows nothing about, and an inventory that has moved on.
  player.playAWhile();
  enterRoom(player.machine, 15);
  player.run(20);
  player.machine.inventory.rooms.fill(0);

  applySnapshot(player.machine, snapshot);
  seed = seedAtSave;
  player.playAWhile();

  assert.equal(player.fingerprint(), expected);
});

test('a snapshot restores into a game that has only just started, as a reload does', () => {
  // The case a player actually meets: the page was closed, the engine came back
  // knowing nothing, and the save has to carry everything by itself.
  const player = new Player();
  player.playOpening();

  const snapshot = JSON.parse(JSON.stringify(captureSnapshot(player.machine))) as Snapshot;
  const seedAtSave = seed;

  player.playAWhile();
  const expected = player.fingerprint();

  const reloaded = new Player();
  reloaded.run(2); // barely started: no room, no menu, nothing
  applySnapshot(reloaded.machine, snapshot);
  seed = seedAtSave;
  reloaded.playAWhile();

  assert.equal(reloaded.fingerprint(), expected);
});

test('restoring puts back everything the snapshot carries', () => {
  // The other half of the round trip. That one finds state the snapshot never
  // captured; this finds state it captured and forgot to put back, which is a
  // different mistake and invisible to a replay that never reads the field.
  const player = new Player();
  player.playOpening();

  const snapshot = captureSnapshot(player.machine);

  player.playAWhile();
  enterRoom(player.machine, 15);
  player.run(20);
  player.machine.inventory.rooms.fill(0);
  player.machine.menuBar.setEnabled(11, false);

  applySnapshot(player.machine, snapshot);

  const { savedAt: _before, ...expected } = snapshot;
  const { savedAt: _after, ...actual } = captureSnapshot(player.machine);
  assert.deepEqual(actual, expected);
});

// --- What a snapshot holds --------------------------------------------------

test('the room, the inventory and the view table come back', () => {
  const player = new Player();
  player.playOpening();

  const snapshot = captureSnapshot(player.machine);
  const ego = player.machine.viewTable.ego;

  assert.equal(snapshot.room, player.room);
  assert.equal(snapshot.inventory.length, objects.items.length);
  assert.equal(snapshot.objects[0]!.x, ego.x);
  assert.equal(snapshot.objects[0]!.view, ego.view);
  assert.equal(snapshot.picture !== null, true, 'a room has a picture');
});

test('scenery a script added to the picture is replayed, not lost', () => {
  // A save holds the picture's *number*, and pictures are files. Anything a
  // script painted on top of one has to be put back by hand, or a game
  // restored in Lefty's bar comes back without its customers.
  const player = new Player();
  player.playOpening();

  // Lefty's bar, entered directly rather than walked to: what is being tested
  // is the picture, not the way there.
  const machine = player.machine;
  enterRoom(machine, 15);
  player.run(20);

  const snapshot = captureSnapshot(machine);
  assert.ok(snapshot.scenery.length > 0, 'the bar paints its own scenery');

  const before = machine.background.visual.slice();
  const other = new Player();
  other.playOpening();
  applySnapshot(other.machine, snapshot);

  assert.deepEqual(other.machine.background.visual, before, 'the picture comes back whole');
});

test('a script waiting mid-question comes back where it was waiting', () => {
  // scanStart lives beside a script's decoded instructions, which makes it look
  // like a property of the resource. It is state: without it every waiting
  // script restarts its question.
  const player = new Player();
  player.playOpening();

  const compiled = player.machine.compile(0);
  compiled.scanStart = 42;

  const snapshot = captureSnapshot(player.machine);
  assert.deepEqual(
    snapshot.scanStarts.find(([id]) => id === 0),
    [0, 42],
  );

  const other = new Player();
  other.playOpening();
  applySnapshot(other.machine, snapshot);

  assert.equal(other.machine.compile(0).scanStart, 42);
});

// --- The store --------------------------------------------------------------

/** localStorage, as a Map, so the store can be tested without a browser. */
class FakeStorage implements KeyValueStore {
  readonly items = new Map<string, string>();
  full = false;

  get length(): number {
    return this.items.size;
  }
  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.full) throw new Error('QuotaExceededError');
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

function store(storage: KeyValueStore | null = new FakeStorage()): SaveStore {
  return new SaveStore({ logic: 46, pic: 1, view: 1, sound: 1, items: 21 }, storage);
}

test('a saved game can be listed and read back', () => {
  const player = new Player();
  player.playOpening();

  const saves = store();
  const slot = saves.save('in the street', captureSnapshot(player.machine));

  assert.deepEqual(
    saves.list().map((s) => s.name),
    ['in the street'],
  );
  assert.equal(saves.load(slot.id)?.snapshot.room, player.room);
});

test('saving under a name already used replaces that game', () => {
  const player = new Player();
  player.playOpening();
  const saves = store();

  saves.save('mine', captureSnapshot(player.machine));
  player.playAWhile();
  saves.save('mine', captureSnapshot(player.machine));

  assert.equal(saves.list().length, 1, 'one name, one slot');
});

test('saves of one game are invisible to another', () => {
  const storage = new FakeStorage();
  const mine = store(storage);
  const other = new SaveStore({ logic: 9, pic: 9, view: 9, sound: 9, items: 9 }, storage);

  const player = new Player();
  player.playOpening();
  mine.save('mine', captureSnapshot(player.machine));

  assert.equal(mine.list().length, 1);
  assert.equal(other.list().length, 0);
});

test('a storage that refuses to write says so instead of losing the game', () => {
  const storage = new FakeStorage();
  storage.full = true;

  const player = new Player();
  player.playOpening();

  assert.throws(() => store(storage).save('doomed', captureSnapshot(player.machine)), StorageError);
});

test('a browser with no storage at all is a store that says it is unavailable', () => {
  const saves = store(null);

  assert.equal(saves.available, false);
  assert.deepEqual(saves.list(), []);
  assert.throws(() => saves.save('nowhere', {} as never), StorageError);
});

test('a damaged slot is skipped rather than hiding the good ones', () => {
  const storage = new FakeStorage();
  const saves = store(storage);

  const player = new Player();
  player.playOpening();
  saves.save('good', captureSnapshot(player.machine));
  storage.setItem('web-agi:save:46-1-1-1-21:broken', '{not json');

  assert.deepEqual(
    saves.list().map((s) => s.name),
    ['good'],
  );
});

test('saves survive a trip through a file', () => {
  const player = new Player();
  player.playOpening();

  const written = store();
  written.save('one', captureSnapshot(player.machine));
  player.playAWhile();
  written.save('two', captureSnapshot(player.machine));

  const text = exportSaves(written);

  const read = store();
  assert.equal(importSaves(read, text), 2);
  assert.deepEqual(
    read.list().map((slot) => slot.name).sort(),
    ['one', 'two'],
  );

  // And the imported game is a game, not just a name.
  const slot = read.list().find((s) => s.name === 'two')!;
  applySnapshot(player.machine, slot.snapshot);
  assert.equal(player.room, slot.snapshot.room);
});

test('a file of saves from another game is refused whole', () => {
  const player = new Player();
  player.playOpening();

  const written = store();
  written.save('mine', captureSnapshot(player.machine));
  const text = exportSaves(written).replace(written.game, '9-9-9-9-9');

  const other = store();
  assert.throws(() => importSaves(other, text), StorageError);
  assert.equal(other.list().length, 0, 'and nothing was taken in on the way');
});

test('a file that is not saves at all is refused', () => {
  assert.throws(() => importSaves(store(), 'not json'), StorageError);
  assert.throws(() => importSaves(store(), '{"format":"something else"}'), StorageError);
});

// --- The screens the player sees --------------------------------------------

test('the save screen writes a game the restore screen can bring back', () => {
  const player = new Player();
  player.playOpening();
  player.machine.saves = store();

  const save = new SaveScreen(player.machine.saves, player.machine);
  for (const character of 'street') save.key(player.machine, keyNamed(character));
  assert.equal(save.key(player.machine, keyNamed('Enter')), true, 'Enter finishes the save');
  assert.equal(save.saved, true);

  // The state, not the pixels: the sprites are composited back onto the screen
  // by the next cycle, so comparing the display here would only be measuring
  // that the game had not run yet.
  const { savedAt: _saved, ...expected } = captureSnapshot(player.machine);

  player.playAWhile();
  assert.notEqual(player.room + player.machine.viewTable.ego.x, expected.room + expected.objects[0]!.x);

  const restore = new RestoreScreen(player.machine.saves);
  assert.equal(restore.key(player.machine, keyNamed('Enter')), true);
  assert.equal(restore.restored, true);

  const { savedAt: _back, ...actual } = captureSnapshot(player.machine);
  assert.deepEqual(actual, expected, 'and is back where it was saved');
});

test('the save screen refuses an empty name rather than writing one', () => {
  const player = new Player();
  player.playOpening();
  const saves = store();

  const save = new SaveScreen(saves, player.machine);
  for (let i = 0; i < 40; i++) save.key(player.machine, keyNamed('Backspace'));

  assert.equal(save.key(player.machine, keyNamed('Enter')), false, 'the screen stays open');
  assert.equal(saves.list().length, 0);
});

test('restoring abandons the rest of the cycle, as a room change does', () => {
  // The script that asked to restore belongs to the game that has just been
  // thrown away; running the rest of it would be running it against someone
  // else's state.
  const player = new Player();
  player.playOpening();
  player.machine.saves = store();
  player.machine.saves.save('here', captureSnapshot(player.machine));

  const restore = new RestoreScreen(player.machine.saves);
  restore.key(player.machine, keyNamed('Enter'));
  restore.finish(player.machine);

  assert.equal(player.machine.restored, true, 'the machine is told to unwind');

  // And the game carries on afterwards.
  player.run(20);
  assert.equal(player.machine.stopped, false);
  assert.equal(player.room, 11);
});

test('a save from another game is refused by the screen, not by a crash', () => {
  const player = new Player();
  player.playOpening();
  const saves = store();

  const snapshot = captureSnapshot(player.machine);
  saves.save('stranger', { ...snapshot, game: { ...snapshot.game, view: 1 } });

  const restore = new RestoreScreen(saves);
  assert.equal(restore.key(player.machine, keyNamed('Enter')), false, 'the screen stays open');
  assert.equal(restore.restored, false);
});

// --- Snapshots that must be refused -----------------------------------------

test('a snapshot from another format is refused rather than half-applied', () => {
  const player = new Player();
  player.playOpening();

  const snapshot = captureSnapshot(player.machine);
  const room = player.room;

  assert.throws(
    () => applySnapshot(player.machine, { ...snapshot, version: SNAPSHOT_VERSION + 1 }),
    SaveError,
  );
  assert.equal(player.room, room, 'and nothing was touched on the way out');
});

test('a snapshot from another game is refused', () => {
  const player = new Player();
  player.playOpening();

  const snapshot = captureSnapshot(player.machine);
  const stranger = { ...snapshot, game: { ...snapshot.game, view: snapshot.game.view + 1 } };

  assert.throws(() => applySnapshot(player.machine, stranger), SaveError);
});
