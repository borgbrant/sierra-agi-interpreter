/**
 * The interpreter's state, as a value that can be written out and read back.
 *
 * The whole engine was built so that this file could exist: state is data
 * rather than closures, which makes saving a game a serialisation problem
 * instead of a redesign. What is here is therefore mostly a list -- and the
 * interesting part is what is *not* on it.
 *
 * **Nothing derived is saved.** The decoded views, the drawn background, the
 * rectangles the sprites covered and the text on screen are all rebuilt by
 * {@link applySnapshot} from the things that produced them: the picture number,
 * the scenery a script added to it, and each object's view number. Saving them
 * would double the size of a save and give it a second way to disagree with
 * itself.
 *
 * **`scanStart` is state, not code.** `set.scan.start` moves where a script is
 * re-entered next cycle, and it is how an AGI script waits for a keypress
 * without blocking. It lives beside a script's decoded instructions, which
 * makes it look like a property of the resource; it is not, and a game restored
 * without it puts every waiting script back at the top of its question.
 *
 * A snapshot carries the format version and a fingerprint of the game it came
 * from. Restoring one into a different game, or one written by a version that
 * no longer means what it says, is refused rather than attempted -- a save that
 * loads and is subtly wrong is far worse than one that will not load.
 */
import { Screens } from '../render/screens.ts';
import type { AddedCel } from './animate.ts';
import { DEFAULT_LAYOUT, type ScreenLayout } from './layout.ts';
import type { Machine } from './machine.ts';

/**
 * The format version.
 *
 * Raised whenever a change would make an older save restore *wrongly* rather
 * than fail. A save from another version is refused.
 */
export const SNAPSHOT_VERSION = 1;

/** Raised when a snapshot cannot be trusted, with a reason a player can read. */
export class SaveError extends Error {
  readonly code = 'SAVE_REFUSED';

  constructor(message: string) {
    super(message);
    this.name = 'SaveError';
  }
}

/**
 * Enough of the game's identity to tell one game's saves from another's.
 *
 * Not a checksum of the resources: the point is to stop a save being restored
 * into a different game, not to detect a modified one.
 */
export interface GameFingerprint {
  logic: number;
  pic: number;
  view: number;
  sound: number;
  items: number;
}

/** One slot of the view table. */
export interface SavedObject {
  number: number;
  view: number | null;
  loop: number;
  cel: number;
  x: number;
  y: number;
  previousX: number;
  previousY: number;
  direction: number;
  stepSize: number;
  stepTime: number;
  stepTimeCount: number;
  motion: number;
  moveX: number;
  moveY: number;
  moveStepSize: number;
  moveFlag: number;
  followStepSize: number;
  followFlag: number;
  followStarted: boolean;
  wanderCount: number;
  cycleType: number;
  cycleFlag: number;
  cycleTime: number;
  cycleTimeCount: number;
  priority: number;
  fixedPriority: boolean;
  animated: boolean;
  drawn: boolean;
  update: boolean;
  cycling: boolean;
  ignoresHorizon: boolean;
  ignoresBlocks: boolean;
  ignoresObjects: boolean;
  fixedLoop: boolean;
  onWater: boolean;
  onLand: boolean;
  repositioned: boolean;
  didNotMove: boolean;
}

export interface Snapshot {
  version: number;
  game: GameFingerprint;
  /** When it was written, for the player to choose between slots. */
  savedAt: string;

  room: number;
  variables: number[];
  flags: number[];
  strings: string[];
  /** The room each inventory item is in now, which is not where it started. */
  inventory: number[];
  objects: SavedObject[];

  /** Script number to the address it will be re-entered at. */
  scanStarts: [number, number][];
  /** Menu items the game has greyed out, by controller. */
  disabledControllers: number[];

  /** The picture in the background, and the cels a script drew into it. */
  picture: number | null;
  loadedPictures: number[];
  scenery: AddedCel[];

  horizon: number;
  block: { active: boolean; x1: number; y1: number; x2: number; y2: number };
  playerControl: boolean;
  inputAccepted: boolean;
  statusLineVisible: boolean;
  textMode: boolean;
  textForeground: number;
  textBackground: number;
  menuEnabled: boolean;
  lastLine: string;
  cursorChar: string;

  /**
   * Where the game has put its status line, input line and print floor.
   *
   * Optional, and not because it might be missing from a save this engine
   * writes -- it never is. A save written before the layout existed is a save
   * from an engine that could not have had any layout but the default, so
   * reading one back as the default is a fact about the old format rather than
   * a guess. That is cheaper than a format bump, which would have thrown away
   * every existing save to record a value all of them had.
   */
  layout?: ScreenLayout;
}

/** What game this machine is running, for a snapshot to be checked against. */
export function fingerprint(machine: Machine): GameFingerprint {
  const counts = machine.resources.counts();
  return {
    logic: counts.logic,
    pic: counts.pic,
    view: counts.view,
    sound: counts.sound,
    items: machine.objects.items.length,
  };
}

