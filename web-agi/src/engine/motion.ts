/**
 * Where objects are allowed to go, and how they get there.
 *
 * Three separate rules decide whether a step happens, and conflating them is
 * how this milestone goes wrong:
 *
 *   the screen     an object may not leave the picture, and may not walk above
 *                  the horizon unless it was told to ignore it
 *   control lines  the priority screen's values 0-3 are not depth but terrain:
 *                  walls, conditional walls, trigger lines and water
 *   other objects  two objects that observe each other cannot pass through
 *
 * All three are read along the object's *base line* -- the row of pixels its
 * feet occupy -- because that is the ground it is standing on. Reading the
 * whole sprite would have a character's head blocked by a wall it is standing
 * in front of. Transparent margins are still part of the base line for
 * obstacles, but not for deciding whether ego's visible feet are on water.
 *
 * A refused step is undone, not clamped: the object stays exactly where it was.
 * Clamping would slide a character along a wall it walked into diagonally,
 * which the original does not do.
 */
import { celPixelsForLoop, TRANSPARENT } from 'agi-extract/view';

import { CONTROL, PICTURE_HEIGHT, PICTURE_WIDTH, Screens } from '../render/screens.ts';
import type { Machine } from './machine.ts';
import { FLAG, VAR } from './state.ts';
import {
  CYCLE,
  DIRECTION,
  EGO,
  MOTION,
  type ViewObject,
  type ViewTable,
} from './viewtable.ts';

/** Horizontal component of each direction, indexed by direction 0-8. */
export const DX = [0, 0, 1, 1, 1, 0, -1, -1, -1] as const;

/** Vertical component of each direction. Down the screen is positive. */
export const DY = [0, -1, -1, 0, 1, 1, 1, 0, -1] as const;

/** Which screen edge an object touched. Reported through the reserved vars. */
export const EDGE = {
  NONE: 0,
  /** The top of the picture, or the horizon. */
  TOP: 1,
  RIGHT: 2,
  BOTTOM: 3,
  LEFT: 4,
} as const;

/**
 * Which loop faces which way, for a view with four loops.
 *
 * Index by direction; the value 4 means "this direction does not name a loop,
 * so leave the object showing whatever it was showing". Standing still is one
 * such case: a character that stops should keep facing the way it was going.
 */
const LOOP_FOR_DIRECTION_4 = [4, 3, 0, 0, 0, 2, 1, 1, 1] as const;

/** The same, for a view with only two or three loops: right and left only. */
const LOOP_FOR_DIRECTION_2 = [4, 4, 1, 1, 1, 4, 0, 0, 0] as const;

/** A loop number the tables use to mean "no change". */
const KEEP_LOOP = 4;

/**
 * Where the bands start, unless a script says otherwise.
 *
 * Everything in the top 48 rows shares the lowest drawing priority, and the ten
 * bands below it divide the remaining 120 rows twelve at a time.
 */
export const DEFAULT_PRIORITY_BASE = 48;

/**
 * Priority from the row an object stands on.
 *
 * The picture is banded: everything above the base shares the lowest drawing
 * priority, and the ten bands below it divide what is left. Priority 15 is not
 * produced here -- it is reserved for objects a script pins in front of
 * everything.
 *
 * `set.pri.base` moves the base, and the arithmetic below is what generalises
 * the bands to it. It is not a guess: with the default base of 48 it returns
 * the same priority as the table this engine hard-coded for eighteen
 * milestones, for every one of the picture's 168 rows -- ten bands of twelve,
 * 5 through 14 -- which is a formula agreeing with a measurement rather than a
 * formula taken on trust.
 *
 * Neither game here calls the command: it arrived in AGI 2.936, and Larry's
 * interpreter is 2.440 and King's Quest I's is 2.917. So this is the one rule
 * in M18 that no available game can exercise, which is exactly why it is a
 * rule rather than a counted stub -- a missing command is reported, a wrong
 * band is silent.
 *
 * @param y base row, in game coordinates
 * @param base the row the bands start at
 */
