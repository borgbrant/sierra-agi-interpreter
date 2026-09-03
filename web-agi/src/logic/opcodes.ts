/**
 * The LOGIC instruction set.
 *
 * Argument counts are what matter here: every argument is one byte, so a wrong
 * count desynchronises the decoder for the rest of the resource. The names are
 * for reading disassembly and carry no weight in decoding.
 *
 * Derived from the command tables in the AGI specification, chapter 6.2. That
 * document's opcode column is damaged in places -- runs of rows share a single
 * bogus value -- but its rows are a complete, ordered listing, so an entry's
 * opcode is its position. Positions 0x00-0x29 still carry their printed opcode
 * and agree exactly, and `return`, `new.room`, `print` and `quit` land where
 * AGI is independently known to put them.
 *
 * The table is nonetheless checked rather than trusted: `logic.test.ts` walks
 * every LOGIC resource in the game and requires each decode to land exactly on
 * the message section. A wrong argument count cannot survive that.
 */

/** `said` takes a variable number of arguments rather than a fixed count. */
export const VARIADIC = -1;

export interface Command {
  name: string;
  /** Number of single-byte arguments, or VARIADIC. */
  args: number;
}

/**
 * How many action commands each interpreter knows. Sierra added commands over
 * time, so the ceiling is a property of the interpreter, not of AGI.
 */
export const COMMAND_COUNT_BY_INTERPRETER: Record<string, number> = {
  '2.089': 155,
  '2.272': 161,
  // The specification's version table says 169 for 2.440, but the bundled game
  // uses opcode 0xA9 (close.window, the 170th command) in LOGIC 6. Accepting it
  // makes all 46 resources decode exactly to their message section with every
  // jump landing on an instruction boundary; rejecting it fails one resource.
  // Desync would corrupt the walk rather than tidy it, so the count is 170.
  // Raising the limit further changes nothing: 0xA9 is the highest used.
  '2.440': 170,
  '2.917': 173,
  '2.936': 175,
  '3.002.149': 181,
};

/** The interpreter the bundled game was built for. */
export const INTERPRETER_VERSION = '2.440';

