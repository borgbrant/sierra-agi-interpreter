/**
 * The view-table commands: everything a script does to a screen object.
 *
 * They fall into five groups, and the grouping is worth keeping in mind because
 * the commands within a group share their traps:
 *
 *   appearance   which view, loop and cel is showing
 *   position     where it stands, and where the script thinks it stands
 *   animation    how its cels advance, and how fast
 *   motion       how it decides where to walk
 *   permissions  what it is allowed to walk through
 *
 * Two conventions run through the whole set. A command ending in `.v` takes a
 * variable holding the value rather than the value itself. And a command that
 * places an object sets `repositioned`, so the engine's own motion does not
 * move it again in the same cycle and overshoot where the script put it.
 */
import { addToPicture } from '../animate.ts';
import {
  arriveAtDestination,
  directionTowards,
  face,
  fixPosition,
  priorityForRow,
} from '../motion.ts';
import type { Handler, Machine } from '../machine.ts';
import { VAR } from '../state.ts';
import { CYCLE, DIRECTION, EGO, MOTION, type ViewObject } from '../viewtable.ts';

/**
 * The object a command names.
 *
 * A number outside the table is a script defect rather than something to
 * invent a slot for, so it is counted as a stub and the command does nothing.
 */
function object(m: Machine, number: number): ViewObject | undefined {
  const found = m.viewTable.at(number);
  if (!found) m.stub(`object ${number} is outside the view table`);
  return found;
}

/** Apply a change to a named object, if it exists. */
function on(number: number, m: Machine, change: (object: ViewObject) => void): void {
  const found = object(m, number);
  if (found) change(found);
}

/** Give an object a view, and take its size from the view's first cel. */
function useView(m: Machine, target: ViewObject, id: number): void {
  target.setView(id, m.loadView(id));
  if (target.number === EGO) m.state.setVar(VAR.EGO_VIEW, id);
}

