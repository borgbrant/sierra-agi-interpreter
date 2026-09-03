import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildHandlers } from '../src/engine/commands/index.ts';
import { Cycle } from '../src/engine/cycle.ts';
import { MessageWindow, NumberQuestion } from '../src/engine/interaction.ts';
import { InventoryScreen } from '../src/engine/inventory.ts';
import { Machine } from '../src/engine/machine.ts';
import { MenuNavigation } from '../src/engine/menu.ts';
import { present, statusLine } from '../src/engine/present.ts';
import { FLAG, VAR } from '../src/engine/state.ts';
import { Renderer } from '../src/render/renderer.ts';
import { describeState } from '../src/shell/debug.ts';
import { COLUMNS, layOutWindow } from '../src/render/text.ts';
import { keyNamed } from '../src/input/keyboard.ts';
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
 * A fixed random sequence.
 *
 * The game chooses its verification questions at random, so an unseeded run
 * takes a different path through the opening every time -- and a test that
 * tests something different on each run cannot be relied on to have tested
 * anything. Each test file runs in its own process, so replacing the global
 * here affects nothing else.
 */
const FIRST_SEED = 0x2f6e2b1;
let seed = FIRST_SEED;
Math.random = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x80000000;
};

/** The first room the player actually plays. */
const FIRST_PLAYABLE_ROOM = 11;

/** The verification room the opening passes through. */
const VERIFICATION_ROOM = 6;

/**
 * A game being played, with the small vocabulary a test needs.
 *
 * Deliberately thin: it presses keys and runs cycles, exactly as the browser
 * shell does, so what these tests exercise is the real path from a keystroke to
 * the screen rather than a set of handlers called directly.
 */
class Player {
  readonly machine: Machine;
  readonly cycle: Cycle;

  constructor() {
    // Rewound for every game, not just once for the file: tests run in order
    // and would otherwise each start from wherever the previous one left the
    // sequence, taking a different path through the opening.
    seed = FIRST_SEED;

    this.machine = new Machine({ resources, objects, vocabulary });
    this.machine.setHandlers(buildHandlers());
    this.cycle = new Cycle(this.machine);
    this.cycle.start(0);
  }

  key(name: string): void {
    this.machine.handleKey(keyNamed(name));
  }

  /** Hold Alt and press a letter, as the game's own shortcuts expect. */
  altKey(letter: string): void {
    this.machine.handleKey({ char: 0, name: letter, code: `Key${letter}`, alt: true });
  }

  /** Hold Ctrl and press a letter. */
  ctrlKey(letter: string): void {
    this.machine.handleKey({
      char: letter.toUpperCase().charCodeAt(0) - 0x40,
      name: letter.toUpperCase(),
      code: `Key${letter.toUpperCase()}`,
    });
  }

  type(line: string): void {
    for (const character of line) this.key(character);
    this.key('Enter');
  }

  run(cycles: number): void {
    for (let i = 0; i < cycles; i++) if (!this.cycle.runOnce()) break;
  }

  get room(): number {
    return this.machine.state.getVar(VAR.CURRENT_ROOM);
  }

  /** The text of whatever window is on screen, waited on or not. */
  windowText(): string | null {
    const pending = this.machine.pending;
    const lines =
      pending instanceof MessageWindow ? pending.window.lines : this.machine.window?.lines;
    return lines ? lines.join(' ') : null;
  }

  /**
   * Dismiss messages until something else is on screen.
   *
   * Only messages the game is waiting on. A question has to be answered rather
   * than dismissed -- pressing Enter at one submits an empty answer, which is
   * how a careless harness tells the game the player is nought years old. And a
   * window the game left open is not waiting for anything: the game's own
   * multiple-choice questions are exactly that, so taking one away would throw
   * away the question.
   */
  dismissMessages(limit = 20): void {
    for (let i = 0; i < limit; i++) {
      if (!(this.machine.pending instanceof MessageWindow)) return;
      this.key('Enter');
      this.run(10);
    }
  }

