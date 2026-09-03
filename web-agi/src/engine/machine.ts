/**
 * The virtual machine the game's scripts run on.
 *
 * Scripts call other scripts, so the machine keeps a call stack. Three commands
 * do not return normally and must unwind out of every nested call: `new.room`
 * abandons the rest of the cycle, `quit` stops the engine, and `return` ends
 * only the script that issued it.
 */
import { decodeLogic, type Condition, type Instruction } from '../logic/reader.ts';
import { parseLogic, type LogicResource } from '../logic/resource.ts';
import type { ResourceManager } from '../resources/manager.ts';
import type { SaveStore } from '../storage/saves.ts';
import type { ObjectFile } from '../resources/objects.ts';
import type { Vocabulary } from '../resources/words.ts';
import { Screens } from '../render/screens.ts';
import { addToPicture, type AddedCel } from './animate.ts';
import type { SavedArea } from '../render/sprite.ts';
import { Keyboard } from '../input/keyboard.ts';
import { parseInput, saidMatches, type ParsedWord } from '../input/parser.ts';
import { Prompt } from '../input/prompt.ts';
import {
  DEFAULT_BACKGROUND_COLOUR,
  DEFAULT_TEXT_COLOUR,
  TextLayer,
  type TextWindow,
} from '../render/text.ts';
import { SoundPlayer } from '../audio/player.ts';
import type { SoundChip } from '../audio/output.ts';
import type { DisplayMode } from '../render/drivers/driver.ts';
import { parseSound } from '../resources/sound.ts';
import { computerTypeFor, MONITOR, monitorTypeFor } from './hardware.ts';
import { Inventory } from './inventory.ts';
import { defaultLayout, type ScreenLayout } from './layout.ts';
import { CommandLine, KeyPress, type Interaction, type Key } from './interaction.ts';
import { KeyBindings, MenuBar } from './menu.ts';
import { checkFooting, noBlock, priorityForRow, type Block } from './motion.ts';
import { FLAG, GameState, MAX_SOUND_VOLUME, SOUND_GENERATOR_VALUE, VAR } from './state.ts';
import { ViewTable, type View, type ViewObject } from './viewtable.ts';

/** Raised to abandon the rest of a cycle, through however many nested calls. */
export class Unwind extends Error {
  readonly kind: 'new-room' | 'quit' | 'restart' | 'restore';
  readonly room: number;

  constructor(kind: 'new-room' | 'quit' | 'restart' | 'restore', room = 0) {
    super(kind);
    this.name = 'Unwind';
    this.kind = kind;
    this.room = room;
  }
}

/**
 * Most instructions one cycle may run before the engine calls it a runaway.
 *
 * A cycle is a few thousand instructions; a script that passes this is looping
 * on a condition the engine never makes true, which without a limit is a frozen
 * tab rather than a bug report. Generous enough that no legitimate cycle can
 * reach it, and cheap enough to check on every instruction.
 */
export const INSTRUCTION_BUDGET = 500_000;

/**
 * Backward jumps a script may take with no command between them.
 *
 * Comfortably more than any real loop needs -- a loop that does nothing at all
 * for this many iterations is not counting, it is waiting.
 */
export const SPIN_LIMIT = 64;

/** Raised when a script does something the engine cannot yet do. */
export class EngineError extends Error {
  readonly code = 'ENGINE_DEFECT';
  readonly logicId: number;
  readonly at: number;

  constructor(message: string, logicId: number, at: number) {
    super(`${message} (logic ${logicId}, byte ${at})`);
    this.name = 'EngineError';
    this.logicId = logicId;
    this.at = at;
  }
}

/** A decoded script, with the address map its jumps need. */
export interface CompiledLogic {
  id: number;
  resource: LogicResource;
  instructions: Instruction[];
  /** Bytecode address to instruction index. */
  indexAt: Map<number, number>;
  /**
   * Where this script starts when it is next entered.
   *
   * Normally the beginning. `set.scan.start` moves it, which is how an AGI
   * script waits for a keypress without blocking: it prints its question, marks
   * the scan start, and returns. Every later cycle re-enters the script *after*
   * the question, tests whether a key has arrived, and returns again until one
   * has. Treating the command as a no-op leaves such a script re-asking its
   * question forever, which is not obviously wrong until you watch it.
   */
  scanStart: number;
}

/**
 * A command implementation.
 *
 * A command that has to wait for the player returns the thing being waited on.
 * The machine yields it and resumes at the next instruction once it is over,
 * which is how `print` and `get.num` block the script without blocking the
 * browser.
 */