/** Take a snapshot of everything a restored game needs. */
export function captureSnapshot(machine: Machine): Snapshot {
  const { state } = machine;

  return {
    version: SNAPSHOT_VERSION,
    game: fingerprint(machine),
    savedAt: new Date().toISOString(),

    room: state.room,
    variables: [...state.variables],
    flags: [...state.flags],
    strings: [...state.strings],
    inventory: [...machine.inventory.rooms],
    objects: machine.viewTable.objects.map(captureObject),

    scanStarts: machine.scanStarts(),
    disabledControllers: disabledControllers(machine),

    picture: machine.currentPicture,
    loadedPictures: [...machine.loadedPictures],
    scenery: machine.scenery.map((cel) => ({ ...cel })),

    horizon: machine.horizon,
    block: { ...machine.block },
    playerControl: machine.playerControl,
    inputAccepted: machine.inputAccepted,
    statusLineVisible: machine.statusLineVisible,
    textMode: machine.textMode,
    textForeground: machine.textForeground,
    textBackground: machine.textBackground,
    menuEnabled: machine.menuBar.enabled,
    lastLine: machine.lastLine,
    cursorChar: machine.prompt.cursorChar,
    layout: { ...machine.layout },
  };
}

/**
 * Put a snapshot back.
 *
 * Two halves. The first is the state itself, copied field for field. The second
 * rebuilds what the first implies: the picture and its scenery, the decoded
 * views the objects point at, and a screen with none of the old game left on
 * it. The engine is left ready to draw, exactly as it is after a room loads.
 *
 * @throws SaveError if the snapshot is from another game or another format
 */
export function applySnapshot(machine: Machine, snapshot: Snapshot): void {
  check(machine, snapshot);

  // Before anything is restored, not after. Stopping a sound sets the flag its
  // script was waiting on -- that is the rule that keeps `stop.sound` from
  // stranding a script -- and a flag set after the restore is the *old* game
  // writing into the new one's state. The game being replaced ends first.
  machine.stopSound();

  const { state } = machine;

  state.variables.set(snapshot.variables);
  state.flags.set(snapshot.flags);
  snapshot.strings.forEach((value, index) => state.setString(index, value));
  state.room = snapshot.room;

  machine.inventory.rooms.set(snapshot.inventory);

  machine.horizon = snapshot.horizon;
  machine.block = { ...snapshot.block };
  machine.playerControl = snapshot.playerControl;
  machine.inputAccepted = snapshot.inputAccepted;
  machine.statusLineVisible = snapshot.statusLineVisible;
  machine.textMode = snapshot.textMode;
  machine.textForeground = snapshot.textForeground;
  machine.textBackground = snapshot.textBackground;
  machine.menuBar.enabled = snapshot.menuEnabled;
  machine.lastLine = snapshot.lastLine;
  machine.prompt.cursorChar = snapshot.cursorChar;
  machine.layout = { ...(snapshot.layout ?? DEFAULT_LAYOUT) };

  machine.loadedPictures.clear();
  for (const id of snapshot.loadedPictures) machine.loadedPictures.add(id);

  // Every item is enabled first, so a save taken before the game greyed
  // something out does not leave it greyed.
  for (const menu of machine.menuBar.menus) {
    for (const item of menu.items) item.enabled = true;
  }
  for (const controller of snapshot.disabledControllers) {
    machine.menuBar.setEnabled(controller, false);
  }

  machine.restoreScanStarts(snapshot.scanStarts);

  // --- and now the parts that are rebuilt rather than restored -------------

  machine.viewTable.reset();
  machine.viewTable.discardViews();
  for (const saved of snapshot.objects) restoreObject(machine, saved);

  machine.scenery.length = 0;
  if (snapshot.picture === null) {
    machine.background.clear();
  } else {
    machine.background.copyFrom(Screens.fromPicture(machine.resources.loadSync('pic', snapshot.picture)));
    // Scenery a script added with add.to.pic is part of the room's picture,
    // not of the picture file, so it is replayed rather than reloaded. Without
    // this a game restored in Lefty's bar comes back without its customers.
    for (const cel of snapshot.scenery) machine.addSceneryFromSave(cel);
  }
  machine.currentPicture = snapshot.picture;

  machine.screens.copyFrom(machine.background);
  machine.savedAreas.length = 0;
  machine.pictureShown = true;

  // Nothing of the old game is left on screen or waiting for a key.
  machine.textLayer.clear();
  machine.window = null;
  machine.pending = null;
  machine.prompt.clear();
  machine.parsedWords = [];
  machine.controllers.clear();
  machine.keyboard.clear();
}