export function priorityForRow(y: number, base = DEFAULT_PRIORITY_BASE): number {
  if (y < base) return 4;
  const span = Math.max(1, PICTURE_HEIGHT - base);
  return Math.min(15, Math.floor(((y - base) * 10) / span) + 5);
}

/** The rectangle `block` defines, and whether it is in force. */
export interface Block {
  active: boolean;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function noBlock(): Block {
  return { active: false, x1: 0, y1: 0, x2: 0, y2: 0 };
}

/** Whether a point is inside the blocked rectangle. */
export function insideBlock(block: Block, x: number, y: number): boolean {
  return x > block.x1 && x < block.x2 && y > block.y1 && y < block.y2;
}

/** What the ground under an object's feet turned out to be. */
export interface Footing {
  /** Whether the object may stand there at all. */
  allowed: boolean;
  /** Every visible foot pixel of the base line is water. */
  water: boolean;
  /** Some pixel of the base line is a trigger line. */
  signal: boolean;
}

/**
 * Read the control lines under an object's base line.
 *
 * @param screens the background screens, whose priority buffer carries control
 * @param object  the object, positioned where it wants to be
 * @param priority the priority it would be drawn at
 */
export function checkFooting(screens: Screens, object: ViewObject, priority: number): Footing {
  // Priority 15 is the escape hatch: an object pinned in front of everything
  // is not standing on the scene at all, so terrain does not apply to it.
  if (priority === 15) return { allowed: true, water: false, signal: false };

  let signal = false;

  for (let column = 0; column < Math.max(1, object.width); column++) {
    const x = object.x + column;
    if (x < 0 || x >= PICTURE_WIDTH) continue;

    const control = screens.priority[Screens.index(x, object.y)]!;

    if (control === CONTROL.UNCONDITIONAL_OBSTACLE) {
      return { allowed: false, water: false, signal: false };
    }

    if (control === CONTROL.CONDITIONAL_OBSTACLE && !object.ignoresBlocks) {
      return { allowed: false, water: false, signal: false };
    }
    if (control === CONTROL.ALARM) signal = true;
  }

  const water = footingColumns(object).every((column) => {
    const x = object.x + column;
    if (x < 0 || x >= PICTURE_WIDTH) return true;
    return screens.priority[Screens.index(x, object.y)] === CONTROL.WATER;
  });

  // An object confined to one surface may not step off it.
  if (object.onWater && !water) return { allowed: false, water, signal };
  if (object.onLand && water) return { allowed: false, water, signal };

  return { allowed: true, water, signal };
}

/** The visible columns of the object's bottom row, falling back to its box. */
function footingColumns(object: ViewObject): number[] {
  const cel = object.currentCel;
  const width = Math.max(1, object.width);
  if (!cel || cel.width <= 0 || cel.height <= 0) {
    return Array.from({ length: width }, (_, column) => column);
  }

  const pixels = celPixelsForLoop(cel as never, object.loop) as Uint8Array;
  const row = (cel.height - 1) * cel.width;
  const columns: number[] = [];

  for (let column = 0; column < cel.width; column++) {
    if (pixels[row + column] !== TRANSPARENT) columns.push(column);
  }

  return columns.length > 0 ? columns : Array.from({ length: width }, (_, column) => column);
}

/**
 * Whether an object fits on the screen where it wants to be.
 *
 * @param horizon the row below which the ground starts
 */
export function fitsOnScreen(object: ViewObject, horizon: number): boolean {
  if (object.x < 0) return false;
  if (object.x + object.width > PICTURE_WIDTH) return false;
  if (object.y - object.height + 1 < 0) return false;
  if (object.y >= PICTURE_HEIGHT) return false;
  if (!object.ignoresHorizon && object.y <= horizon) return false;
  return true;
}

/**
 * Whether an object would land on another one.
 *
 * `ignore.objs` works both ways: an object that ignores other objects may pass
 * through them, *and* an object that ignores them is not there to be hit. The
 * flag was read one-directionally until the restroom door proved it could not
 * be -- see below. Two objects collide when their horizontal spans overlap and
 * the mover lands on the other's base row, or crosses it: it was above and is
 * now below, or the other way about. Starting the cycle on that row and moving
 * off it is neither, and treating it as one pins a character who begins beside
 * another and steps diagonally past him -- King's Quest's goat, following ego
 * a pace behind, does exactly that and could not be led out of the room.
 *
 * The room outside Lefty's restroom is the case that settles it. Its script
 * draws a 5x57 object with `ignore.objs` at 105,123 and then puts ego at
 * 100,123 -- overlapping it, on the same base row. Ego is 7 wide, so every
 * step keeps the spans overlapping and keeps the row the same, and a
 * one-directional reading of the flag leaves the player unable to move in any
 * direction for as long as they stay in the room. Sierra shipped that room, so
 * the original cannot have been blocking there.
 */
export function collides(table: ViewTable, object: ViewObject): boolean {
  if (object.ignoresObjects) return false;

  for (const other of table.visible()) {
    if (other === object) continue;
    if (other.ignoresObjects) continue;

    const objectRight = object.x + Math.max(1, object.width);
    const otherRight = other.x + Math.max(1, other.width);
    if (objectRight <= other.x) continue;
    if (object.x >= otherRight) continue;

    if (object.y === other.y) return true;
    const crossed =
      (object.previousY < other.y && object.y > other.y) ||
      (object.previousY > other.y && object.y < other.y);
    if (crossed) return true;
  }

  return false;
}

/**
 * Which direction leads from one point to another, given a step size.
 *
 * A difference smaller than one step counts as "already there" on that axis,
 * which is what stops an object oscillating either side of its destination.
 */
export function directionTowards(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  stepSize: number,
): number {
  const axis = (delta: number) => (-stepSize >= delta ? 0 : stepSize <= delta ? 2 : 1);
  const table = [8, 1, 2, 7, 0, 3, 6, 5, 4] as const;
  return table[axis(toX - fromX) + 3 * axis(toY - fromY)]!;
}

/** Which loop a direction calls for, or KEEP_LOOP to leave it alone. */
export function loopForDirection(direction: number, loopCount: number): number {
  if (loopCount >= 4) return LOOP_FOR_DIRECTION_4[direction] ?? KEEP_LOOP;
  if (loopCount === 2 || loopCount === 3) return LOOP_FOR_DIRECTION_2[direction] ?? KEEP_LOOP;
  return KEEP_LOOP;
}

export { KEEP_LOOP };

/**
 * Advance one object to its next cel.
 *
 * The two "loop" cycle modes stop themselves and set a flag when they finish,
 * which is how a script waits for an animation: it starts the cycle, then tests
 * the flag on later cycles rather than blocking.
 *
 * @param setFlag called with the flag a finished cycle should set
 */
export function advanceCel(object: ViewObject, setFlag: (flag: number) => void): void {
  const last = object.celCount - 1;
  if (last < 0) return;

  switch (object.cycleType) {
    case CYCLE.NORMAL:
      object.setCel(object.cel >= last ? 0 : object.cel + 1);
      break;

    case CYCLE.REVERSE:
      object.setCel(object.cel === 0 ? last : object.cel - 1);
      break;

    case CYCLE.END_OF_LOOP:
      if (object.cel >= last) break;
      object.setCel(object.cel + 1);
      if (object.cel === last) finishCycle(object, setFlag);
      break;

    case CYCLE.REVERSE_LOOP:
      if (object.cel === 0) break;
      object.setCel(object.cel - 1);
      if (object.cel === 0) finishCycle(object, setFlag);
      break;
  }
}

/**
 * A cycle that ran to its end: stop the object on its last cel.
 *
 * Cycling is switched off and updating is left alone. Switching updating off
 * too was tried, on the theory that `end.of.loop` switching it on implies the
 * completion switching it off -- it changed nothing observable in the game and
 * was not what it was meant to fix, so it is not here.
 */
function finishCycle(object: ViewObject, setFlag: (flag: number) => void): void {
  setFlag(object.cycleFlag);
  object.cycling = false;
  object.direction = DIRECTION.NONE;
  object.cycleType = CYCLE.NORMAL;
}

/**
 * Put an object somewhere it may legally stand.
 *
 * Scripts can name impossible positions, and not only by mistake. The game's
 * own death sequence subtracts 3 from ego's x before repositioning him -- and
 * a variable holds one byte, so with ego standing at the left edge that is
 * 0 - 3 = 253, hundreds of pixels off the right of a 160-pixel screen.
 *
 * The original resolves that at the moment of placement: it searches outwards
 * from the requested spot until the object fits, so by the time the cycle looks
 * at the object it is somewhere sensible. Leaving it to the cycle instead is
 * not a smaller version of the same thing -- the cycle clamps the position and
 * reports the object as having *walked* into the edge it was clamped against.
 * A room's exit tests read that report, so a script placing ego badly ejects
 * the player from the room, abandoning whatever sequence was running.
 */
export function fixPosition(machine: Machine, object: ViewObject): void {
  const width = Math.max(1, object.width);

  const legal = () => {
    if (!object.fixedPriority) object.priority = priorityForRow(object.y, machine.priorityBase);
    return (
      fitsOnScreen(object, machine.horizon) &&
      checkFooting(machine.background, object, object.priority).allowed &&
      !collides(machine.viewTable, object)
    );
  };

  // Onto the screen first: a wrapped byte is too far out for a search to walk
  // back from one pixel at a time.
  object.x = Math.max(0, Math.min(PICTURE_WIDTH - width, object.x));
  object.y = Math.min(PICTURE_HEIGHT - 1, object.y);
  // The horizon is only a floor for the objects that observe it. Lefty's bar
  // hangs a sign above its own horizon with `ignore.horizon`, and pushing that
  // down to the ground is not a repair.
  if (!object.ignoresHorizon) {
    object.y = Math.max(Math.min(machine.horizon + 1, PICTURE_HEIGHT - 1), object.y);
  }

  if (legal()) return;

  // Then outwards in rings, nearest first, so the object lands as close to
  // where the script asked as the room allows.
  const wanted = { x: object.x, y: object.y };
  for (let ring = 1; ring <= FIX_SEARCH_LIMIT; ring++) {
    for (const [dx, dy] of RING_DIRECTIONS) {
      object.x = wanted.x + dx * ring;
      object.y = wanted.y + dy * ring;
      if (object.x < 0 || object.x + width > PICTURE_WIDTH) continue;
      if (object.y < 0 || object.y >= PICTURE_HEIGHT) continue;
      if (legal()) return;
    }
  }

  // Nowhere within reach will do. Leave it where the script asked rather than
  // somewhere arbitrary: the position is at least on the screen, and a wrong
  // position that is visible beats one that is invented.
  object.x = wanted.x;
  object.y = wanted.y;
  if (!object.fixedPriority) object.priority = priorityForRow(object.y, machine.priorityBase);
}

/** How far {@link fixPosition} will look for a legal spot. */
const FIX_SEARCH_LIMIT = 24;

/** The eight directions the search walks, left first as the original does. */
const RING_DIRECTIONS = [
  [-1, 0],
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 1],
  [1, 1],
  [1, -1],
  [-1, -1],
] as const;