export type Handler = (machine: Machine, args: number[]) => Interaction | void;

export interface MachineOptions {
  resources: ResourceManager;
  objects: ObjectFile;
  vocabulary?: Vocabulary;
  /** Where sound comes out. Omitted, the engine plays silently but in time. */
  sound?: SoundPlayer;
  /** Called the first time each unimplemented command is reached. */
  onStub?: (name: string) => void;
}

export class Machine {
  readonly state = new GameState();

  /** The picture as drawn, before any sprites are composited over it. */
  readonly background = new Screens();

  /** What the player would see: background plus everything drawn on top. */
  readonly screens = new Screens();

  readonly resources: ResourceManager;
  readonly objects: ObjectFile;
  readonly vocabulary: Vocabulary | undefined;

  /** Commands reached but not yet implemented, and how often. */
  readonly stubs = new Map<string, number>();

  /** Set by new.room, consumed by the cycle. */
  pendingRoom: number | null = null;

  /** Set by quit. */
  stopped = false;

  /**
   * Set when an interaction has replaced the whole machine with a saved game.
   *
   * The script that called `restore.game` belongs to the game that has just
   * been thrown away, so the rest of its cycle is abandoned -- the same
   * treatment `new.room` gets, for the same reason.
   */
  restored = false;

  /** Where saved games are kept, or null when the shell has not provided any. */
  saves: SaveStore | null = null;

  /** Which pictures the scripts have asked to be loaded. */
  readonly loadedPictures = new Set<number>();

  /** The picture currently composed into the background. */
  currentPicture: number | null = null;

  /** Whether show.pic has published the background since it was last drawn. */
  pictureShown = false;

  /** Rows above this are sky: ego cannot walk there. */
  horizon = 0;

  /** Whether the player's typing reaches the game. */
  inputAccepted = false;

  /** Whether the status line is drawn. */
  statusLineVisible = false;

  /**
   * Where the status line, the input line and the print floor sit.
   *
   * The game's, not the engine's: `configure.screen` moves all three. See
   * {@link ./layout.ts}.
   */
  layout: ScreenLayout = defaultLayout();

  /**
   * Which adapter the game is being drawn on.
   *
   * Held here because the scripts ask about it, not because anything here
   * draws: what the pixels look like is the display driver's business, and the
   * engine never reads this for anything but the reserved variables.
   */
  displayMode: DisplayMode = 'ega';

  /** Where the game's objects are now, as opposed to where they started. */
  readonly inventory: Inventory;

  /** The command line the player types into. */
  readonly prompt = new Prompt();

  /** The menu the game defined, and the keys it bound to controllers. */
  readonly menuBar = new MenuBar();
  readonly keyBindings = new KeyBindings();

  /**
   * Controllers that fired this cycle.
   *
   * Cleared every cycle rather than when read: a script tests `controller(n)`
   * once and expects it to have gone by the next cycle.
   */
  readonly controllers = new Set<number>();

  /** What the player last typed, as word numbers the scripts can test. */
  parsedWords: ParsedWord[] = [];

  /** Colours the text commands draw in. */
  textForeground = DEFAULT_TEXT_COLOUR;
  textBackground = DEFAULT_BACKGROUND_COLOUR;

  /** What the game is waiting for, or null when it is running. */
  pending: Interaction | null = null;

  /**
   * A window left on screen that nothing is waiting for.
   *
   * A script can ask for a message that does not stop the game, and then take
   * it away later with `close.window`. That is a different thing from
   * {@link pending}, which is the game standing still until the player acts.
   */
  window: TextWindow | null = null;

  /**
   * Text written into character cells, which the picture shows through.
   *
   * Separate from the screens: text is an overlay in AGI, not paint on the
   * scene, so taking a caption away reveals what was behind it without the
   * picture having to be redrawn.
   */
  readonly textLayer = new TextLayer();

  /** Whether a script has switched to the full-screen text mode. */
  textMode = false;

  /** The last line the player submitted, so `echo.line` can bring it back. */
  lastLine = '';

  /** Every object that can move or animate. Entry 0 is ego. */
  readonly viewTable = new ViewTable();

  /** What the objects covered when they were last drawn, so it can be put back. */
  readonly savedAreas: SavedArea[] = [];

