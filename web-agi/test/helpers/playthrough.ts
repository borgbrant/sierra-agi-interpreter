/**
 * Playing a whole game, as a test can drive it.
 *
 * `test/walk-throughs/` holds a distilled solution for each bundled game --
 * the typed commands and the points they pay. This is what turns one of those
 * into something a test can run: a player that presses keys, walks, and types
 * lines, and a runner that takes a list of steps and reports how far it got.
 *
 * Everything here is game-agnostic. Nothing in this file knows a room number,
 * a command or a score; those live in the walk-through tests beside it. The
 * one thing it does know is that a game may open with a title screen and with
 * questions, and that getting past those is not part of the walk-through.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildHandlers } from '../../src/engine/commands/index.ts';
import { Cycle } from '../../src/engine/cycle.ts';
import { ObjectCloseUp } from '../../src/engine/inventory.ts';
import { KeyPress, MessageWindow, NumberQuestion } from '../../src/engine/interaction.ts';
import { Machine } from '../../src/engine/machine.ts';
import { applySnapshot, captureSnapshot, type Snapshot } from '../../src/engine/snapshot.ts';
import { VAR } from '../../src/engine/state.ts';
import { keyNamed } from '../../src/input/keyboard.ts';
import { CONTROL, PICTURE_HEIGHT, PICTURE_WIDTH, Screens } from '../../src/render/screens.ts';
import { ResourceManager } from '../../src/resources/manager.ts';
import { readInterpreterVersion } from '../../src/resources/interpreter.ts';
import { parseObjectFile } from '../../src/resources/objects.ts';
import { Vocabulary } from '../../src/resources/words.ts';
import { DiskSource } from './disk-source.ts';

/** Where the bundled games live: a directory per game. */
export const GAMES = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'public',
  'games',
);

/**
 * Every line the walk-through says the player types.
 *
 * Read out of the markdown rather than copied into a test, so the prose and
 * what runs cannot drift apart: the table marks typed input as `said(...)` and
 * everything else -- walking, waiting, standing somewhere -- as prose, which
 * is exactly the distinction a parser test needs.
 */
export function typedLines(walkThrough: string): string[] {
  const file = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'walk-throughs', walkThrough);
  const lines: string[] = [];
  for (const row of readFileSync(file, 'utf8').split('\n')) {
    // Table rows only. The file explains its own notation further up, and the
    // `said(...)` in that explanation is not something anybody types.
    if (!row.startsWith('|')) continue;
    for (const match of row.matchAll(/`said\(([^)]*)\)`/g)) lines.push(match[1]!.trim());
  }
  return lines;
}

export function gameIsBundled(id: string): boolean {
  try {
    return readdirSync(resolve(GAMES, id)).length > 0;
  } catch {
    return false;
  }
}

/**
 * A fixed random sequence, installed per game.
 *
 * Both games make choices at random -- which verification question is asked,
 * which way a wandering character turns -- and a playthrough that takes a
 * different path on every run cannot be said to have played through anything.
 * Each test file is its own process, so replacing the global affects nothing
 * else, and every new game rewinds it.
 */
const FIRST_SEED = 0x2f6e2b1;
let seed = FIRST_SEED;
Math.random = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x80000000;
};

/**
 * The eight ways to walk, as the keys that produce them.
 *
 * The keypad rather than the arrows, because the diagonals only exist there
 * and a room whose walkable floor is a slanting corridor -- Lefty's back
 * passage is one -- cannot be crossed without them.
 */
export const ARROW = {
  north: 'Numpad8',
  northEast: 'Numpad9',
  east: 'Numpad6',
  southEast: 'Numpad3',
  south: 'Numpad2',
  southWest: 'Numpad1',
  west: 'Numpad4',
  northWest: 'Numpad7',
} as const;

export type Direction = keyof typeof ARROW;

/**
 * One line of a walk-through, as something to do.
 *
 * `say` is what the player types, and `points` is what the walk-through says
 * that pays -- given, it is what the step is judged by, and a step that pays
 * the wrong number of points fails as surely as one that pays none. `expect`
 * judges a step that pays nothing by what the game answers. `go` leaves the
 * room by an edge, `walk` stands somewhere in particular, and `wait` lets the
 * game get on with something the player does not type.
 *
 * `points` is not only for typed lines: a game may pay for a step the player
 * did not type -- Larry's clerk hands over the goods, and charges for them,
 * several seconds after the last question is answered -- so a `wait` carries
 * the points as readily as a `say`.
 *
 * `repeat` is for the steps a walk-through gives as a single line and the game
 * only grants on some tries: the man with the apples is outside the casino if
 * the room's own die says so and not otherwise, and what the source means by
 * "buy an apple" is "leave and come back until he is there". It runs its steps
 * until `until` says the game has played along.
 *
 * `press` is for the parts of a game that are not typed at all -- Larry's
 * blackjack table is played on the function keys -- and `save` and `restore`
 * are the last thing a walk-through needs: a game of chance is won by saving
 * before the hand and restoring after a bad one, which is what every source
 * for this game says to do and what a `repeat` around a `restore` does here.
 */