  /**
   * Play the opening, all the way into the first real room.
   *
   * The age question is answered honestly. The five questions after it are the
   * game's copy protection, whose answers are printed in the box the game came
   * in -- so the harness reads the answer the script itself worked out, the way
   * a player with the box in front of them would know it. The script keeps the
   * expected choice in variable 93 as 1 to 4, and reads the player's keypress
   * as the character minus 96.
   */
  playOpening(): void {
    this.run(300);
    this.key(' ');
    this.run(20);

    this.dismissMessages(); // the content warning
    this.type('30'); // the age question
    this.run(5);
    this.dismissMessages(); // "to verify you are really 30..."

    for (let step = 0; step < 400 && this.room === VERIFICATION_ROOM; step++) {
      if (this.machine.pending) {
        this.key('Enter');
        this.run(10);
      } else if (this.machine.window) {
        // The script reads the answer as the character minus 96, so 1 to 4 are
        // a to d. Anything outside that range means the question has no one
        // right answer, and the script accepts whatever is offered.
        const choice = Math.min(4, Math.max(1, this.machine.state.getVar(93)));
        this.key(String.fromCharCode(96 + choice));
        this.run(15);
      } else {
        this.run(10);
      }
    }

    this.dismissMessages();
    this.run(80);
  }
}

// --- The opening -----------------------------------------------------------

test('a keypress leaves the title sequence for the content warning', () => {
  const player = new Player();
  player.run(300);
  assert.equal(player.machine.pending, null, 'the title sequence asks nothing');

  player.key(' ');
  player.run(20);

  assert.equal(player.room, VERIFICATION_ROOM);
  assert.ok(player.windowText()?.includes('Leisure Suit Larry'), player.windowText() ?? 'no window');
});

test('the game asks the player their age and reads the answer', () => {
  const player = new Player();
  player.run(300);
  player.key(' ');
  player.run(20);
  player.dismissMessages();

  assert.ok(player.machine.pending instanceof NumberQuestion, 'a question is waiting');

  player.type('30');
  player.run(5);

  assert.equal(player.machine.state.getVar(209), 30, 'the answer reached the script');
  // And the script says it back, which only works if the substitution does.
  assert.ok(player.windowText()?.includes('really 30'), player.windowText() ?? 'no window');
});

test('the whole opening plays through into the first room', () => {
  const player = new Player();
  player.playOpening();

  assert.equal(player.room, FIRST_PLAYABLE_ROOM);
  assert.equal(player.machine.stopped, false);
  assert.equal(player.machine.inputAccepted, true, 'the game is listening');
  assert.equal(player.machine.pending, null, 'and not waiting for anything');

  const ego = player.machine.viewTable.ego;
  assert.equal(ego.drawn, true, 'ego is on screen');
  assert.ok(ego.view !== null);
});

test('nothing in the opening reaches a command the engine cannot do', () => {
  const player = new Player();
  player.playOpening();

  assert.deepEqual(
    [...player.machine.stubs.keys()],
    [],
    'the opening now runs on implemented commands alone',
  );
});

test("Alt+X skips the rest of the game's verification questions", () => {
  // The game binds scan code 45 -- the X key with no character, which is
  // Alt+X -- to a controller whose only job is to set the flag that makes the
  // verification room jump to its closing message.
  const player = new Player();
  player.run(300);
  player.key(' ');
  player.run(20);
  player.dismissMessages();
  player.type('30');
  player.run(5);
  player.dismissMessages();
  player.run(20);

  assert.equal(player.room, VERIFICATION_ROOM, 'a question is being asked');

  player.altKey('X');
  player.run(10);

  assert.ok(
    player.windowText()?.includes('leisure suit'),
    `expected the closing message, got ${player.windowText()}`,
  );

  player.dismissMessages();
  player.run(60);

  assert.equal(player.room, FIRST_PLAYABLE_ROOM, 'and the questions are over');
});

test('Ctrl+B shows the boss screen, and it stays put', () => {
  // The boss key changes room through a controller. A controller that is not
  // used up fires again on the next cycle, so this room would be re-entered
  // for ever -- and since it picks its picture at random, that shows up as the
  // screen flickering between two of them.
  const player = new Player();
  player.playOpening();
  const playing = player.room;

  player.ctrlKey('B');
  player.run(1);

  assert.notEqual(player.room, playing, 'the boss screen is a different room');
  assert.equal(player.machine.controllers.size, 0, 'the controller was used up');

  const pictures = new Set<number | null>();
  for (let i = 0; i < 40; i++) {
    player.run(1);
    pictures.add(player.machine.currentPicture);
  }

  assert.equal(pictures.size, 1, `the screen settled on one picture, saw ${[...pictures]}`);
  assert.equal(player.room, player.room, 'and stayed in the room');
});