// --- The per-cycle pass ----------------------------------------------------

/**
 * Give the script-driven motions a direction for this cycle.
 *
 * Runs *before* logic 0, so that a script testing an object's direction sees
 * where it is about to go rather than where it went last time.
 */
export function checkAllMotions(machine: Machine): void {
  for (const object of machine.viewTable.active()) {
    if (object.stepTimeCount !== 1) continue;

    switch (object.motion) {
      case MOTION.WANDER:
        wander(machine, object);
        break;
      case MOTION.FOLLOW_EGO:
        followEgo(machine, object);
        break;
      case MOTION.MOVE_TO:
        moveTowardsDestination(machine, object);
        break;
      default:
        break;
    }
  }
}

/**
 * Point an object in a direction.
 *
 * Ego's direction lives in two places at once: on the object, and in the
 * reserved variable scripts read and write. Every change has to reach both, or
 * the next synchronisation between them silently undoes it -- which is exactly
 * how a scripted walk ends up standing still.
 */
export function face(machine: Machine, object: ViewObject, direction: number): void {
  object.direction = direction;
  if (object.number === EGO) machine.state.setVar(VAR.EGO_DIRECTION, direction);
}

/** Pick a new random direction, every so often. */
function wander(machine: Machine, object: ViewObject): void {
  if (object.wanderCount-- > 0 && object.direction !== DIRECTION.NONE) return;

  face(machine, object, 1 + Math.floor(Math.random() * 8));
  object.wanderCount = 10 + Math.floor(Math.random() * 50);
}