export const OBJECTS: Record<string, Handler> = {
  // --- existence ---------------------------------------------------------
  'animate.obj': (m, [n]) =>
    on(n!, m, (o) => {
      if (o.animated) return; // re-animating an object would undo its state
      o.animate();
    }),

  'unanimate.all': (m) => m.viewTable.unanimateAll(),

  draw: (m, [n]) =>
    on(n!, m, (o) => {
      if (!o.animated) return;
      o.drawn = true;
      if (!o.fixedPriority) o.priority = priorityForRow(o.y);
      o.repositioned = true;
    }),

  erase: (m, [n]) =>
    on(n!, m, (o) => {
      o.drawn = false;
    }),

  // --- appearance --------------------------------------------------------
  'set.view': (m, [n, view]) => on(n!, m, (o) => useView(m, o, view!)),
  'set.view.v': (m, [n, v]) => on(n!, m, (o) => useView(m, o, m.state.getVar(v!))),
  'set.loop': (m, [n, loop]) => on(n!, m, (o) => o.setLoop(loop!)),
  'set.loop.v': (m, [n, v]) => on(n!, m, (o) => o.setLoop(m.state.getVar(v!))),
  'set.cel': (m, [n, cel]) => on(n!, m, (o) => o.setCel(cel!)),
  'set.cel.v': (m, [n, v]) => on(n!, m, (o) => o.setCel(m.state.getVar(v!))),

  'fix.loop': (m, [n]) =>
    on(n!, m, (o) => {
      o.fixedLoop = true;
    }),
  'release.loop': (m, [n]) =>
    on(n!, m, (o) => {
      o.fixedLoop = false;
    }),

  'current.view': (m, [n, v]) => on(n!, m, (o) => m.state.setVar(v!, o.view ?? 0)),
  'current.loop': (m, [n, v]) => on(n!, m, (o) => m.state.setVar(v!, o.loop)),
  'current.cel': (m, [n, v]) => on(n!, m, (o) => m.state.setVar(v!, o.cel)),
  'last.cel': (m, [n, v]) => on(n!, m, (o) => m.state.setVar(v!, Math.max(0, o.celCount - 1))),
  'number.of.loops': (m, [n, v]) => on(n!, m, (o) => m.state.setVar(v!, o.loopCount)),

  // --- position ----------------------------------------------------------
  // `position` moves the object without redrawing it; `reposition` shifts it by
  // a signed offset. Both are relative to where the script believes it is.
  position: (m, [n, x, y]) =>
    on(n!, m, (o) => {
      o.x = x!;
      o.y = y!;
      o.repositioned = true;
    }),
  'position.v': (m, [n, vx, vy]) =>
    on(n!, m, (o) => {
      o.x = m.state.getVar(vx!);
      o.y = m.state.getVar(vy!);
      o.repositioned = true;
    }),
  'get.posn': (m, [n, vx, vy]) =>
    on(n!, m, (o) => {
      m.state.setVar(vx!, o.x);
      m.state.setVar(vy!, o.y);
    }),
  // The reposition commands settle the object into a legal spot as they place
  // it; `position` above deliberately does not, matching the original. The
  // difference matters: `position` places an object before it is drawn, while
  // these move one that is already on screen, and an illegal position that
  // survives into the cycle is reported as the object walking into an edge.
  reposition: (m, [n, vx, vy]) =>
    on(n!, m, (o) => {
      // The offsets are signed bytes: a script nudges an object left with 254.
      o.x = o.x + signed(m.state.getVar(vx!));
      o.y = o.y + signed(m.state.getVar(vy!));
      o.repositioned = true;
      fixPosition(m, o);
    }),
  'reposition.to': (m, [n, x, y]) =>
    on(n!, m, (o) => {
      o.x = x!;
      o.y = y!;
      o.repositioned = true;
      fixPosition(m, o);
    }),
  'reposition.to.v': (m, [n, vx, vy]) =>
    on(n!, m, (o) => {
      o.x = m.state.getVar(vx!);
      o.y = m.state.getVar(vy!);
      o.repositioned = true;
      fixPosition(m, o);
    }),

  distance: (m, [a, b, v]) => {
    const first = object(m, a!);
    const second = object(m, b!);
    if (!first || !second) return;

    if (!first.drawn || !second.drawn) {
      m.state.setVar(v!, 255); // 255 means "not comparable", not "very far"
      return;
    }

    const dx = Math.abs(
      first.x + Math.floor(first.width / 2) - (second.x + Math.floor(second.width / 2)),
    );
    const dy = Math.abs(first.y - second.y);
    m.state.setVar(v!, Math.min(254, dx + dy));
  },

  // --- depth -------------------------------------------------------------
  'set.priority': (m, [n, priority]) =>
    on(n!, m, (o) => {
      o.priority = priority!;
      o.fixedPriority = true;
    }),
  'set.priority.v': (m, [n, v]) =>
    on(n!, m, (o) => {
      o.priority = m.state.getVar(v!);
      o.fixedPriority = true;
    }),
  'release.priority': (m, [n]) =>
    on(n!, m, (o) => {
      o.fixedPriority = false;
      o.priority = priorityForRow(o.y);
    }),
  'get.priority': (m, [n, v]) => on(n!, m, (o) => m.state.setVar(v!, o.priority)),

  // --- updating ----------------------------------------------------------
  'stop.update': (m, [n]) =>
    on(n!, m, (o) => {
      o.update = false;
    }),
  'start.update': (m, [n]) =>
    on(n!, m, (o) => {
      o.update = true;
    }),
  'force.update': (m, [n]) =>
    on(n!, m, (o) => {
      o.update = true;
    }),

  // --- animation ---------------------------------------------------------
  'start.cycling': (m, [n]) =>
    on(n!, m, (o) => {
      o.cycling = true;
    }),
  'stop.cycling': (m, [n]) =>
    on(n!, m, (o) => {
      o.cycling = false;
    }),
  'normal.cycle': (m, [n]) =>
    on(n!, m, (o) => {
      o.cycleType = CYCLE.NORMAL;
      o.cycling = true;
    }),
  'reverse.cycle': (m, [n]) =>
    on(n!, m, (o) => {
      o.cycleType = CYCLE.REVERSE;
      o.cycling = true;
    }),
  'end.of.loop': (m, [n, flag]) =>
    on(n!, m, (o) => {
      o.cycleType = CYCLE.END_OF_LOOP;
      o.cycleFlag = flag!;
      o.cycling = true;
      o.update = true;
      m.state.setFlag(flag!, false);
    }),
  'reverse.loop': (m, [n, flag]) =>
    on(n!, m, (o) => {
      o.cycleType = CYCLE.REVERSE_LOOP;
      o.cycleFlag = flag!;
      o.cycling = true;
      o.update = true;
      m.state.setFlag(flag!, false);
    }),
  'cycle.time': (m, [n, v]) =>
    on(n!, m, (o) => {
      o.cycleTime = Math.max(1, m.state.getVar(v!));
      o.cycleTimeCount = o.cycleTime;
    }),

  // --- motion ------------------------------------------------------------
  'stop.motion': (m, [n]) =>
    on(n!, m, (o) => {
      face(m, o, DIRECTION.NONE);
      o.motion = MOTION.NORMAL;
      if (o.number === EGO) m.playerControl = false;
    }),
  'start.motion': (m, [n]) =>
    on(n!, m, (o) => {
      o.motion = MOTION.NORMAL;
      if (o.number === EGO) {
        face(m, o, DIRECTION.NONE);
        m.playerControl = true;
      }
    }),
  'normal.motion': (m, [n]) =>
    on(n!, m, (o) => {
      o.motion = MOTION.NORMAL;
    }),
  'step.size': (m, [n, v]) =>
    on(n!, m, (o) => {
      o.stepSize = Math.max(1, m.state.getVar(v!));
    }),
  'step.time': (m, [n, v]) =>
    on(n!, m, (o) => {
      o.stepTime = Math.max(1, m.state.getVar(v!));
      o.stepTimeCount = o.stepTime;
    }),
  'set.dir': (m, [n, v]) => on(n!, m, (o) => face(m, o, m.state.getVar(v!))),
  'get.dir': (m, [n, v]) => on(n!, m, (o) => m.state.setVar(v!, o.direction)),

  'move.obj': (m, [n, x, y, step, flag]) => on(n!, m, (o) => startMove(m, o, x!, y!, step!, flag!)),
  'move.obj.v': (m, [n, vx, vy, vstep, flag]) =>
    on(n!, m, (o) =>
      startMove(
        m,
        o,
        m.state.getVar(vx!),
        m.state.getVar(vy!),
        m.state.getVar(vstep!),
        flag!,
      ),
    ),

  'follow.ego': (m, [n, step, flag]) =>
    on(n!, m, (o) => {
      o.motion = MOTION.FOLLOW_EGO;
      o.followStepSize = step === 0 ? o.stepSize : step!;
      o.followFlag = flag!;
      o.followStarted = false;
      o.update = true;
      m.state.setFlag(flag!, false);
    }),

  wander: (m, [n]) =>
    on(n!, m, (o) => {
      o.motion = MOTION.WANDER;
      o.wanderCount = 0;
      o.update = true;
      if (o.number === EGO) m.playerControl = false;
    }),

  // --- permissions -------------------------------------------------------
  'ignore.horizon': (m, [n]) =>
    on(n!, m, (o) => {
      o.ignoresHorizon = true;
    }),
  'observe.horizon': (m, [n]) =>
    on(n!, m, (o) => {
      o.ignoresHorizon = false;
    }),
  'ignore.blocks': (m, [n]) =>
    on(n!, m, (o) => {
      o.ignoresBlocks = true;
    }),
  'observe.blocks': (m, [n]) =>
    on(n!, m, (o) => {
      o.ignoresBlocks = false;
    }),
  'ignore.objs': (m, [n]) =>
    on(n!, m, (o) => {
      o.ignoresObjects = true;
    }),
  'observe.objs': (m, [n]) =>
    on(n!, m, (o) => {
      o.ignoresObjects = false;
    }),
  'object.on.water': (m, [n]) =>
    on(n!, m, (o) => {
      o.onWater = true;
      o.onLand = false;
    }),
  'object.on.land': (m, [n]) =>
    on(n!, m, (o) => {
      o.onLand = true;
      o.onWater = false;
    }),
  'object.on.anything': (m, [n]) =>
    on(n!, m, (o) => {
      o.onLand = false;
      o.onWater = false;
    }),

  // --- ego and the player ------------------------------------------------
  'player.control': (m) => {
    m.playerControl = true;
    m.viewTable.ego.motion = MOTION.NORMAL;
  },
  'program.control': (m) => {
    m.playerControl = false;
  },

  // --- the blocked rectangle ---------------------------------------------
  block: (m, [x1, y1, x2, y2]) => {
    m.block = { active: true, x1: x1!, y1: y1!, x2: x2!, y2: y2! };
  },
  unblock: (m) => {
    m.block.active = false;
  },

  // --- permanent scenery -------------------------------------------------
  'add.to.pic': (m, [view, loop, cel, x, y, priority, margin]) =>
    addCel(m, view!, loop!, cel!, x!, y!, priority!, margin!),
  'add.to.pic.v': (m, [v1, v2, v3, v4, v5, v6, v7]) =>
    addCel(
      m,
      m.state.getVar(v1!),
      m.state.getVar(v2!),
      m.state.getVar(v3!),
      m.state.getVar(v4!),
      m.state.getVar(v5!),
      m.state.getVar(v6!),
      m.state.getVar(v7!),
    ),
};