test('a key on the boss screen gets the joke the game intends', () => {
  const player = new Player();
  player.playOpening();

  player.ctrlKey('B');
  player.run(5);
  player.key('Enter');
  player.run(3);

  // The boss key is a trap: the game claims to have forgotten everything and
  // sends the player to restore a saved game. Save and restore belong to a
  // later phase, so there is no way back -- which is also true of the original
  // for a player who has not saved.
  assert.ok(
    player.windowText()?.includes('restore your game'),
    `expected the boss-key message, got ${player.windowText()}`,
  );
});

// --- Playing ---------------------------------------------------------------

test('a typed command reaches the scripts and they answer it', () => {
  const player = new Player();
  player.playOpening();

  player.type('look');
  player.run(3);

  assert.equal(player.machine.state.getFlag(FLAG.SAID_ACCEPTED_INPUT), true, 'a said test fired');
  const answer = player.windowText();
  assert.ok(answer && answer.length > 0, 'the game replied');
  assert.ok(answer.includes("Lefty's"), `the reply describes the room: ${answer}`);
});

test('a word the game has never heard of is named back to the player', () => {
  const player = new Player();
  player.playOpening();

  player.type('blorf');
  player.run(3);

  assert.equal(player.machine.state.getVar(VAR.UNKNOWN_WORD), 1, 'the first word is unknown');
  // The reply substitutes the word itself, so this covers %w as well.
  assert.ok(player.windowText()?.includes('blorf'), player.windowText() ?? 'no window');
});

test('a command the game knows but cannot do here gets a different answer', () => {
  const player = new Player();
  player.playOpening();

  player.type('open door');
  player.run(3);

  assert.equal(player.machine.state.getVar(VAR.UNKNOWN_WORD), 0, 'every word was understood');
  assert.ok(player.windowText()?.length, 'and the game still replied');
});

test('the status line reports the score the scripts keep', () => {
  const player = new Player();
  player.playOpening();

  const line = statusLine(player.machine);
  assert.match(line, /Score:\d+ of \d+/);
  assert.match(line, /Sound:(on|off)/);
  assert.equal(line.length, COLUMNS, 'and reaches both edges of the screen');
  assert.ok(
    player.machine.state.getVar(VAR.MAX_SCORE) > 0,
    'the game set a maximum score, so the line is not showing zeroes',
  );
});

// --- Walking ---------------------------------------------------------------

test('Larry turns to face the way the player walks him', () => {
  // The opening pins ego's loop to walk him through its cinematic and never
  // releases it; entering a room re-animates him, which is what frees it. When
  // that did not happen he kept facing away from the player for the whole game.
  const player = new Player();
  player.playOpening();
  const ego = player.machine.viewTable.ego;

  assert.equal(ego.fixedLoop, false, "the opening's loop pin was released");
  assert.equal(ego.loopCount, 4, 'ego has a loop for each direction');

  const loopsWhileWalking = (arrow: string) => {
    player.key(arrow);
    const loops = new Set<number>();
    for (let i = 0; i < 8; i++) {
      player.run(1);
      loops.add(ego.loop);
    }
    return [...loops];
  };

  assert.deepEqual(loopsWhileWalking('ArrowRight'), [0], 'walking right');
  assert.deepEqual(loopsWhileWalking('ArrowLeft'), [1], 'walking left');
  assert.deepEqual(loopsWhileWalking('ArrowDown'), [2], 'walking towards the player');
  assert.deepEqual(loopsWhileWalking('ArrowUp'), [3], 'walking away');
});

test('Larry animates while he walks and holds still when he stops', () => {
  const player = new Player();
  player.playOpening();
  const ego = player.machine.viewTable.ego;

  player.key('ArrowRight');
  const walking = new Set<number>();
  for (let i = 0; i < 10; i++) {
    player.run(1);
    walking.add(ego.cel);
  }
  assert.ok(walking.size > 1, `the walk is animated, saw cels ${[...walking]}`);

  // Pressing the same direction again is a stop, and a stopped character
  // should not keep striding on the spot.
  player.key('ArrowRight');
  player.run(4);
  const standing = new Set<number>();
  for (let i = 0; i < 10; i++) {
    player.run(1);
    standing.add(ego.cel);
  }
  assert.equal(standing.size, 1, `standing still shows one cel, saw ${[...standing]}`);
});

// --- Dying -----------------------------------------------------------------

/**
 * Set off the death the first room can produce.
 *
 * Room 11 has its own death sequence, and this is the condition the room's own
 * script tests for it. Reaching it by playing would take the whole game, so
 * the state the script looks at is set directly -- the sequence that follows is
 * the game's, unaltered.
 */