/**
 * Head towards ego.
 *
 * Straight at ego while the way is clear, and a detour when it is not: an
 * object that failed to move picks a random direction and *commits to it* for
 * a random distance before looking at ego again. Committing is the whole point
 * and not a detail. A follower that re-chose every cycle would jitter against
 * whatever it walked into and stay glued to the other side of it, which no
 * amount of hiding gets you away from; the original sends it wandering off,
 * and that is what makes King's Quest's giant survivable -- stand behind a
 * tree and he blunders away across the clouds until he falls asleep.
 */
function followEgo(machine: Machine, object: ViewObject): void {
  const ego = machine.viewTable.ego;
  const direction = directionTowards(
    object.x + Math.floor(object.width / 2),
    object.y,
    ego.x + Math.floor(ego.width / 2),
    ego.y,
    object.followStepSize,
  );

  if (direction === DIRECTION.NONE) {
    face(machine, object, DIRECTION.NONE);
    object.motion = MOTION.NORMAL;
    machine.state.setFlag(object.followFlag, true);
    return;
  }

  if (!object.followStarted) {
    object.followStarted = true;
  } else if (object.didNotMove) {
    // Blocked. Away in some other direction, for long enough to get clear of
    // whatever it was: the original measures that against the room, taking the
    // distance from here to the far wall the chosen direction points at.
    const away = 1 + Math.floor(Math.random() * 8);
    face(machine, object, away);
    object.followCount = Math.max(
      Math.abs(DX[away]!) * (PICTURE_WIDTH - object.x),
      Math.abs(DY[away]!) * (PICTURE_HEIGHT - object.y),
    );
    return;
  }

  if (object.followCount > 0) {
    object.followCount -= Math.max(1, object.stepSize);
    if (object.followCount < 0) object.followCount = 0;
    return;
  }

  face(machine, object, direction);
}