/** Interpret a variable's byte as a signed offset. */
function signed(value: number): number {
  return value > 127 ? value - 256 : value;
}

/**
 * Start a `move.obj`.
 *
 * The step size is borrowed for the duration and put back when the object
 * arrives, so a scripted walk can be faster than the character normally is
 * without the script having to remember to restore it.
 */
function startMove(
  m: Machine,
  target: ViewObject,
  x: number,
  y: number,
  step: number,
  flag: number,
): void {
  target.motion = MOTION.MOVE_TO;
  target.moveX = x;
  target.moveY = y;
  target.moveStepSize = target.stepSize;
  target.moveFlag = flag;
  if (step !== 0) target.stepSize = step;

  m.state.setFlag(flag, false);
  target.update = true;
  if (target.number === EGO) m.playerControl = false;

  // The first step is taken now rather than next cycle, so a move over a
  // distance of nothing completes immediately instead of hanging the script.
  face(m, target, directionTowards(target.x, target.y, x, y, target.stepSize));
  if (target.direction === DIRECTION.NONE) arriveAtDestination(m, target);
}

/** Draw a cel of a view permanently into the background. */
function addCel(
  m: Machine,
  view: number,
  loop: number,
  cel: number,
  x: number,
  y: number,
  priority: number,
  margin: number,
): void {
  const decoded = m.loadView(view);
  const frame = decoded.loops[loop]?.cels[cel];
  if (!frame) {
    m.stub(`add.to.pic: view ${view} has no loop ${loop} cel ${cel}`);
    return;
  }

  // A priority of zero asks for the band the object is standing in, the same
  // rule an animated object follows.
  addToPicture(
    m,
    { cel: frame, loop },
    x,
    y,
    priority === 0 ? priorityForRow(y) : priority,
    margin,
    view,
    cel,
  );
}
