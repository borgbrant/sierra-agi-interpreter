/**
 * The view table: every object that can move or animate on screen.
 *
 * AGI gives the interpreter a fixed-size table of screen objects. Entry 0 is
 * ego, the character the player steers; the rest belong entirely to the room's
 * scripts. An entry is not "an object that exists" -- every slot always exists.
 * What varies is whether it is *animated* (the script has claimed the slot),
 * *drawn* (it appears on screen) and *updating* (the engine advances it each
 * cycle). Almost every rule in this milestone is a combination of those three.
 *
 * The original tracks those properties as a bitmask. They are booleans here:
 * the engine reads them far more often than it copies them, and a field named
 * `ignoresBlocks` is checkable at a glance where `flags & 0x0002` is not.
 *
 * Positions are game coordinates, 160x168, and an object is anchored by the
 * *bottom-left* of its cel -- the point it stands on, which is also the point
 * its priority and its control-line tests are taken from.
 */
import { decodeView } from 'agi-extract/view';

import type { Bytes } from '../render/screens.ts';
import type { Cel } from '../render/sprite.ts';

/**
 * How many slots the table holds.
 *
 * OBJECT records the game's own maximum (16 for the bundled game), but the
 * interpreter's table is a fixed size regardless, and scripts address slots by
 * number. Allocating the interpreter's size means a script that reaches past
 * the game's own maximum is ignored rather than crashing.
 */
export const MAX_VIEW_OBJECTS = 16;

/** The slot the player controls. */
export const EGO = 0;

/** A decoded VIEW: its loops, each a list of cels. */
export interface View {
  loops: { loop: number; cels: Cel[] }[];
  description: string | null;
}

/** How an object decides where to walk next. */
export const MOTION = {
  /** Straight line in whatever direction it was given. */
  NORMAL: 0,
  /** Random direction, changed at random intervals. */
  WANDER: 1,
  /** Head towards ego. */
  FOLLOW_EGO: 2,
  /** Head towards a fixed point, then set a flag. */
  MOVE_TO: 3,
} as const;

export type MotionType = (typeof MOTION)[keyof typeof MOTION];

/** How an object advances through the cels of its loop. */
export const CYCLE = {
  /** Round and round, forever. */
  NORMAL: 0,
  /** Forwards to the last cel, then stop and set a flag. */
  END_OF_LOOP: 1,
  /** Backwards to the first cel, then stop and set a flag. */
  REVERSE_LOOP: 2,
  /** Backwards, forever. */
  REVERSE: 3,
} as const;

export type CycleType = (typeof CYCLE)[keyof typeof CYCLE];

/** Directions, clockwise from north. 0 means standing still. */
export const DIRECTION = {
  NONE: 0,
  NORTH: 1,
  NORTH_EAST: 2,
  EAST: 3,
  SOUTH_EAST: 4,
  SOUTH: 5,
  SOUTH_WEST: 6,
  WEST: 7,
  NORTH_WEST: 8,
} as const;

/** One slot of the view table. */
export class ViewObject {
  /** Which slot this is. Scripts address objects by this number. */
  readonly number: number;

  // --- what it looks like --------------------------------------------------

  /** VIEW resource number, or null while the slot has never been given one. */
  view: number | null = null;
  loops: { loop: number; cels: Cel[] }[] = [];
  loop = 0;
  cel = 0;

  // --- where it is ---------------------------------------------------------

  /** Left edge, in game pixels. */
  x = 0;
  /** Bottom edge: the point the object stands on. */
  y = 0;
  /** Where it stood at the end of the previous cycle, for collision tests. */
  previousX = 0;
  previousY = 0;

  // --- how it moves --------------------------------------------------------

  direction: number = DIRECTION.NONE;
  /** Pixels moved per step. */
  stepSize = 1;
  /** Cycles between steps, and the countdown to the next one. */
  stepTime = 1;
  stepTimeCount = 1;

  motion: MotionType = MOTION.NORMAL;
  /** Destination of a `move.obj`, and the step size and flag it restores. */
  moveX = 0;
  moveY = 0;
  moveStepSize = 0;
  moveFlag = 0;
  /** `follow.ego`'s step size, completion flag, and its "has started" marker. */
  followStepSize = 0;
  followFlag = 0;
  followStarted = false;
  /** Cycles left before `wander` picks a new direction. */
  wanderCount = 0;

  // --- how it animates -----------------------------------------------------

  cycleType: CycleType = CYCLE.NORMAL;
  /** Flag set when END_OF_LOOP or REVERSE_LOOP reaches its end. */
  cycleFlag = 0;
  /** Cycles between cel changes, and the countdown to the next one. */
  cycleTime = 1;
  cycleTimeCount = 1;

  // --- depth ---------------------------------------------------------------

  priority = 0;
  /** Whether the script pinned the priority instead of letting the band rule. */
  fixedPriority = false;

  // --- state ---------------------------------------------------------------

  /** The script has claimed this slot. */
  animated = false;
  /** It appears on screen. */
  drawn = false;
  /** The engine advances it every cycle. */
  update = true;
  /** Its cels advance. */
  cycling = false;
  /** It may walk above the horizon. */
  ignoresHorizon = false;
  /** It walks through conditional obstacles. */
  ignoresBlocks = false;
  /** It walks through other objects. */
  ignoresObjects = false;
  /** The loop is pinned; direction no longer chooses it. */
  fixedLoop = false;
  /** It may only stand on water. */
  onWater = false;
  /** It may only stand on land. */
  onLand = false;
  /**
   * A script moved it this cycle, so motion must not move it again.
   *
   * `position` and `reposition` set this. Without it an object placed by a
   * script and then stepped by the engine in the same cycle lands one step
   * past where the script asked for.
   */
  repositioned = false;
  /** Its last attempted step was refused. `follow.ego` reads this. */
  didNotMove = false;