export type Step = { points?: number } & (
  | { say: string; expect?: RegExp; enters?: number }
  | { go: Direction; enters?: number }
  | { walk: readonly [number, number]; within?: number }
  | { wait: number }
  | { answer: string; times?: number }
  | { swims: boolean }
  | { signals: boolean }
  | { flee: number; cycles: number }
  | { stalk: number; gap: readonly [number, number]; below?: number; cycles?: number }
  | { press: string; times?: number }
  | { save: true }
  | { restore: true }
  | { repeat: readonly Step[]; until: (playthrough: Playthrough) => boolean; times?: number }
);

/** How far a walk-through got, and what stopped it. */
export interface Progress {
  /** Steps completed. */
  taken: number;
  of: number;
  /** The step that failed, or null if none did. */
  step: Step | null;
  score: number;
  room: number;
  position: { x: number; y: number };
  /** What the game said while the failing step was tried. */
  why: string;
}

/** A one-line account of a walk-through's progress, for an assertion message. */
export function describe(progress: Progress): string {
  if (!progress.step) return `all ${progress.of} steps, score ${progress.score}`;
  const step = progress.step;
  const what = (): string => {
    if ('say' in step) return `said(${step.say})`;
    if ('go' in step) return `go ${step.go}`;
    if ('walk' in step) return `walk to ${step.walk.join(',')}`;
    if ('answer' in step) return `answer "${step.answer}"`;
    if ('swims' in step) return `swims = ${step.swims}`;
    if ('signals' in step) return `signals = ${step.signals}`;
    if ('flee' in step) return `flee object ${step.flee} for ${step.cycles} cycles`;
    if ('stalk' in step) return `stalk object ${step.stalk} to within ${step.gap.join('-')}`;
    if ('repeat' in step) return `${step.repeat.length} steps until the game plays along`;
    if ('press' in step) return `press ${step.press}`;
    if ('save' in step) return 'save';
    if ('restore' in step) return 'restore';
    return `wait ${step.wait}`;
  };
  return (
    `stopped at step ${progress.taken + 1} of ${progress.of}, ${what()}, ` +
    `in room ${progress.room} at ${progress.position.x},${progress.position.y}, ` +
    `score ${progress.score} -- the game said: ${progress.why}`
  );
}

/** Ego is object 0, in every AGI game. */
const EGO_NUMBER = 0;

/**
 * How wide a strip along the edge of a room counts as the way out.
 *
 * Two pixels: the games test their edges with `posn` boxes a pixel or two
 * deep, and ego's own step is one pixel.
 */
const EDGE_BAND = 2;

/**
 * How far in off the edge a route is allowed to end.
 *
 * Just past the strip that leaves the room, and no further: a corridor that
 * reaches the edge may be only a few pixels wide -- the passage out of the
 * back of Lefty's is five -- so a staging point further in is a point that is
 * not in the corridor at all.
 */
const STAGING = EDGE_BAND + 1;

/** How far in off the edge to step before planning a route across a room. */
const INWARDS = 12;

/** How far one step in each direction moves an object. */
const STEP: Record<Direction, { dx: number; dy: number }> = {
  north: { dx: 0, dy: -1 },
  northEast: { dx: 1, dy: -1 },
  east: { dx: 1, dy: 0 },
  southEast: { dx: 1, dy: 1 },
  south: { dx: 0, dy: 1 },
  southWest: { dx: -1, dy: 1 },
  west: { dx: -1, dy: 0 },
  northWest: { dx: -1, dy: -1 },
};

interface Loaded {
  resources: ResourceManager;
  objects: ReturnType<typeof parseObjectFile>;
  vocabulary: Vocabulary;
  commandCount: number;
}

const loaded = new Map<string, Promise<Loaded>>();

/** Reads a game once per process, however many playthroughs run against it. */
function load(id: string): Promise<Loaded> {
  let already = loaded.get(id);
  if (!already) {
    already = (async () => {
      const source = await DiskSource.open(resolve(GAMES, id));
      const resources = await ResourceManager.open(source);
      await resources.preload();
      const interpreter = readInterpreterVersion((await source.read('AGIDATA.OVL'))!);
      return {
        resources,
        objects: parseObjectFile((await source.read('OBJECT'))!),
        vocabulary: Vocabulary.parse((await source.read('WORDS.TOK'))!),
        commandCount: interpreter.commandCount,
      };
    })();
    loaded.set(id, already);
  }
  return already;
}

/**
 * A game being played through the same path a player's keystrokes take.
 *
 * Deliberately thin, and deliberately not a script runner: it presses keys and
 * runs cycles. What it adds over the `Player` in `playable.test.ts` is walking
 * -- steering ego towards a place or a screen edge -- which is what a
 * walk-through needs and a single-room test does not.
 */
export class Playthrough {
  readonly machine: Machine;
  readonly cycle: Cycle;

  /** Every window the game has shown, in order. The record a step is judged on. */
  readonly said: string[] = [];

  private constructor(game: Loaded) {
    seed = FIRST_SEED;
    this.machine = new Machine(game);
    this.machine.setHandlers(buildHandlers());
    this.cycle = new Cycle(this.machine);
    this.cycle.start(0);
  }