/** Head towards a `move.obj` destination, and report when it is reached. */
function moveTowardsDestination(machine: Machine, object: ViewObject): void {
  face(
    machine,
    object,
    directionTowards(object.x, object.y, object.moveX, object.moveY, object.stepSize),
  );
  if (object.direction === DIRECTION.NONE) arriveAtDestination(machine, object);
}

/**
 * Finish a `move.obj`: restore the step size it borrowed, set its flag, and
 * hand ego back to the player if the move was ego's.
 */
export function arriveAtDestination(machine: Machine, object: ViewObject): void {
  if (object.motion === MOTION.MOVE_TO) {
    object.stepSize = object.moveStepSize;
    machine.state.setFlag(object.moveFlag, true);
  }
  object.motion = MOTION.NORMAL;
  if (object.number === EGO) machine.playerControl = true;
}

/**
 * Choose loops and advance cels.
 *
 * Runs after logic 0, so a script that set a direction this cycle gets the
 * matching loop in the same frame rather than one cycle late.
 */
export function cycleObjects(machine: Machine): void {
  for (const object of machine.viewTable.active()) {
    if (!object.fixedLoop) {
      const loop = loopForDirection(object.direction, object.loopCount);
      // The loop only changes on the cycle the object actually steps, so a
      // character does not flicker between loops while standing still.
      if (loop !== KEEP_LOOP && loop !== object.loop && object.stepTimeCount === 1) {
        object.setLoop(loop);
      }
    }

    if (!object.cycling) continue;
    if (object.cycleTimeCount === 0) continue;

    if (--object.cycleTimeCount === 0) {
      advanceCel(object, (flag) => machine.state.setFlag(flag, true));
      // A cycle that ran to its end stops the object; ego's direction variable
      // has to hear about that too.
      face(machine, object, object.direction);
      object.cycleTimeCount = object.cycleTime;
    }
  }
}