  constructor(number: number) {
    this.number = number;
  }

  /** The cel now showing, or undefined while the slot has no view. */
  get currentCel(): Cel | undefined {
    return this.loops[this.loop]?.cels[this.cel];
  }

  get celCount(): number {
    return this.loops[this.loop]?.cels.length ?? 0;
  }

  get loopCount(): number {
    return this.loops.length;
  }

  get width(): number {
    return this.currentCel?.width ?? 0;
  }

  get height(): number {
    return this.currentCel?.height ?? 0;
  }

  /**
   * Whether the engine should advance this object at all.
   *
   * The original requires all three of animated, drawn and updating together,
   * and the combination appears in every per-cycle loop, so it has a name.
   */
  get isActive(): boolean {
    return this.animated && this.drawn && this.update;
  }

  /**
   * Give the object a view, resetting the frame it shows.
   *
   * @param id    VIEW resource number
   * @param view  its decoded loops
   */
  setView(id: number, view: View): void {
    this.view = id;
    this.loops = view.loops;
    if (this.loop >= this.loopCount) this.loop = 0;
    if (this.cel >= this.celCount) this.cel = 0;
  }

  /**
   * Show a different loop, clamping the cel to one the loop has.
   *
   * A loop number past the end is ignored rather than blanking the object: the
   * original leaves the object as it was, and scripts rely on that.
   */
  setLoop(loop: number): void {
    if (loop >= this.loopCount) return;
    this.loop = loop;
    if (this.cel >= this.celCount) this.cel = Math.max(0, this.celCount - 1);
  }

  /** Show a different cel of the current loop. */
  setCel(cel: number): void {
    if (cel >= this.celCount) return;
    this.cel = cel;
  }

  /**
   * Reset to the state `new.room` leaves every slot in.
   *
   * Deliberately partial. A room change releases the slots and resets their
   * timing, but leaves the permissions and pins alone -- it is
   * {@link animate} that clears those, when a script claims the slot again.
   */
  reset(): void {
    this.animated = false;
    this.drawn = false;
    this.update = true;
    this.motion = MOTION.NORMAL;
    this.cycleType = CYCLE.NORMAL;
    this.stepTime = 1;
    this.stepTimeCount = 1;
    this.cycleTime = 1;
    this.cycleTimeCount = 1;
    this.stepSize = 1;
    this.repositioned = false;
    this.didNotMove = false;
  }

  /**
   * Claim the slot for animation, as `animate.obj` does.
   *
   * Every permission and every pin is cleared, not merely the ones this
   * command is about. The original assigns the object's whole flag word here
   * rather than adding to it, so claiming a slot wipes whatever the previous
   * occupant left behind -- and the game depends on that. Its opening pins
   * ego's loop with `fix.loop` to walk him about a cinematic, and never
   * releases it; what unpins him is the `animate.obj(0)` that runs on entering
   * every room. Merging the flags instead leaves ego facing away from the
   * player for the rest of the game.
   *
   * Cycling starts on, which is why scripts follow `animate.obj` with
   * `stop.cycling` for the objects they want to hold still.
   */
  animate(): void {
    this.animated = true;
    this.drawn = false;
    this.update = true;
    this.cycling = true;

    this.fixedLoop = false;
    this.fixedPriority = false;
    this.ignoresHorizon = false;
    this.ignoresBlocks = false;
    this.ignoresObjects = false;
    this.onWater = false;
    this.onLand = false;
    this.repositioned = false;
    this.didNotMove = false;

    this.motion = MOTION.NORMAL;
    this.cycleType = CYCLE.NORMAL;
    this.direction = DIRECTION.NONE;
  }
}

/** The whole table, plus the VIEW decoding it needs. */
export class ViewTable {
  readonly objects: ViewObject[] = Array.from(
    { length: MAX_VIEW_OBJECTS },
    (_, n) => new ViewObject(n),
  );

  #views = new Map<number, View>();

  /** Ego, the object the player steers. */
  get ego(): ViewObject {
    return this.objects[EGO]!;
  }

  /**
   * One slot.
   *
   * Out-of-range numbers are refused rather than silently aliased: a script
   * addressing object 40 is a defect worth seeing, not a slot to invent.
   */
  at(number: number): ViewObject | undefined {
    return this.objects[number];
  }

  /** Every slot the engine should advance this cycle. */
  active(): ViewObject[] {
    return this.objects.filter((object) => object.isActive);
  }

  /** Every slot that appears on screen, whether or not it updates. */
  visible(): ViewObject[] {
    return this.objects.filter((object) => object.animated && object.drawn);
  }

  /** Decode a VIEW once and keep it; several objects share the same view. */
  view(id: number, payload: () => Bytes): View {
    let decoded = this.#views.get(id);
    if (!decoded) {
      decoded = decodeView(payload()) as View;
      this.#views.set(id, decoded);
    }
    return decoded;
  }

  /** Forget decoded views, so a room change starts from the files again. */
  discardViews(): void {
    this.#views.clear();
  }

  /** Reset every slot, as `new.room` does. */
  reset(): void {
    for (const object of this.objects) object.reset();
  }

  /** Stop every object animating, as `unanimate.all` does. */
  unanimateAll(): void {
    for (const object of this.objects) {
      object.animated = false;
      object.drawn = false;
    }
  }
}