/** Refuse a snapshot rather than restore one that cannot mean what it says. */
function check(machine: Machine, snapshot: Snapshot): void {
  if (snapshot.version !== SNAPSHOT_VERSION) {
    throw new SaveError(
      `this save is in format ${snapshot.version}, and this engine reads format ${SNAPSHOT_VERSION}`,
    );
  }

  const here = fingerprint(machine);
  const theirs = snapshot.game;
  const same =
    here.logic === theirs.logic &&
    here.pic === theirs.pic &&
    here.view === theirs.view &&
    here.sound === theirs.sound &&
    here.items === theirs.items;

  if (!same) throw new SaveError('this save is from a different game');
}

function disabledControllers(machine: Machine): number[] {
  const disabled = new Set<number>();
  for (const menu of machine.menuBar.menus) {
    for (const item of menu.items) {
      if (!item.enabled) disabled.add(item.controller);
    }
  }
  return [...disabled];
}

function captureObject(object: Machine['viewTable']['objects'][number]): SavedObject {
  return {
    number: object.number,
    view: object.view,
    loop: object.loop,
    cel: object.cel,
    x: object.x,
    y: object.y,
    previousX: object.previousX,
    previousY: object.previousY,
    direction: object.direction,
    stepSize: object.stepSize,
    stepTime: object.stepTime,
    stepTimeCount: object.stepTimeCount,
    motion: object.motion,
    moveX: object.moveX,
    moveY: object.moveY,
    moveStepSize: object.moveStepSize,
    moveFlag: object.moveFlag,
    followStepSize: object.followStepSize,
    followFlag: object.followFlag,
    followStarted: object.followStarted,
    wanderCount: object.wanderCount,
    cycleType: object.cycleType,
    cycleFlag: object.cycleFlag,
    cycleTime: object.cycleTime,
    cycleTimeCount: object.cycleTimeCount,
    priority: object.priority,
    fixedPriority: object.fixedPriority,
    animated: object.animated,
    drawn: object.drawn,
    update: object.update,
    cycling: object.cycling,
    ignoresHorizon: object.ignoresHorizon,
    ignoresBlocks: object.ignoresBlocks,
    ignoresObjects: object.ignoresObjects,
    fixedLoop: object.fixedLoop,
    onWater: object.onWater,
    onLand: object.onLand,
    repositioned: object.repositioned,
    didNotMove: object.didNotMove,
  };
}

/**
 * Put one object back, decoding its view again.
 *
 * The loop and cel are applied after the view, and directly rather than through
 * `setLoop`/`setCel`: those clamp to what the *current* loop holds, which is
 * the right rule for a script and the wrong one here, where the pair being
 * restored is already known to be a pair the object had.
 */
function restoreObject(machine: Machine, saved: SavedObject): void {
  const object = machine.viewTable.at(saved.number);
  if (!object) return;

  if (saved.view === null) {
    // A slot that had no view when the game was saved must not keep the one
    // the running game left in it: `reset` releases a slot without emptying it.
    object.view = null;
    object.loops = [];
    object.loop = 0;
    object.cel = 0;
  } else {
    object.setView(saved.view, machine.loadView(saved.view));
    object.loop = Math.min(saved.loop, Math.max(0, object.loopCount - 1));
    object.cel = Math.min(saved.cel, Math.max(0, object.celCount - 1));
  }

  object.x = saved.x;
  object.y = saved.y;
  object.previousX = saved.previousX;
  object.previousY = saved.previousY;
  object.direction = saved.direction;
  object.stepSize = saved.stepSize;
  object.stepTime = saved.stepTime;
  object.stepTimeCount = saved.stepTimeCount;
  object.motion = saved.motion as typeof object.motion;
  object.moveX = saved.moveX;
  object.moveY = saved.moveY;
  object.moveStepSize = saved.moveStepSize;
  object.moveFlag = saved.moveFlag;
  object.followStepSize = saved.followStepSize;
  object.followFlag = saved.followFlag;
  object.followStarted = saved.followStarted;
  object.wanderCount = saved.wanderCount;
  object.cycleType = saved.cycleType as typeof object.cycleType;
  object.cycleFlag = saved.cycleFlag;
  object.cycleTime = saved.cycleTime;
  object.cycleTimeCount = saved.cycleTimeCount;
  object.priority = saved.priority;
  object.fixedPriority = saved.fixedPriority;
  object.animated = saved.animated;
  object.drawn = saved.drawn;
  object.update = saved.update;
  object.cycling = saved.cycling;
  object.ignoresHorizon = saved.ignoresHorizon;
  object.ignoresBlocks = saved.ignoresBlocks;
  object.ignoresObjects = saved.ignoresObjects;
  object.fixedLoop = saved.fixedLoop;
  object.onWater = saved.onWater;
  object.onLand = saved.onLand;
  object.repositioned = saved.repositioned;
  object.didNotMove = saved.didNotMove;
}