  static async open(id: string): Promise<Playthrough> {
    return new Playthrough(await load(id));
  }

  // --- The keyboard --------------------------------------------------------

  key(name: string): void {
    this.machine.handleKey(keyNamed(name));
  }

  /**
   * Type a line at the prompt and submit it.
   *
   * Anything the game is waiting on is cleared first. A message window eats
   * the next key whatever it is, and what that looks like from the outside is
   * the game complaining it does not understand "alk".
   */
  type(line: string): void {
    this.dismiss();
    for (const character of line) this.key(character);
    this.key('Enter');
  }

  // --- Time ----------------------------------------------------------------

  /**
   * Run cycles, recording anything the game says.
   *
   * A window the game is waiting on is dismissed, because a walk-through's
   * next step cannot be typed while one is up -- and its text is kept first,
   * since that text is the only evidence a step did what it was meant to.
   */
  run(cycles: number): void {
    for (let i = 0; i < cycles; i++) {
      // Dismissing first, and again after: a message that goes up during a
      // cycle would otherwise stop the next one, and a run that quietly does
      // half its cycles is a test that fails on timing for no reason.
      this.dismiss();
      if (this.machine.stopped) break;
      this.cycle.runOnce();
      // A cycle is worth one cycle's time. The shell's loop ages sound from the
      // wall clock, which stands still in a test that runs cycles as fast as it
      // can -- and a script waiting for a sound to end then waits for ever.
      // King's Quest's castle doors are exactly that: `sound(15,28)` and then
      // nothing until flag 28 comes back.
      this.machine.tickSound(this.cycle.intervalMs);
      this.noteWindow();
    }
    this.dismiss();
  }

  /**
   * Clear away everything the game is waiting on that any key gets past.
   *
   * Dismissing one resumes the script, which may print the next straight away,
   * so this is a loop rather than a single keypress. The text is kept first:
   * it is the only evidence a step did what it was meant to.
   *
   * Not only message windows. A script that shows an inventory item close up
   * -- Larry's magazine has a centrefold -- or that spins waiting for a key is
   * waiting in exactly the same way, and a walk-through that does not press
   * the key loses the first letter of its next line to it. What is deliberately
   * left alone is the interactions that want an answer rather than a key:
   * pressing Enter at those is answering them.
   */
  dismiss(limit = 40): void {
    for (let i = 0; i < limit; i++) {
      this.noteWindow();
      const pending = this.machine.pending;
      const anyKeyWillDo =
        pending instanceof MessageWindow ||
        pending instanceof ObjectCloseUp ||
        pending instanceof KeyPress;
      if (!anyKeyWillDo) return;
      this.key('Enter');
    }
  }

  #lastNoted: string | null = null;