  /**
   * Cels a script painted into the picture with `add.to.pic`.
   *
   * The background itself is never saved -- a snapshot holds the picture
   * number, and pictures are files. Anything a script drew on top of one is
   * not, so it is kept here to be replayed when a game is restored.
   */
  readonly scenery: AddedCel[] = [];

  /** What the player is pressing. */
  readonly keyboard = new Keyboard();

  /** The sound that is playing, and who is waiting for it to finish. */
  readonly sound: SoundPlayer;

  /**
   * Whether the arrow keys steer ego.
   *
   * `program.control` takes ego away from the player for a scripted walk, and
   * `player.control` gives it back. While it is false the script drives ego
   * through the direction variable instead.
   */
  playerControl = true;

  /** The rectangle `block` forbids crossing, if a script set one. */
  block: Block = noBlock();

  /**
   * The script being executed, so commands can resolve message numbers against
   * the right message table. Messages are per-resource, not global.
   */
  currentLogic: CompiledLogic | null = null;

  /** Instructions run since the cycle began; see {@link INSTRUCTION_BUDGET}. */
  #executed = 0;

  /** Backward jumps taken with no command in between; see {@link Machine.run}. */
  #spins = 0;

  /** Whether the condition just evaluated asked whether a key is waiting. */
  #sawHaveKey = false;

  #logic = new Map<number, CompiledLogic>();
  #handlers: Handler[] = [];
  #onStub: ((name: string) => void) | undefined;
  #depth = 0;

  /** Address of the instruction after the one now running. */
  #nextAddress = 0;

  constructor(options: MachineOptions) {
    this.resources = options.resources;
    this.objects = options.objects;
    this.vocabulary = options.vocabulary;
    this.inventory = new Inventory(options.objects);
    this.sound = options.sound ?? new SoundPlayer();
    this.#onStub = options.onStub;
  }

  /** Install the command table. */
  setHandlers(handlers: Handler[]): void {
    this.#handlers = handlers;
  }

  /**
   * Start counting instructions again, at the top of a cycle.
   *
   * The budget covers a whole cycle rather than a single script: a runaway is
   * usually a script calling another one round and round, and each call on its
   * own is short.
   */
  resetInstructionBudget(): void {
    this.#executed = 0;
    this.#spins = 0;
  }

  /**
   * A backward jump with no command run since the last one.
   *
   * A few of those are ordinary -- a loop counting through objects tests and
   * jumps -- so this only acts once the count is past anything a real loop
   * would need. Past that, the script is going round on tests alone, and tests
   * read state that nothing inside the loop can change.
   *
   * What it is waiting for is nearly always a key: the game's help, puzzle and
   * status screens all end in `if (!have.key()) goto self`, which the original
   * satisfies by reading the keyboard from inside the loop. Here the cycle
   * parks on a {@link KeyPress} instead, so the browser gets to deliver one.
   *
   * A spin waiting for anything else cannot be resolved by waiting -- nothing
   * else changes mid-cycle -- so it is reported rather than left to hang.
   */
  *#spun(id: number, at: number): Generator<Interaction, void, void> {
    if (++this.#spins <= SPIN_LIMIT) return;

    if (!this.#sawHaveKey) {
      throw new EngineError('a script is looping on tests that nothing can change', id, at);
    }

    this.#spins = 0;
    yield new KeyPress();
  }

  /** Record that an unimplemented command was reached, and carry on. */
  stub(name: string): void {
    const seen = this.stubs.get(name) ?? 0;
    this.stubs.set(name, seen + 1);
    if (seen === 0) this.#onStub?.(name);
  }

  /** Decode a script, once. */
  compile(id: number): CompiledLogic {
    const cached = this.#logic.get(id);
    if (cached) return cached;

    const resource = parseLogic(this.resources.loadSync('logic', id));
    const instructions = decodeLogic(resource.bytecode);

    const indexAt = new Map<number, number>();
    instructions.forEach((instruction, index) => indexAt.set(instruction.at, index));
    indexAt.set(resource.bytecode.length, instructions.length); // jumping to the end

    const compiled = { id, resource, instructions, indexAt, scanStart: 0 };
    this.#logic.set(id, compiled);
    return compiled;
  }

  /** Decode a VIEW, once. */
  loadView(id: number): View {
    return this.viewTable.view(id, () => this.resources.loadSync('view', id));
  }

  /** Forget a decoded script, so a reload picks up a fresh copy. */
  discardLogic(id: number): void {
    this.#logic.delete(id);
  }