/** Action commands, indexed by opcode. */
export const ACTIONS: readonly Command[] = [
  { name: 'return', args: 0 },
  { name: 'increment', args: 1 },
  { name: 'decrement', args: 1 },
  { name: 'assignn', args: 2 },
  { name: 'assignv', args: 2 },
  { name: 'addn', args: 2 },
  { name: 'addv', args: 2 },
  { name: 'subn', args: 2 },
  { name: 'subv', args: 2 },
  { name: 'lindirectv', args: 2 },
  { name: 'rindirect', args: 2 },
  { name: 'lindirectn', args: 2 },
  { name: 'set', args: 1 },
  { name: 'reset', args: 1 },
  { name: 'toggle', args: 1 },
  { name: 'set.v', args: 1 },
  { name: 'reset.v', args: 1 },
  { name: 'toggle.v', args: 1 },
  { name: 'new.room', args: 1 },
  { name: 'new.room.v', args: 1 },
  { name: 'load.logics', args: 1 },
  { name: 'load.logics.v', args: 1 },
  { name: 'call', args: 1 },
  { name: 'call.v', args: 1 },
  { name: 'load.pic', args: 1 },
  { name: 'draw.pic', args: 1 },
  { name: 'show.pic', args: 0 },
  { name: 'discard.pic', args: 1 },
  { name: 'overlay.pic', args: 1 },
  { name: 'show.pri.screen', args: 0 },
  { name: 'load.view', args: 1 },
  { name: 'load.view.v', args: 1 },
  { name: 'discard.view', args: 1 },
  { name: 'animate.obj', args: 1 },
  { name: 'unanimate.all', args: 0 },
  { name: 'draw', args: 1 },
  { name: 'erase', args: 1 },
  { name: 'position', args: 3 },
  { name: 'position.v', args: 3 },
  { name: 'get.posn', args: 3 },
  { name: 'reposition', args: 3 },
  { name: 'set.view', args: 2 },
  { name: 'set.view.v', args: 2 },
  { name: 'set.loop', args: 2 },
  { name: 'set.loop.v', args: 2 },
  { name: 'fix.loop', args: 1 },
  { name: 'release.loop', args: 1 },
  { name: 'set.cel', args: 2 },
  { name: 'set.cel.v', args: 2 },
  { name: 'last.cel', args: 2 },
  { name: 'current.cel', args: 2 },
  { name: 'current.loop', args: 2 },
  { name: 'current.view', args: 2 },
  { name: 'number.of.loops', args: 2 },
  { name: 'set.priority', args: 2 },
  { name: 'set.priority.v', args: 2 },
  { name: 'release.priority', args: 1 },
  { name: 'get.priority', args: 2 },
  { name: 'stop.update', args: 1 },
  { name: 'start.update', args: 1 },
  { name: 'force.update', args: 1 },
  { name: 'ignore.horizon', args: 1 },
  { name: 'observe.horizon', args: 1 },
  { name: 'set.horizon', args: 1 },
  { name: 'object.on.water', args: 1 },
  { name: 'object.on.land', args: 1 },
  { name: 'object.on.anything', args: 1 },
  { name: 'ignore.objs', args: 1 },
  { name: 'observe.objs', args: 1 },
  { name: 'distance', args: 3 },
  { name: 'stop.cycling', args: 1 },
  { name: 'start.cycling', args: 1 },
  { name: 'normal.cycle', args: 1 },
  { name: 'end.of.loop', args: 2 },
  { name: 'reverse.cycle', args: 1 },
  { name: 'reverse.loop', args: 2 },
  { name: 'cycle.time', args: 2 },
  { name: 'stop.motion', args: 1 },
  { name: 'start.motion', args: 1 },
  { name: 'step.size', args: 2 },
  { name: 'step.time', args: 2 },
  { name: 'move.obj', args: 5 },
  { name: 'move.obj.v', args: 5 },
  { name: 'follow.ego', args: 3 },
  { name: 'wander', args: 1 },
  { name: 'normal.motion', args: 1 },
  { name: 'set.dir', args: 2 },
  { name: 'get.dir', args: 2 },
  { name: 'ignore.blocks', args: 1 },
  { name: 'observe.blocks', args: 1 },
  { name: 'block', args: 4 },
  { name: 'unblock', args: 0 },
  { name: 'get', args: 1 },
  { name: 'get.v', args: 1 },
  { name: 'drop', args: 1 },
  { name: 'put', args: 2 },
  { name: 'put.v', args: 2 },
  { name: 'get.room.v', args: 2 },
  { name: 'load.sound', args: 1 },
  { name: 'sound', args: 2 },
  { name: 'stop.sound', args: 0 },
  { name: 'print', args: 1 },
  { name: 'print.v', args: 1 },
  { name: 'display', args: 3 },
  { name: 'display.v', args: 3 },
  { name: 'clear.lines', args: 3 },
  { name: 'text.screen', args: 0 },
  { name: 'graphics', args: 0 },
  { name: 'set.cursor.char', args: 1 },
  { name: 'set.text.attribute', args: 2 },
  { name: 'shake.screen', args: 1 },
  { name: 'configure.screen', args: 3 },
  { name: 'status.line.on', args: 0 },
  { name: 'status.line.off', args: 0 },
  { name: 'set.string', args: 2 },
  { name: 'get.string', args: 5 },
  { name: 'word.to.string', args: 2 },
  { name: 'parse', args: 1 },
  { name: 'get.num', args: 2 },
  { name: 'prevent.input', args: 0 },
  { name: 'accept.input', args: 0 },
  { name: 'set.key', args: 3 },
  { name: 'add.to.pic', args: 7 },
  { name: 'add.to.pic.v', args: 7 },
  { name: 'status', args: 0 },
  { name: 'save.game', args: 0 },
  { name: 'restore.game', args: 0 },
  { name: 'init.disk', args: 0 },
  { name: 'restart.game', args: 0 },
  { name: 'show.obj', args: 1 },
  { name: 'random', args: 3 },
  { name: 'program.control', args: 0 },
  { name: 'player.control', args: 0 },
  { name: 'obj.status.v', args: 1 },
  { name: 'quit', args: 1 },
  { name: 'show.mem', args: 0 },
  { name: 'pause', args: 0 },
  { name: 'echo.line', args: 0 },
  { name: 'cancel.line', args: 0 },
  { name: 'init.joy', args: 0 },
  { name: 'toggle.monitor', args: 0 },
  { name: 'version', args: 0 },
  { name: 'script.size', args: 1 },
  { name: 'set.game.id', args: 1 },
  { name: 'log', args: 1 },
  { name: 'set.scan.start', args: 0 },
  { name: 'reset.scan.start', args: 0 },
  { name: 'reposition.to', args: 3 },
  { name: 'reposition.to.v', args: 3 },
  { name: 'trace.on', args: 0 },
  { name: 'trace.info', args: 3 },
  { name: 'print.at', args: 4 },
  { name: 'print.at.v', args: 4 },
  { name: 'discard.view.v', args: 1 },
  { name: 'clear.text.rect', args: 5 },
  { name: 'set.upper.left', args: 2 },
  { name: 'set.menu', args: 1 },
  { name: 'set.menu.item', args: 2 },
  { name: 'submit.menu', args: 0 },
  { name: 'enable.item', args: 1 },
  { name: 'disable.item', args: 1 },
  { name: 'menu.input', args: 0 },
  { name: 'show.obj.v', args: 1 },
  { name: 'open.dialogue', args: 0 },
  { name: 'close.dialogue', args: 0 },
  { name: 'mul.n', args: 2 },
  { name: 'mul.v', args: 2 },
  { name: 'div.n', args: 2 },
  { name: 'div.v', args: 2 },
  { name: 'close.window', args: 0 },
  { name: 'unknown170', args: 1 },
  { name: 'unknown171', args: 0 },
  { name: 'unknown172', args: 0 },
  { name: 'unknown173', args: 0 },
  { name: 'unknown174', args: 1 },
  { name: 'unknown175', args: 1 },
  { name: 'unknown176', args: 0 },
  { name: 'unknown177', args: 1 },
  { name: 'unknown178', args: 0 },
  { name: 'unknown179', args: 4 },
  { name: 'unknown180', args: 2 },
  { name: 'unknown181', args: 0 },];