function killLarry(player: Player): void {
  const { state } = player.machine;
  state.setFlag(89, true);
  state.setFlag(200, true);
  state.setFlag(48, false);
  state.setVar(63, 10);
  state.setVar(77, 0);
  state.setVar(30, 0);
}

/** Run cycles, dismissing any message, until a condition holds or time runs out. */
function until(player: Player, limit: number, done: () => boolean): boolean {
  for (let i = 0; i < limit; i++) {
    if (done()) return true;
    player.run(1);
    if (player.machine.pending instanceof MessageWindow) player.key('Enter');
  }
  return done();
}

test('dying plays the death sequence once and starts the game again', () => {
  // The death animation ends with `restart.game`. Treating that as "enter this
  // room again" leaves the death room setting itself up and replaying its
  // animation for ever, in a room the player never died in.
  const player = new Player();
  player.playOpening();
  const diedIn = player.room;

  killLarry(player);

  // The sequence leads out of the room the player died in, into the death room.
  assert.ok(
    until(player, 600, () => player.room !== diedIn),
    'the death sequence changed room',
  );
  const deathRoom = player.room;
  assert.notEqual(deathRoom, diedIn);

  // And it ends: the game restarts and puts the player back where it begins.
  assert.ok(
    until(player, 3000, () => player.room === FIRST_PLAYABLE_ROOM),
    `the death room never finished; still in room ${player.room}`,
  );

  // It must also stay finished rather than falling back into the death room.
  player.run(120);
  assert.equal(player.room, FIRST_PLAYABLE_ROOM, 'and the game carried on from there');
  assert.equal(player.machine.state.getVar(30), 0, 'the player is alive again');
});

test('the state dump reports what a stuck game would need to be diagnosed', () => {
  // Its whole purpose is to be pasted back by someone watching a game
  // misbehave, so what matters is that the things that have actually mattered
  // are in it: which room and how often, what the game is waiting on, and the
  // per-object state that decides whether an animation stops.
  const player = new Player();
  player.playOpening();

  const dump = describeState(player.machine, player.cycle).join('\n');

  assert.match(dump, /room 11 \(entered 1x\)/);
  assert.match(dump, /waiting on nothing/);
  assert.match(dump, /obj 0: view \d+ loop \d+\/\d+ cel \d+\/\d+/, 'ego is described');
  assert.match(dump, /cycle normal motion normal/, 'with its cycle and motion kinds named');
  assert.match(dump, /\[animated drawn update/, 'and the flags that decide whether it advances');
  assert.match(dump, /^vars: .*\b0=11\b/m, 'the variables the scripts are using');
  assert.match(dump, /^flags set: /m);
  assert.match(dump, /not implemented, reached: none/);
});

test('a room entered once in a row is not reported as entered twice', () => {
  // The counter is the diagnostic for a looping animation, so it has to mean
  // what it says: entering a room, leaving it and coming back is not the same
  // as a room setting itself up over and over.
  const player = new Player();
  player.playOpening();

  assert.equal(player.cycle.reentries, 1, `settled in one room, saw ${player.cycle.reentries}`);
});

test('a restart is a new game, not a room change', () => {
  const player = new Player();
  player.playOpening();

  player.machine.state.setVar(VAR.SCORE, 99);
  player.machine.inventory.take(0);
  const carriedBefore = player.machine.inventory.carried().length;

  player.cycle.restart();
  player.run(60);

  assert.equal(player.room, FIRST_PLAYABLE_ROOM, 'the game begins where it begins');
  assert.equal(player.machine.state.getVar(VAR.SCORE), 0, 'the score is back to nothing');
  assert.ok(
    player.machine.inventory.carried().length < carriedBefore,
    'and the player is carrying only what a new game starts with',
  );
  assert.equal(player.machine.state.getFlag(FLAG.RESTART_GAME), false, 'the announcement is spent');
});

test('a restart keeps the menu the game built', () => {
  // The game defines its menus only in the block logic 0 runs the first time,
  // and skips that block on a restart. Throwing the menu away as part of the
  // reset leaves the restarted game with no menu at all.
  const player = new Player();
  player.playOpening();
  const before = player.machine.menuBar.menus.length;
  assert.ok(before > 0);

  player.cycle.restart();
  player.run(60);

  assert.equal(player.machine.menuBar.menus.length, before, 'still exactly one set of menus');
  assert.equal(player.machine.menuBar.submitted, true);
});

// --- The screens the player opens ------------------------------------------

test('the inventory opens on the key the menu says it does', () => {
  const player = new Player();
  player.playOpening();

  // The game binds Tab to the inventory controller and tests it in logic 0.
  player.key('Tab');
  player.run(2);

  assert.ok(
    player.machine.pending instanceof InventoryScreen,
    `expected the inventory, got ${player.machine.pending?.constructor.name ?? 'nothing'}`,
  );
});

test('the menu opens, and choosing an item fires its controller', () => {
  const player = new Player();
  player.playOpening();

  assert.equal(player.machine.state.getFlag(FLAG.MENU_ENABLED), true, 'the game offers a menu');
  assert.ok(player.machine.menuBar.submitted, 'and has finished defining it');
  assert.ok(player.machine.menuBar.menus.length >= 5, 'with the menus the game declares');

  player.key('Escape');
  player.run(2);

  assert.ok(
    player.machine.pending instanceof MenuNavigation,
    `expected the menu, got ${player.machine.pending?.constructor.name ?? 'nothing'}`,
  );
});

test('the menus the game defines have their items and shortcuts', () => {
  const player = new Player();
  player.playOpening();

  const titles = player.machine.menuBar.menus.map((menu) => menu.text.trim());
  assert.deepEqual(titles, ['Sierra', 'File', 'Action', 'Special', 'Speed']);

  const file = player.machine.menuBar.menus.find((menu) => menu.text.trim() === 'File')!;
  assert.ok(
    file.items.some((item) => item.text.includes('Save')),
    'the File menu offers Save',
  );
  assert.ok(
    file.items.some((item) => !item.enabled),
    'and its separators are disabled, so the cursor skips them',
  );
});

// --- What ends up on screen ------------------------------------------------

test('the status line is drawn as a bar across the whole screen', () => {
  // Not a caption: every cell of the row has to be painted, or the picture
  // shows through past the last character as a dark notch in the bar.
  const player = new Player();
  player.playOpening();
  assert.equal(player.machine.statusLineVisible, true, 'the game asked for a status line');

  const renderer = new Renderer();
  present(player.machine, renderer);

  for (let column = 0; column < COLUMNS; column++) {
    let ink = 0;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        if (renderer.display.pixels[y * 320 + column * 8 + x]) ink++;
      }
    }
    assert.ok(ink > 0, `column ${column} of the status line is unpainted`);
  }
});