  /**
   * Run one script.
   *
   * This is a generator, and that is the whole design of waiting in this
   * engine. A command that needs the player -- a message to dismiss, a question
   * to answer -- returns the thing being waited on; the generator yields it and
   * the caller parks. When the player is done the generator is resumed and the
   * script continues at the *next* instruction, exactly as it would have if the
   * command had blocked. Nothing anywhere blocks a frame.
   *
   * `call` is handled here rather than as a command, because a called script
   * can wait too, and a plain function could not pass that back up.
   *
   * Returns normally when the script hits `return` or runs off the end.
   * `new.room` and `quit` throw {@link Unwind} through every caller.
   */
  *run(id: number): Generator<Interaction, void, void> {
    if (this.#depth > 32) {
      throw new EngineError('scripts nested more than 32 deep', id, 0);
    }

    const compiled = this.compile(id);
    const caller = this.currentLogic;
    this.currentLogic = compiled;
    this.#depth++;

    try {
      // Not necessarily the beginning: a script that marked a scan start
      // resumes from there.
      let pc = compiled.indexAt.get(compiled.scanStart) ?? 0;

      while (pc < compiled.instructions.length) {
        const instruction = compiled.instructions[pc]!;

        // Checked here rather than beside the commands, because a script can
        // spin on nothing but tests and jumps -- which is exactly what the
        // loops below are, and what used to hang the tab in silence.
        if (++this.#executed > INSTRUCTION_BUDGET) {
          throw new EngineError(
            `a script has run ${INSTRUCTION_BUDGET} instructions without finishing the cycle`,
            id,
            instruction.at,
          );
        }

        if (instruction.kind === 'if') {
          this.#sawHaveKey = false;
          const passed = this.#test(instruction.conditions);
          if (passed) {
            pc++;
            continue;
          }
          if (instruction.target <= instruction.at) yield* this.#spun(id, instruction.at);
          pc = this.#jump(compiled, instruction.target, instruction.at);
          continue;
        }

        if (instruction.kind === 'else') {
          if (instruction.target <= instruction.at) yield* this.#spun(id, instruction.at);
          pc = this.#jump(compiled, instruction.target, instruction.at);
          continue;
        }

        // `return` ends this script and only this one.
        if (instruction.opcode === 0) return;

        if (instruction.name === 'call' || instruction.name === 'call.v') {
          const target =
            instruction.name === 'call'
              ? instruction.args[0]!
              : this.state.getVar(instruction.args[0]!);
          yield* this.run(target);
          // The called script may have left a different one current.
          this.currentLogic = compiled;
          pc++;
          continue;
        }

        const handler = this.#handlers[instruction.opcode];
        if (!handler) {
          throw new EngineError(
            `no handler for ${instruction.name} (opcode 0x${instruction.opcode.toString(16)})`,
            id,
            instruction.at,
          );
        }

        // `set.scan.start` needs to name the instruction after itself.
        this.#nextAddress =
          compiled.instructions[pc + 1]?.at ?? compiled.resource.bytecode.length;

        // A command ran, so whatever the script is doing it is not spinning.
        this.#spins = 0;

        const waiting = handler(this, instruction.args);
        if (waiting) {
          yield waiting;

          // The interaction may have been a restore, in which case everything
          // this script was running against is gone.
          if (this.restored) {
            this.restored = false;
            throw new Unwind('restore');
          }
        }
        pc++;
      }
    } finally {
      this.#depth--;
      this.currentLogic = caller;
    }
  }

  /**
   * Run a script straight through, refusing to wait.
   *
   * For tests and for the few places that know their script cannot wait. A
   * command that tries to wait is a defect here rather than a silent skip.
   */
  execute(id: number): void {
    const script = this.run(id);
    const step = script.next();
    if (!step.done) {
      script.return();
      throw new EngineError('this script waits for the player; drive it with a cycle', id, 0);
    }
  }

  /** Text of a message in the script now running. */
  message(number: number): string | null {
    return this.currentLogic?.resource.messages.texts[number] ?? null;
  }

  /**
   * Text of a message in logic 0.
   *
   * Logic 0 runs every cycle and its messages are the closest thing AGI has to
   * global text, which is why messages can reach them with their own escape.
   */
  globalMessage(number: number): string | null {
    try {
      return this.compile(0).resource.messages.texts[number] ?? null;
    } catch {
      return null;
    }
  }