/**
 * Move every active object one step, and report what it touched.
 *
 * A step that would leave the picture, cross a control line or land on another
 * object is undone. The object stays exactly where it was rather than sliding
 * along the obstacle: the original does not slide, and a script watching for a
 * position will otherwise see one that never happens.
 */
export function updatePositions(machine: Machine): void {
  const { state } = machine;

  state.setVar(VAR.OBJECT_TOUCHING_EDGE, 0);
  state.setVar(VAR.OBJECT_EDGE_TOUCHED, 0);

  for (const object of machine.viewTable.active()) {
    if (object.stepTimeCount === 0) continue;
    if (--object.stepTimeCount !== 0) continue;
    object.stepTimeCount = object.stepTime;

    const oldX = object.x;
    const oldY = object.y;
    object.previousX = oldX;
    object.previousY = oldY;

    let x = oldX;
    let y = oldY;

    // A script that placed the object this cycle has already decided where it
    // is; stepping it as well would overshoot by one step.
    if (!object.repositioned) {
      x += object.stepSize * DX[object.direction]!;
      y += object.stepSize * DY[object.direction]!;
    }

    // Clamp to the picture, remembering which edge stopped it.
    const topLimit = object.ignoresHorizon ? 0 : machine.horizon + 1;
    let edge: number = EDGE.NONE;

    if (y < topLimit) {
      y = topLimit;
      edge = EDGE.TOP;
    } else if (y > PICTURE_HEIGHT - 1) {
      y = PICTURE_HEIGHT - 1;
      edge = EDGE.BOTTOM;
    } else if (x < 0) {
      x = 0;
      edge = EDGE.LEFT;
    } else if (x + object.width > PICTURE_WIDTH) {
      x = PICTURE_WIDTH - object.width;
      edge = EDGE.RIGHT;
    }

    object.x = x;
    object.y = y;

    if (!object.fixedPriority) object.priority = priorityForRow(y, machine.priorityBase);

    // What makes a step legal is the ground, the other objects and the block
    // rectangle -- and not whether the whole sprite fits on the screen. The
    // clamp above has already dealt with every way a step can leave the
    // picture, and the one thing {@link fitsOnScreen} would still catch is a
    // tall view whose top sticks out above the picture, which the original
    // draws clipped rather than refusing. Refusing it here also threw away the
    // edge the clamp had just recorded, and a tall view then never reported
    // touching the horizon at all: King's Quest puts Graham on a thirty-three
    // pixel climbing view under a horizon at 30, and the beanstalk could not
    // be climbed past its second screen.
    const footing = checkFooting(machine.background, object, object.priority);
    const legal =
      footing.allowed &&
      !collides(machine.viewTable, object) &&
      !crossesBlock(machine.block, object, oldX, oldY);

    if (legal) {
      object.didNotMove = x === oldX && y === oldY;
    } else {
      object.x = oldX;
      object.y = oldY;
      if (!object.fixedPriority) object.priority = priorityForRow(oldY, machine.priorityBase);
      object.didNotMove = true;
      edge = EDGE.NONE;
    }

    if (object.number === EGO) {
      state.setFlag(FLAG.EGO_ON_WATER, footing.water);
      state.setFlag(FLAG.EGO_TOUCHED_SIGNAL, footing.signal);
    }

    if (edge !== EDGE.NONE) {
      if (object.number === EGO) {
        state.setVar(VAR.EGO_EDGE_TOUCHED, edge);
      } else {
        state.setVar(VAR.OBJECT_TOUCHING_EDGE, object.number);
        state.setVar(VAR.OBJECT_EDGE_TOUCHED, edge);
      }
      if (object.motion === MOTION.MOVE_TO) arriveAtDestination(machine, object);
    }

    object.repositioned = false;
  }
}

/**
 * Whether a step would cross the boundary `block` defines.
 *
 * The rule is about crossing, not about being inside: an object already inside
 * the rectangle is kept in, and one outside is kept out.
 */
function crossesBlock(block: Block, object: ViewObject, oldX: number, oldY: number): boolean {
  if (!block.active || object.ignoresBlocks) return false;
  return insideBlock(block, oldX, oldY) !== insideBlock(block, object.x, object.y);
}