/** Test commands, used only inside if-conditions. Indexed by opcode. */
export const TESTS: readonly (Command | undefined)[] = [
  undefined, // opcode 0 is not a test
  { name: 'equaln', args: 2 },
  { name: 'equalv', args: 2 },
  { name: 'lessn', args: 2 },
  { name: 'lessv', args: 2 },
  { name: 'greatern', args: 2 },
  { name: 'greaterv', args: 2 },
  { name: 'isset', args: 1 },
  { name: 'issetv', args: 1 },
  { name: 'has', args: 1 },
  { name: 'obj.in.room', args: 2 },
  { name: 'posn', args: 5 },
  { name: 'controller', args: 1 },
  { name: 'have.key', args: 0 },
  { name: 'said', args: VARIADIC },
  { name: 'compare.strings', args: 2 },
  { name: 'obj.in.box', args: 5 },
  { name: 'center.posn', args: 5 },
  { name: 'right.posn', args: 5 },];

/** Bytecode markers that are not commands. */
export const MARKER = {
  /** Opens and closes a condition list. */
  IF: 0xff,
  /** Else: followed by a two-byte distance. */
  ELSE: 0xfe,
  /** Negates the condition that follows. */
  NOT: 0xfd,
  /** Brackets a group of ORed conditions. */
  OR: 0xfc,
} as const;

/** Opcode of `said`, whose arguments are a count followed by 16-bit words. */
export const SAID = 0x0e;

/** Look up an action command for a given interpreter. */
export function actionFor(opcode: number, commandCount: number): Command | undefined {
  if (opcode >= commandCount) return undefined;
  return ACTIONS[opcode];
}