  /** Translate a jump target into an instruction index. */
  #jump(compiled: CompiledLogic, target: number, from: number): number {
    const index = compiled.indexAt.get(target);
    if (index === undefined) {
      throw new EngineError(`jump to ${target} is not an instruction boundary`, compiled.id, from);
    }
    return index;
  }

  /** Evaluate a list of conditions, which are ANDed together. */
  #test(conditions: Condition[]): boolean {
    return conditions.every((condition) => this.#one(condition));
  }

  #one(condition: Condition): boolean {
    switch (condition.kind) {
      case 'not':
        return !this.#one(condition.condition);
      case 'or':
        return condition.conditions.some((c) => this.#one(c));
      case 'said':
        return this.said(condition.words);
      case 'test':
        return this.#testCommand(condition);
    }
  }

  #testCommand(condition: Extract<Condition, { kind: 'test' }>): boolean {
    const { state } = this;
    const a = condition.args;

    switch (condition.name) {
      case 'equaln':
        return state.getVar(a[0]!) === a[1]!;
      case 'equalv':
        return state.getVar(a[0]!) === state.getVar(a[1]!);
      case 'lessn':
        return state.getVar(a[0]!) < a[1]!;
      case 'lessv':
        return state.getVar(a[0]!) < state.getVar(a[1]!);
      case 'greatern':
        return state.getVar(a[0]!) > a[1]!;
      case 'greaterv':
        return state.getVar(a[0]!) > state.getVar(a[1]!);
      case 'isset':
        return this.#flag(a[0]!);
      case 'issetv':
        return this.#flag(state.getVar(a[0]!));
      case 'has':
        return this.inventory.isCarried(a[0]!);
      case 'obj.in.room':
        return this.inventory.roomOf(a[0]!) === state.getVar(a[1]!);
      case 'compare.strings':
        return state.getString(a[0]!) === state.getString(a[1]!);
      case 'have.key':
        this.#sawHaveKey = true;
        return state.getVar(VAR.KEY_PRESSED) !== 0;
      case 'controller':
        return this.controllers.has(a[0]!);

      // Position tests. All four ask whether a point of the object lies inside
      // a rectangle; they differ only in which point of the object they take.
      case 'posn':
        return this.#inBox(a[0]!, a, (object) => object.x, (object) => object.y);
      case 'obj.in.box':
        return this.#inBox(
          a[0]!,
          a,
          (object) => object.x,
          (object) => object.y,
          (object) => object.x + object.width - 1,
        );
      case 'center.posn':
        return this.#inBox(
          a[0]!,
          a,
          (object) => object.x + Math.floor(object.width / 2),
          (object) => object.y,
        );
      case 'right.posn':
        return this.#inBox(
          a[0]!,
          a,
          (object) => object.x + object.width - 1,
          (object) => object.y,
        );

      default:
        this.stub(condition.name);
        return false;
    }
  }

  /** Read a flag, refreshing interpreter-owned terrain flags when asked. */
  #flag(index: number): boolean {
    if (index === FLAG.EGO_ON_WATER || index === FLAG.EGO_TOUCHED_SIGNAL) {
      const ego = this.viewTable.ego;
      const priority = ego.fixedPriority ? ego.priority : priorityForRow(ego.y);
      const footing = checkFooting(this.background, ego, priority);
      this.state.setFlag(FLAG.EGO_ON_WATER, footing.water);
      this.state.setFlag(FLAG.EGO_TOUCHED_SIGNAL, footing.signal);
    }

    return this.state.getFlag(index);
  }

  /**
   * Whether an object's reference point lies within a rectangle.
   *
   * @param args   the test's five arguments: object, x1, y1, x2, y2
   * @param left   which x of the object counts as its left edge
   * @param bottom which y of the object counts as its base
   * @param right  which x counts as its right edge, when the whole width must
   *               fit inside the box rather than just one point
   */
  #inBox(
    number: number,
    args: readonly number[],
    left: (object: ViewObject) => number,
    bottom: (object: ViewObject) => number,
    right?: (object: ViewObject) => number,
  ): boolean {
    const object = this.viewTable.at(number);
    if (!object) return false;

    const [, x1 = 0, y1 = 0, x2 = 0, y2 = 0] = args;
    const x = left(object);
    const y = bottom(object);
    const far = right ? right(object) : x;

    return x >= x1 && y >= y1 && far <= x2 && y <= y2;
  }

  // --- The player -----------------------------------------------------------

  /**
   * Whether a `said` test matches what the player typed.
   *
   * Three conditions, and all of them matter. There has to be a line to match
   * against; no earlier `said` in this cycle may already have claimed it, or a
   * sentence would fire every test it happens to fit; and the match itself has
   * to account for every word. A test that matches claims the line, which is
   * how a script can list its specific phrasings before its general ones.
   */
  said(words: readonly number[]): boolean {
    if (!this.state.getFlag(FLAG.PLAYER_COMMAND_ENTERED)) return false;
    if (this.state.getFlag(FLAG.SAID_ACCEPTED_INPUT)) return false;
    if (!saidMatches(words, this.parsedWords)) return false;

    this.state.setFlag(FLAG.SAID_ACCEPTED_INPUT, true);
    return true;
  }

  /**
   * Make the running script resume after this point next time it is entered.
   *
   * @see CompiledLogic.scanStart
   */
  /**
   * Paint one remembered cel back into the picture, when restoring a game.
   *
   * Goes through the same drawing as `add.to.pic` did, and records itself
   * again, so a game saved, restored and saved once more keeps its scenery.
   */
  addSceneryFromSave(saved: AddedCel): void {
    const frame = this.loadView(saved.view).loops[saved.loop]?.cels[saved.cel];
    if (!frame) {
      this.stub(`restore: view ${saved.view} has no loop ${saved.loop} cel ${saved.cel}`);
      return;
    }

    addToPicture(
      this,
      { cel: frame, loop: saved.loop },
      saved.x,
      saved.y,
      saved.priority,
      saved.margin,
      saved.view,
      saved.cel,
    );
  }

  /** Every script's re-entry point, for a snapshot to keep. */
  scanStarts(): [number, number][] {
    return [...this.#logic.values()]
      .filter((compiled) => compiled.scanStart !== 0)
      .map((compiled) => [compiled.id, compiled.scanStart]);
  }

  /**
   * Put the re-entry points back, compiling the scripts that need them.
   *
   * A restored game is usually a fresh page, where nothing has been compiled
   * yet -- so this compiles each script named rather than skipping it, or the
   * one script that was mid-wait would come back at the top of its question.
   */
  restoreScanStarts(starts: readonly (readonly [number, number])[]): void {
    for (const compiled of this.#logic.values()) compiled.scanStart = 0;
    for (const [id, address] of starts) {
      if (this.resources.isPresent('logic', id)) this.compile(id).scanStart = address;
    }
  }

  setScanStart(): void {
    if (this.currentLogic) this.currentLogic.scanStart = this.#nextAddress;
  }

  /** Make the running script start from the beginning again. */
  resetScanStart(): void {
    if (this.currentLogic) this.currentLogic.scanStart = 0;
  }

  /** Note that a controller fired, from a menu choice or a bound key. */
  triggerController(controller: number): void {
    this.controllers.add(controller);
  }

  /**
   * Hand the scripts a line the player typed.
   *
   * Nothing runs here. The words are parked and a flag is raised, and the next
   * cycle's scripts act on them, so a command always takes effect on a cycle
   * boundary rather than in the middle of one.
   */
  submitLine(line: string): void {
    if (!this.vocabulary) return;

    const parsed = parseInput(line, this.vocabulary);
    this.parsedWords = parsed.words;
    this.lastLine = line;
    this.state.setVar(VAR.UNKNOWN_WORD, parsed.unknownWordPosition);
    this.state.setFlag(FLAG.PLAYER_COMMAND_ENTERED, true);
    this.state.setFlag(FLAG.SAID_ACCEPTED_INPUT, false);
  }

  /**
   * Route a key.
   *
   * The order is the whole of AGI's input model. Whatever the game is waiting
   * for takes the key first; then keys a script has bound to a controller;
   * then the menu; then the command line, which claims anything printable;
   * and only what is left over reaches ego's feet. That is why the arrow keys
   * walk while the letters type.
   *
   * @returns whether the engine claimed the key
   */
  handleKey(key: Key): boolean {
    // Recorded before anything else can claim it: the "key just pressed"
    // variable is a raw buffer, and scripts watch it while the command line is
    // still collecting the same keystrokes.
    this.keyboard.note(key.char);

    if (this.pending) {
      if (this.pending.key(this, key)) this.dismissPending();
      return true;
    }

    const controller = this.keyBindings.controllerFor(key);
    if (controller !== undefined) {
      this.triggerController(controller);
      return true;
    }

    if (this.inputAccepted && this.prompt.visible) {
      // A display with no room for an input row gets a box instead, and the
      // box opens on the keystroke that would have gone into the row. It
      // covers the scene, so the game parks on it until the line is handed
      // over; see CommandLine.
      if (this.monochrome) {
        if (key.char >= 0x20 && key.char <= 0x7e) {
          this.pending = new CommandLine(
            String.fromCharCode(key.char),
            this.prompt.cursorChar,
            this.prompt.maxLength,
          );
          return true;
        }
        // Nothing else opens it: an arrow key still walks ego, and Enter on an
        // empty line submits nothing, exactly as it does on a colour display.
        return this.keyboard.press(key.name, key.code);
      }

      const line = this.prompt.key(key.char, key.name);
      if (line !== null) {
        this.submitLine(line);
        return true;
      }
      if (key.char >= 0x20 && key.char <= 0x7e) return true;
      if (key.name === 'Backspace' || key.name === 'Escape') return true;
    }

    return this.keyboard.press(key.name, key.code);
  }

  /** End whatever the game was waiting for, letting its result be written. */
  dismissPending(): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    pending.finish(this);
  }

  /** Start a new room. Throws to abandon the rest of the cycle. */
  newRoom(room: number): never {
    this.pendingRoom = room;
    throw new Unwind('new-room', room);
  }

  /**
   * Start a sound, and remember who is waiting for it.
   *
   * A missing SOUND resource is a game-data oddity rather than a defect: it is
   * noted and the flag is set at once, which is exactly what the engine did for
   * every sound before there was any.
   *
   * @param id   SOUND resource number
   * @param flag flag to set when the sound ends; 0 when the script does not wait
   */
  playSound(id: number, flag: number): void {
    let sound;
    try {
      sound = parseSound(this.resources.loadSync('sound', id));
    } catch {
      this.stub(`sound: resource ${id} could not be played`);
      if (flag) this.state.setFlag(flag, true);
      return;
    }

    this.#applySoundVolume();
    this.#releaseSoundFlag(this.sound.play(sound, flag));

    // A sound with nothing in it must not leave a script waiting for a moment
    // that never comes.
    if (sound.durationMs <= 0) this.#releaseSoundFlag(this.sound.stop());
  }

  /**
   * Choose the machine's sound hardware.
   *
   * One entry point, because two things have to agree: what the player hears,
   * and what the scripts are told they are being played on. Changing only the
   * first is the state this engine was in before M9 -- four voices, announced
   * as a PC speaker.
   */
  setSoundChip(chip: SoundChip): void {
    this.sound.setChip(chip);
    this.state.setVar(VAR.SOUND_GENERATOR, SOUND_GENERATOR_VALUE[chip]);
    // The chip is what the computer type is inferred from -- the PCjr's chip
    // with ordinary graphics is a Tandy 1000, and the scripts give one its
    // volume keys -- so changing it changes what the scripts are told.
    this.describeMachine();
  }

  /**
   * Choose the adapter the game is drawn on.
   *
   * Two things follow, and only one of them is visible. The scripts are told
   * what they are being displayed on, which is what this does; and the shell
   * swaps the display driver, which is the renderer's business and happens
   * there.
   */
  setDisplayMode(mode: DisplayMode): void {
    this.displayMode = mode;
    this.describeMachine();
  }

  /**
   * Tell the scripts what machine this is.
   *
   * Called whenever a choice changes and once at start-up, because a variable
   * that agrees with the shell only until something is switched is the defect
   * M9 was about.
   */
  describeMachine(): void {
    this.state.setVar(VAR.MONITOR_TYPE, monitorTypeFor(this.displayMode));
    this.state.setVar(VAR.COMPUTER_TYPE, computerTypeFor(this.sound.chip));
  }

  /**
   * Whether the display is monochrome.
   *
   * Read from the reserved variable rather than from {@link displayMode},
   * because the variable is the fact: it is what the scripts read, and
   * `toggle.monitor` can change it under them. Nothing here asks which driver
   * is running -- that is the display seam's business and off limits.
   */
  get monochrome(): boolean {
    return this.state.getVar(VAR.MONITOR_TYPE) === MONITOR.MONO;
  }

  /**
   * `toggle.monitor`: the game switching between colour and mono itself.
   *
   * The one command that writes the monitor variable from inside a script. The
   * game offers it as "Graphics Mode <Ctrl-R>" and only on a CGA screen, which
   * is the adapter the choice belonged to -- a composite monitor showing CGA's
   * colour artefacts as grey was worth being able to turn off.
   *
   * What flips is the answer, not the palette: told it is mono, the game lays
   * itself out for a mono screen while the driver goes on drawing in colour.
   * That split is the whole of this milestone, and this is the one place a
   * script can exercise it.
   */
  toggleMonitor(): void {
    const own = monitorTypeFor(this.displayMode);
    const now = this.state.getVar(VAR.MONITOR_TYPE);
    this.state.setVar(VAR.MONITOR_TYPE, now === MONITOR.MONO ? own : MONITOR.MONO);
  }

  /**
   * Stop whatever is playing.
   *
   * The flag is set on the way out. A script that stops its own sound and then
   * waits on that sound's flag is the one deadlock real playback can introduce
   * and the no-op it replaced could not, so stopping releases the waiter just
   * as finishing does.
   */
  stopSound(): void {
    this.#releaseSoundFlag(this.sound.stop());
  }

  /**
   * Let the sound age by real time.
   *
   * Driven from the loop rather than from a cycle, so a sound keeps running --
   * and finishes -- while the game is parked on a window waiting for a key.
   */
  tickSound(elapsedMs: number): void {
    this.#applySoundVolume();
    this.#releaseSoundFlag(this.sound.tick(elapsedMs));
  }

  /**
   * Follow the game's own sound settings.
   *
   * The flag is the on/off switch scripts and the status line use. The variable
   * is a level from 0 to 15 that the game's own volume keys move -- logic 0
   * increments it while it is under 15 and decrements it, which is where the
   * range comes from -- so it is honoured rather than treated as decoration.
   */
  #applySoundVolume(): void {
    const on = this.state.getFlag(FLAG.SOUND_ON);
    const level = Math.min(MAX_SOUND_VOLUME, this.state.getVar(VAR.SOUND_VOLUME));
    this.sound.setVolume(on ? level / MAX_SOUND_VOLUME : 0);
  }

  #releaseSoundFlag(flag: number): void {
    if (flag) this.state.setFlag(flag, true);
  }

  /** Stop the engine. */
  quit(): never {
    this.stopSound();
    this.stopped = true;
    throw new Unwind('quit');
  }

  /**
   * Start the game again from nothing. Throws to abandon the rest of the cycle.
   *
   * This is a real restart, not a room change. The game reaches it at the end
   * of its death sequence -- the rescue team puts Larry back together and the
   * story starts over -- so treating it as "enter this room again" leaves the
   * death room setting itself up and replaying its animation for ever.
   */
  restart(): never {
    throw new Unwind('restart');
  }

  /**
   * Throw away everything a game accumulated.
   *
   * More than the variables. Anything a script built up over a game has to go
   * or the new one inherits it: the menu would be defined a second time and
   * appear twice, a script's scan start would resume it half-way through, and
   * the previous game's picture would still be on screen.
   */
  resetForNewGame(): void {
    this.state.reset();
    this.inventory.reset();

    this.viewTable.unanimateAll();
    this.viewTable.reset();
    this.viewTable.discardViews();
    this.savedAreas.length = 0;

    this.loadedPictures.clear();
    this.scenery.length = 0;
    this.currentPicture = null;
    this.pictureShown = false;
    this.background.clear();
    this.screens.clear();

    this.textLayer.clear();
    this.textMode = false;
    // The layout goes back to the interpreter's own. A new game gets to ask
    // for its rows again, and the game does: logic 51 calls configure.screen
    // during start-up.
    this.layout = defaultLayout();
    this.textForeground = DEFAULT_TEXT_COLOUR;
    this.textBackground = DEFAULT_BACKGROUND_COLOUR;
    this.window = null;
    this.pending = null;

    this.prompt.clear();
    this.parsedWords = [];
    this.lastLine = '';
    this.controllers.clear();
    this.keyboard.clear();
    this.stopSound();

    // The menu and the key bindings deliberately survive. The game defines its
    // menus only in the block logic 0 runs the first time, and skips that block
    // on a restart -- it expects the menu it built to still be there. Clearing
    // it leaves the restarted game with no menu at all.

    this.block = noBlock();
    this.playerControl = true;
    this.pendingRoom = null;
    this.stopped = false;

    // Scripts are re-read, so nothing keeps a scan start from the old game.
    this.#logic.clear();
    this.currentLogic = null;
  }

  /** Convenience for the flags the engine itself owns. */
  get isNewRoom(): boolean {
    return this.state.getFlag(FLAG.NEW_ROOM);
  }
}