  private noteWindow(): void {
    const text = this.windowText();
    if (text === null) {
      this.#lastNoted = null;
      return;
    }
    if (text === this.#lastNoted) return;
    this.#lastNoted = text;
    this.said.push(text);
  }

  /** The text of whatever window is on screen, waited on or not. */
  windowText(): string | null {
    const pending = this.machine.pending;
    const lines =
      pending instanceof MessageWindow ? pending.window.lines : this.machine.window?.lines;
    return lines ? lines.join(' ').replace(/\s+/g, ' ').trim() : null;
  }

  /** What the game has said since a mark taken from {@link said}.length. */
  saidSince(mark: number): string {
    return this.said.slice(mark).join(' | ');
  }

  // --- Where the player is -------------------------------------------------

  get room(): number {
    return this.machine.state.getVar(VAR.CURRENT_ROOM);
  }

  get score(): number {
    return this.machine.state.getVar(VAR.SCORE);
  }

  get ego() {
    return this.machine.viewTable.ego;
  }

  get position(): { x: number; y: number } {
    return { x: this.ego.x, y: this.ego.y };
  }

  // --- Walking -------------------------------------------------------------

  /**
   * Stop walking, whichever way ego was going.
   *
   * The keypad's 5 is the only key that always stops: an arrow key stops ego
   * only when it is the direction he is already walking, and sends him off
   * that way otherwise.
   */
  halt(): void {
    this.key('Numpad5');
    this.run(1);
  }

  /**
   * Walk off a screen edge, into the next room.
   *
   * Not simply "hold the key": the way out of a room is usually a gap in a
   * wall, and pressing north from where ego happens to be stands him against
   * the wall instead. So this walks to each place on that edge he could stand,
   * nearest first, and tries stepping off from there.
   *
   * @returns whether the room actually changed
   */
  exit(direction: Direction, tries = 16): boolean {
    const room = this.room;
    const width = Math.max(1, this.ego.width);
    const top = this.ego.ignoresHorizon ? 0 : this.machine.horizon + 1;
    const { dx, dy } = STEP[direction];

    // Every place on the edge ego could stand, paired with the spot a short
    // step inside it. He is walked to the inside spot and takes the last step
    // with a direction key: routing onto the edge itself is how a walk across
    // a room leaves by an exit nobody asked for.
    const spots: { x: number; y: number; from: { x: number; y: number } }[] = [];
    const put = (x: number, y: number) => {
      if (!this.standable(x, y)) return;
      const from = { x: x - dx * STAGING, y: y - dy * STAGING };
      if (this.standable(from.x, from.y)) spots.push({ x, y, from });
    };

    if (direction === 'north' || direction === 'south') {
      const y = direction === 'north' ? top : PICTURE_HEIGHT - 1;
      for (let x = 0; x + width <= PICTURE_WIDTH; x += 2) put(x, y);
    } else {
      const x = direction === 'west' ? 0 : PICTURE_WIDTH - width;
      for (let y = top; y < PICTURE_HEIGHT; y += 2) put(x, y);
    }

    const here = this.position;
    spots.sort(
      (a, b) =>
        (a.x - here.x) ** 2 + (a.y - here.y) ** 2 - ((b.x - here.x) ** 2 + (b.y - here.y) ** 2),
    );

    let tried = 0;
    for (const spot of spots) {
      // Reachability is settled before ego takes a step, so a wall between him
      // and that part of the edge costs a search rather than a walk.
      const route = this.route(spot.from.x, spot.from.y);
      const end = route?.at(-1);
      if (!end || end.x !== spot.from.x || end.y !== spot.from.y) continue;
      if (tried++ >= tries) break;

      if (!this.walkTo(spot.from.x, spot.from.y, 0)) {
        if (this.room !== room) return true;
        continue;
      }

      this.key(ARROW[direction]);
      for (let i = 0; i < 40 && this.room === room; i++) this.run(1);
      this.halt();
      if (this.room !== room) return true;
    }

    return this.room !== room;
  }

  /**
   * Whether ego's feet could stand at a spot.
   *
   * The engine's own rule, read off the room's control screen: every column of
   * ego's base row has to be clear of the two obstacle colours, and the whole
   * of him has to be below the horizon and inside the picture. What this does
   * not know about is the other characters, who move -- so a path may still be
   * blocked when it is walked, which is what re-planning is for.
   */
  /**
   * Whether the walk planner treats water as ground.
   *
   * Off by default, because in King's Quest the moat is water and walking into
   * it drowns the player -- a harness that wanders a room looking for the
   * right place to type something would drown him on the second screen. A
   * walk-through that has to swim turns it on for those steps, with a
   * `{ swims }` step.
   *
   * Water is a control colour rather than a picture of water, and a game is
   * free to mean something else by it. Larry's convenience store paints the
   * strip of floor in front of the counter with it and reads flag 0 as "close
   * enough to talk to the clerk" -- so the clerk cannot be spoken to at all
   * unless the planner is willing to walk on water.
   */
  swims = false;

  /**
   * Whether the walk planner treats the signal colour as ground.
   *
   * On by default, because a game's usual use for it is a trigger the player
   * is meant to walk over: King's Quest's woodcutter cottage has no door, only
   * a stripe of it down the inside wall, and a planner that would not tread on
   * it could never leave the room.
   *
   * The climbs are the exception. Up the oak and up the beanstalk the same
   * colour is painted over everything that is not the branch, and standing on
   * it drops Graham to the ground -- so those steps turn it off, with a
   * `{ signals }` step, and the planner then keeps to the climb of its own
   * accord.
   */
  treadsOnSignals = true;

  standable(x: number, y: number): boolean {
    const width = Math.max(1, this.ego.width);
    const top = this.ego.ignoresHorizon ? 0 : this.machine.horizon + 1;

    if (x < 0) return false;
    if (y >= PICTURE_HEIGHT || y < top) return false;

    const control = this.machine.background.priority;
    // Columns past the right edge are skipped rather than counted against the
    // spot, which is `checkFooting`'s own rule: a sprite wider than the gap it
    // is standing in hangs off the picture and walks anyway. King's Quest puts
    // Graham there -- eighteen pixels wide with the goat beside him, and rooms
    // hand him in at x=154 -- and a planner that called that unstandable could
    // not move him at all.
    for (let column = 0; column < width && x + column < PICTURE_WIDTH; column++) {
      const at = control[Screens.index(x + column, y)]!;
      if (at === CONTROL.UNCONDITIONAL_OBSTACLE) return false;
      if (at === CONTROL.CONDITIONAL_OBSTACLE && !this.ego.ignoresBlocks) return false;
      if (at === CONTROL.WATER && !this.swims) return false;
      if (at === CONTROL.ALARM && !this.treadsOnSignals) return false;
    }
    return true;
  }

  /**
   * Whether another character is standing where ego wants to put his feet.
   *
   * {@link standable} reads the room's control screen, which is where the
   * walls are and not where the other characters are. The engine blocks on
   * both: `collides` refuses a step whose horizontal span overlaps another
   * object and which lands on that object's base row. A planner that does not
   * know it walks ego into somebody and then re-plans the same step for ever,
   * which is what a follower makes permanent -- King's Quest's goat, once he
   * has had the carrot, walks to ego's shoulder and stays there, and every
   * route out of the room begins by walking into him.
   *
   * Only the base row counts, because that is the row the engine compares: a
   * character is something to step around, not a wall the height of his view.
   */
  occupied(x: number, y: number): boolean {
    if (this.ego.ignoresObjects) return false;
    const width = Math.max(1, this.ego.width);

    for (const other of this.machine.viewTable.visible()) {
      if (other.number === EGO_NUMBER || other.ignoresObjects) continue;
      if (other.y !== y) continue;
      if (x + width <= other.x || x >= other.x + Math.max(1, other.width)) continue;
      return true;
    }
    return false;
  }

  /**
   * Whether a spot is on the strip that leaves the room.
   *
   * Routes keep off it, because standing on it is how a room is left and a
   * route that clips a corner on its way elsewhere leaves by an exit nobody
   * asked for. {@link exit} steps onto it with a direction key instead, which
   * is what a player does.
   */
  onTheEdge(x: number, y: number): boolean {
    const width = Math.max(1, this.ego.width);
    const top = this.ego.ignoresHorizon ? 0 : this.machine.horizon + 1;
    return (
      x < EDGE_BAND ||
      x + width > PICTURE_WIDTH - EDGE_BAND ||
      y > PICTURE_HEIGHT - 1 - EDGE_BAND ||
      y < top + EDGE_BAND
    );
  }

  /**
   * A route from where ego is to a spot, as a list of places to pass through.
   *
   * Breadth-first over the floor, eight ways, one pixel at a time. The room is
   * 160 by 168, so this is a few thousand nodes and costs nothing worth
   * measuring; what it buys is a harness that can cross a room the shape of
   * Lefty's back passage, which steering towards the target cannot.
   *
   * @returns the route, ending at the reachable point nearest the target, or
   *          null if ego cannot stand anywhere at all
   */
  route(toX: number, toY: number): { x: number; y: number }[] | null {
    const width = PICTURE_WIDTH;
    const index = (x: number, y: number) => y * width + x;
    const from = { x: this.ego.x, y: this.ego.y };

    const escaping = this.onTheEdge(from.x, from.y);
    // How far a spot is from the nearest way out of the room. Only used while
    // escaping, to insist that each step off the strip is a step further in.
    const egoWidth = Math.max(1, this.ego.width);
    const top = this.ego.ignoresHorizon ? 0 : this.machine.horizon + 1;
    const inset = (x: number, y: number) =>
      Math.min(x, PICTURE_WIDTH - (x + egoWidth), y - top, PICTURE_HEIGHT - 1 - y);
    const previous = new Int32Array(width * PICTURE_HEIGHT).fill(-1);
    const seen = new Uint8Array(width * PICTURE_HEIGHT);
    const queue: number[] = [index(from.x, from.y)];
    seen[queue[0]!] = 1;

    let nearest = queue[0]!;
    let nearestDistance = (from.x - toX) ** 2 + (from.y - toY) ** 2;

    for (let head = 0; head < queue.length; head++) {
      const at = queue[head]!;
      const x = at % width;
      const y = (at - x) / width;

      const distance = (x - toX) ** 2 + (y - toY) ** 2;
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = at;
      }
      if (x === toX && y === toY) break;

      for (const { dx, dy } of Object.values(STEP)) {
        const nextX = x + dx;
        const nextY = y + dy;
        if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= PICTURE_HEIGHT) continue;
        const next = index(nextX, nextY);
        if (seen[next] || !this.standable(nextX, nextY)) continue;
        // Somebody standing in the way is stepped around rather than into.
        // No allowance is needed for ego's own square the way the edge below
        // needs one: only the base row a character is standing on is closed,
        // so the rows above and below it are always a way out.
        if (this.occupied(nextX, nextY)) continue;
        // The edge is off limits, with one exception: a room may have put ego
        // down on it, and he has to be able to step off. So while he is
        // standing on the strip it stays open -- but never deeper. King's
        // Quest hands him into the oak wood at x=154, hard against the right
        // edge, and a step further right walks him straight back out of the
        // room he has just entered. Sideways along the strip is allowed,
        // because sometimes it is the only way round whoever is in the way.
        if (this.onTheEdge(nextX, nextY) && !(escaping && inset(nextX, nextY) >= inset(x, y))) {
          continue;
        }
        seen[next] = 1;
        previous[next] = at;
        queue.push(next);
      }
    }