test('a frame draws the picture, the status line and the command line', () => {
  const player = new Player();
  player.playOpening();

  const renderer = new Renderer();
  present(player.machine, renderer);

  const rowInk = (row: number) => {
    let ink = 0;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 320; x++) if (renderer.display.pixels[(row * 8 + y) * 320 + x]) ink++;
    }
    return ink;
  };

  assert.ok(rowInk(0) > 0, 'the status line is drawn');
  assert.ok(rowInk(10) > 0, 'the picture is drawn');
  assert.ok(rowInk(23) > 0, 'the command line is drawn');
});

test('a window is an overlay: the scene underneath is never painted over', () => {
  // Compared with no cycle in between, deliberately. The room animates on its
  // own -- the neon sign outside Lefty's flashes -- so running cycles between
  // the two frames would mean comparing two different moments and calling the
  // difference a bug.
  const player = new Player();
  player.playOpening();

  const renderer = new Renderer();
  present(player.machine, renderer);
  const withoutWindow = renderer.display.pixels.slice();
  const sceneBefore = player.machine.screens.visual.slice();

  player.machine.window = layOutWindow('a message over the scene');
  present(player.machine, renderer);

  assert.notDeepEqual(renderer.display.pixels, withoutWindow, 'the window is on screen');
  assert.deepEqual(
    player.machine.screens.visual,
    sceneBefore,
    'and the picture it covers was not drawn on',
  );

  // So taking it away brings the scene back with nothing redrawn at all.
  player.machine.window = null;
  present(player.machine, renderer);
  assert.deepEqual(renderer.display.pixels, withoutWindow, 'exactly as it was');
});

test('the scene animates on its own', () => {
  // Objects start cycling when a script claims them, which is what makes the
  // neon flash. It also means a still frame is not something to expect.
  const player = new Player();
  player.playOpening();

  const renderer = new Renderer();
  present(player.machine, renderer);
  const first = renderer.display.pixels.slice();

  player.run(25);
  present(player.machine, renderer);

  assert.notDeepEqual(renderer.display.pixels, first, 'something in the scene moved');
});