    if (nearest === index(from.x, from.y)) return null;

    const path: { x: number; y: number }[] = [];
    for (let at = nearest; at !== -1; at = previous[at]!) {
      const x = at % width;
      path.push({ x, y: (at - x) / width });
    }
    return path.reverse();
  }

  /**
   * Walk ego to a spot, going round what is in the way.
   *
   * The route is planned once and then walked, and re-planned whenever ego
   * stops making progress -- which is what a character standing in the way
   * looks like from here. It gives up rather than looping for ever, and a
   * caller that cares whether ego arrived is told.
   *
   * @returns whether ego ended up within `tolerance` of the spot
   */
  walkTo(x: number, y: number, tolerance = 4, limit = 600): boolean {
    this.waitForControl();
    const room = this.room;
    const close = () => Math.abs(this.ego.x - x) <= tolerance && Math.abs(this.ego.y - y) <= tolerance;

    let path = this.route(x, y);
    let step = 0;
    let stuckFor = 0;

    for (let i = 0; i < limit && !close(); i++) {
      if (!path || step >= path.length) {
        path = this.route(x, y);
        step = 0;
        if (!path) break;
      }

      // Walk to the first point of the route ego is not already at.
      while (step < path.length && path[step]!.x === this.ego.x && path[step]!.y === this.ego.y) {
        step++;
      }
      if (step >= path.length) break;

      // A script driving ego -- a cab pulling away, a cut scene -- ignores the
      // keyboard. Waiting that out is not the same as being stuck against a
      // wall, and counting it as stuck gives up on a walk that has not begun.
      if (!this.machine.playerControl) {
        this.run(1);
        continue;
      }

      const was = `${this.ego.x},${this.ego.y}`;
      this.face(towards(this.ego.x, this.ego.y, path[step]!.x, path[step]!.y));
      this.run(1);
      if (this.room !== room) {
        this.halt();
        return false;
      }

      if (`${this.ego.x},${this.ego.y}` === was) {
        stuckFor++;
        // Two cycles of nothing is a blocked step rather than a slow one:
        // re-plan, and after enough of them give up.
        if (stuckFor % 3 === 2) {
          path = null;
          this.halt();
        }
        if (stuckFor > 30) break;
      } else {
        stuckFor = 0;
      }
    }

    this.halt();
    return close();
  }

  /**
   * Keep away from another object for a while.
   *
   * Some rooms are not a puzzle but a chase: King's Quest's giant follows ego
   * across the clouds and kills him the moment he arrives, and the only thing
   * that stops him is that he walks no faster than Graham. Standing still is
   * fatal and so is arriving anywhere -- {@link walkTo} stops on its target,
   * and one cycle of standing is all the hunter needs.
   *
   * So this steers rather than routes: every cycle it takes the direction that
   * puts the most ground between the two, and keeps going. A direction is only
   * changed when the one being held stops being the best, which keeps ego
   * running in long lines rather than shuffling on the spot.
   *
   * @returns whether ego was still on his feet at the end
   */
  flee(from: number, cycles: number): boolean {
    const hunter = this.machine.viewTable.at(from);
    if (!hunter) {
      this.run(cycles);
      return true;
    }

    const width = Math.max(1, this.ego.width);
    const gap = (x: number, y: number) =>
      Math.abs(x + (width >> 1) - (hunter.x + (hunter.width >> 1))) + Math.abs(y - hunter.y);

    let holding: Direction | null = null;

    for (let i = 0; i < cycles; i++) {
      if (this.machine.stopped) return false;

      // Three steps ahead, not one: a direction is worth taking for the ground
      // it opens up, and one pixel of it never looks different from another.
      let best: Direction | null = null;
      let bestGap = -1;
      for (const direction of Object.keys(ARROW) as Direction[]) {
        const { dx, dy } = STEP[direction];
        const to = { x: this.ego.x + dx * 3, y: this.ego.y + dy * 3 };
        if (!this.standable(to.x, to.y) || this.onTheEdge(to.x, to.y)) continue;
        const room = gap(to.x, to.y);
        // Ties go to the direction already being held, so ego runs in a line.
        if (room > bestGap || (room === bestGap && direction === holding)) {
          bestGap = room;
          best = direction;
        }
      }

      if (!best) {
        this.run(1);
        continue;
      }
      if (best !== holding) {
        this.face(best);
        holding = best;
      }
      this.run(1);
    }

    this.halt();
    return !this.machine.stopped;
  }

  /**
   * Close on another object until ego is a given distance from it, and stop.
   *
   * The mirror of {@link flee}, and needed for the same reason: the thing
   * being approached is moving. King's Quest asks for it twice. The condor
   * takes Graham up the mountain only if he jumps while he is between twenty
   * and thirty-five away from it and standing well below it, and the rat takes
   * the cheese only from between sixteen and thirty-four -- nearer than that
   * and it is on him, which kills. Neither band can be reached by walking to a
   * spot, because the spot has moved by the time ego gets there.
   *
   * So this steers, a cycle at a time, towards the point `below` pixels under
   * the object, and stops the moment the gap is inside the band. `below` is
   * both where it aims and part of what it waits for: the condor will not take
   * anyone who is not underneath it.
   *
   * The gap is AGI's own `distance` -- the two centres, across plus down --
   * because that is the number the room's script will be comparing.
   *
   * @returns whether ego ended up inside the band
   */
  stalk(after: number, gap: readonly [number, number], below = 0, cycles = 400): boolean {
    const quarry = this.machine.viewTable.at(after);
    if (!quarry) return false;

    const width = Math.max(1, this.ego.width);
    const away = (x: number, y: number) =>
      Math.abs(x + (width >> 1) - (quarry.x + (quarry.width >> 1))) + Math.abs(y - quarry.y);
    const arrived = () =>
      quarry.drawn &&
      away(this.ego.x, this.ego.y) >= gap[0] &&
      away(this.ego.x, this.ego.y) <= gap[1] &&
      this.ego.y - quarry.y >= below;

    // Ego is steered towards the middle of the band rather than towards the
    // object itself, so that coming from too near backs him off again.
    const wanted = (gap[0] + gap[1]) >> 1;
    let holding: Direction | null = null;

    for (let i = 0; i < cycles && !this.machine.stopped; i++) {
      if (arrived()) {
        this.halt();
        return true;
      }
      if (!quarry.drawn || !this.machine.playerControl) {
        this.run(1);
        continue;
      }

      // How wrong a spot is: how far its gap falls from the middle of the
      // band, plus whatever is still needed to get underneath the object.
      const cost = (x: number, y: number) =>
        Math.abs(away(x, y) - wanted) + Math.max(0, quarry.y + below - y);

      let best: Direction | null = null;
      let bestCost = cost(this.ego.x, this.ego.y);
      for (const direction of Object.keys(ARROW) as Direction[]) {
        const { dx, dy } = STEP[direction];
        const to = { x: this.ego.x + dx * 3, y: this.ego.y + dy * 3 };
        if (!this.standable(to.x, to.y) || this.onTheEdge(to.x, to.y)) continue;
        const wrong = cost(to.x, to.y);
        // Ties go to the direction already held, as in `flee`, so that ego
        // walks in lines rather than trembling between two equal steps.
        if (wrong < bestCost || (wrong === bestCost && direction === holding)) {
          bestCost = wrong;
          best = direction;
        }
      }

      if (best && best !== holding) {
        this.face(best);
        holding = best;
      } else if (!best) {
        this.halt();
        holding = null;
      }
      this.run(1);
    }

    const there = arrived();
    this.halt();
    return there;
  }

  /**
   * Run cycles until the player has ego back.
   *
   * @returns whether control came back within the limit
   */
  waitForControl(limit = 300): boolean {
    for (let i = 0; i < limit && !this.machine.playerControl; i++) this.run(1);
    return this.machine.playerControl;
  }

  /** Point ego a given way, without the toggle an arrow key would do. */
  private face(direction: Direction): void {
    if (this.machine.keyboard.direction !== 0) this.key('Numpad5');
    this.key(ARROW[direction]);
  }

  // --- Trying things -------------------------------------------------------

  /**
   * A coarse grid of places to stand in a room.
   *
   * AGI's play area is 160 by 168 with the horizon usually around a third of
   * the way down, so this covers the walkable part without pretending to know
   * where the walkable part is -- {@link walkTo} gives up on what it cannot
   * reach, and an unreachable spot costs a step of the search rather than
   * failing it.
   */
  static readonly SPOTS: readonly { x: number; y: number }[] = (() => {
    const spots: { x: number; y: number }[] = [];
    for (const y of [140, 120, 160, 100, 80]) {
      for (const x of [80, 40, 120, 20, 140, 60, 100]) spots.push({ x, y });
    }
    return spots;
  })();

  /**
   * Type a command, walking about the room until it takes.
   *
   * Half the lines in a walk-through only work from somewhere in particular --
   * "You're not close enough" is the game's way of saying so -- and neither
   * walk-through records where. Rather than hard-coding a coordinate per step,
   * this does what a player does: try it, and if nothing happened, go and
   * stand somewhere else and try again.
   *
   * @param command   the line to type
   * @param succeeded what counts as it having worked, tested after each try
   * @returns whether it ever worked
   */
  attempt(command: string, succeeded: () => boolean, cycles = 25): boolean {
    this.type(command);
    this.run(cycles);
    if (succeeded()) return true;

    const room = this.room;
    for (const spot of Playthrough.SPOTS) {
      if (this.room !== room) return succeeded();
      this.walkTo(spot.x, spot.y, 8, 120);
      if (this.room !== room) return succeeded();
      this.type(command);
      this.run(cycles);
      if (succeeded()) return true;
    }
    return false;
  }

  /** Type a command and report whether the score went up. */
  scores(command: string, cycles = 25): boolean {
    const before = this.score;
    return this.attempt(command, () => this.score > before, cycles);
  }

  // --- Saving and restoring ------------------------------------------------

  #saved: Snapshot | null = null;

  /**
   * Keep the game as it stands, so a bad turn can be taken back.
   *
   * Not the game's own save screen: the state, straight out of the machine and
   * back into it. What that is for is the games of chance -- Larry's blackjack
   * table is one, and its own walk-throughs say to save before every hand --
   * where a scripted playthrough otherwise depends on which cards came up.
   *
   * The random sequence is deliberately not part of it. Restoring and playing
   * the same hand again has to deal different cards, or the retry is the same
   * loss over again.
   */
  save(): void {
    this.#saved = captureSnapshot(this.machine);
  }

  /** Put the game back to the last {@link save}. */
  restore(): boolean {
    if (!this.#saved) return false;
    applySnapshot(this.machine, this.#saved);
    return true;
  }

  // --- Playing a walk-through ----------------------------------------------

  /**
   * Follow a walk-through, step by step, and report where it got to.
   *
   * Every step is checked as it is taken, because a playthrough that is only
   * judged at the end says "the score is wrong" and nothing about which of a
   * hundred and sixty steps went wrong. A step that pays points has to pay
   * them; a step that opens a way has to change the room; a step that merely
   * has to be said has to be answered with something other than a brush-off,
   * when the walk-through says what to expect.
   */
  play(steps: readonly Step[]): Progress {
    for (let index = 0; index < steps.length; index++) {
      const step = steps[index]!;
      const mark = this.said.length;
      const room = this.room;
      const score = this.score;

      let ok: boolean;
      if ('go' in step) {
        ok = this.exit(step.go);
        this.run(20);
        // A room has more ways out than the walk-through names, and leaving by
        // the wrong one carries on plausibly for several steps before anything
        // fails. Naming the room a step arrives in stops it here instead.
        if (step.enters !== undefined && this.room !== step.enters) ok = false;
      } else if ('walk' in step) {
        ok = this.walkTo(step.walk[0], step.walk[1], step.within ?? 4);
      } else if ('wait' in step) {
        this.run(step.wait);
        ok = true;
      } else if ('swims' in step) {
        this.swims = step.swims;
        ok = true;
      } else if ('signals' in step) {
        this.treadsOnSignals = step.signals;
        ok = true;
      } else if ('flee' in step) {
        ok = this.flee(step.flee, step.cycles);
      } else if ('stalk' in step) {
        ok = this.stalk(step.stalk, step.gap, step.below ?? 0, step.cycles ?? 400);
      } else if ('press' in step) {
        for (let n = 0; n < (step.times ?? 1); n++) this.key(step.press);
        this.run(2);
        ok = true;
      } else if ('save' in step) {
        this.save();
        ok = true;
      } else if ('restore' in step) {
        ok = this.restore();
      } else if ('repeat' in step) {
        // The condition is tested first: the game may have played along on the
        // way in, and a round that is not needed is one that walks Larry out of
        // the room the walk-through wanted him in.
        ok = step.until(this);
        for (let round = 0; !ok && round < (step.times ?? 10); round++) {
          // A round that reports failure may still have got what was wanted --
          // a walk that ends by stepping through a doorway leaves the room and
          // so fails as a walk -- so the condition is asked either way, and
          // only a round that failed *and* changed nothing gives up.
          const failed = this.play(step.repeat).step !== null;
          ok = step.until(this);
          if (failed && !ok) break;
        }
      } else if ('answer' in step) {
        for (let asked = 0; asked < (step.times ?? 1); asked++) {
          for (let i = 0; i < 200 && !this.machine.pending; i++) this.run(1);
          if (!this.machine.pending) break;
          this.type(step.answer);
          this.run(20);
        }
        ok = true;
      } else if (step.enters !== undefined) {
        const enters = step.enters;
        ok = this.attempt(step.say, () => this.room === enters, 40);
        this.run(25);
      } else if (step.points) {
        ok = this.scores(step.say);
      } else if (step.expect) {
        const expect = step.expect;
        ok = this.attempt(step.say, () => expect.test(this.saidSince(mark)) || this.room !== room);
      } else {
        this.type(step.say);
        this.run(25);
        ok = true;
      }

      if (!ok || ('points' in step && step.points !== undefined && this.score - score !== step.points)) {
        return {
          taken: index,
          of: steps.length,
          step,
          score: this.score,
          room: this.room,
          position: this.position,
          why: this.saidSince(mark) || '(the game said nothing)',
        };
      }

      this.run(5);
    }

    return { taken: steps.length, of: steps.length, step: null, score: this.score, room: this.room, position: this.position, why: '' };
  }

  // --- Getting to the game --------------------------------------------------

  /**
   * Press through whatever the game opens with, into the first playable room.
   *
   * Title screens wait for a key; questions have to be answered rather than
   * dismissed. Neither is in a walk-through, and both stand between it and the
   * game. `answer` is asked for each question the game puts up and returns the
   * key to press, so a game with copy protection can be got past without this
   * file knowing anything about it.
   *
   * @returns whether the game reached a room where it accepts typed input
   */
  begin(options: {
    answer?: (machine: Machine) => string | null;
    limit?: number;
  } = {}): boolean {
    const { answer, limit = 1200 } = options;

    for (let i = 0; i < limit; i++) {
      if (this.machine.inputAccepted && !this.machine.pending && !this.machine.window) {
        this.run(20);
        if (this.machine.inputAccepted && !this.machine.pending) return true;
      }

      if (this.machine.pending instanceof NumberQuestion) {
        this.type(answer?.(this.machine) ?? '30');
      } else if (this.machine.pending) {
        this.key('Enter');
      } else if (this.machine.window && answer) {
        const key = answer(this.machine);
        if (key !== null) this.key(key);
      } else {
        // A title screen sits there until a key is pressed, and pressing one
        // costs nothing in a room that is not waiting.
        if (i % 40 === 39) this.key('Enter');
      }
      this.run(5);
    }

    return false;
  }
}

/** The way to walk to get from one point towards another. */
function towards(fromX: number, fromY: number, toX: number, toY: number): Direction {
  const dx = Math.sign(toX - fromX);
  const dy = Math.sign(toY - fromY);
  for (const [name, step] of Object.entries(STEP)) {
    if (step.dx === dx && step.dy === dy) return name as Direction;
  }
  return 'north';
}
