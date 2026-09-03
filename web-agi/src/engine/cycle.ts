/**
 * The interpreter's loop.
 *
 * One cycle, in order:
 *
 *   1. wait out the cycle delay          (the accumulator, not this function)
 *   2. clear the keyboard buffer
 *   3. poll input
 *   4. update the reserved variables and flags
 *   5. recalculate object motion         (arrives with the view table)
 *   6. execute logic 0, which calls whatever else the game needs
 *   7. act on new.room
 *
 * Cycles are driven by a fixed-timestep accumulator rather than by the display
 * refresh rate. A slow frame must not make the game run fast, and a tab that
 * was in the background must not come back and run a thousand cycles at once.
 */
import { drawObjects, eraseObjects } from './animate.ts';
import type { Interaction } from './interaction.ts';
import { Machine, Unwind } from './machine.ts';
import { checkAllMotions, cycleObjects, updatePositions } from './motion.ts';
import { enterRoom } from './room.ts';
import { FLAG, MAX_SOUND_VOLUME, SOUND_GENERATOR_VALUE, VAR } from './state.ts';

/** The interpreter's clock: cycle delays are counted in twentieths of a second. */
export const TICK_MS = 50;

/** Never run more than this many cycles to catch up after a stall. */
export const MAX_CATCH_UP = 4;

/** Ticks in one second of game time. */
export const TICKS_PER_SECOND = 20;

/** The script every cycle starts from. */
export const MAIN_LOGIC = 0;

export class Cycle {
  readonly machine: Machine;

  /** Cycles completed since the engine started. */
  count = 0;

  /**
   * How many times the current room has been entered without leaving it.
   *
   * A diagnostic, not a rule. A room that keeps setting itself up is what a
   * looping animation looks like from the inside, and it has been the cause
   * twice now -- an unconsumed controller, and a restart that was really a
   * room change. Some re-entry is legitimate: the title sequence re-enters its
   * own room deliberately to loop the attract mode. So this is reported rather
   * than acted on.
   */
  reentries = 0;

  #lastRoom = -1;

  #accumulated = 0;
  #ticks = 0;

  /**
   * Logic 0, part-way through.
   *
   * A cycle is not always one call. When a script opens a window or asks a
   * question the generator parks here, and the next call to {@link runOnce}
   * picks it up at the instruction after the one that waited.
   */
  #script: Generator<Interaction, void, void> | null = null;

  constructor(machine: Machine) {
    this.machine = machine;
  }

  /** How long one cycle should take, from the delay the game asked for. */
  get intervalMs(): number {
    return Math.max(1, this.machine.state.getVar(VAR.CYCLE_DELAY)) * TICK_MS;
  }

  /** Start a new game at the given room. */
  start(room: number): void {
    const { machine } = this;
    machine.state.reset();
    machine.state.setVar(VAR.CYCLE_DELAY, 2);
    // Whatever the player chose, rather than a constant: the variable and the
    // hardware being out of step is exactly what M9 was about, and the monitor
    // and computer types are the same question asked of the display.
    machine.state.setVar(VAR.SOUND_GENERATOR, SOUND_GENERATOR_VALUE[machine.sound.chip]);
    machine.describeMachine();
    // The game turns this down and up with its volume keys; nothing sets it
    // for the first time, so a game started at zero would play silently.
    machine.state.setVar(VAR.SOUND_VOLUME, MAX_SOUND_VOLUME);
    machine.state.setVar(VAR.MAX_INPUT_LENGTH, 41);
    machine.state.setVar(VAR.FREE_MEMORY_PAGES, 255);
    machine.state.setFlag(FLAG.SOUND_ON, true);
    machine.state.setFlag(FLAG.LOGIC_ZERO_FIRST_TIME, true);

    this.#ticks = 0;
    this.#script = null;
    this.#enter(room);
  }

  /**
   * Begin the game again, telling the scripts that is what happened.
   *
   * The flag is raised after the reset, not before, because the reset clears
   * every flag -- and this one is how logic 0 knows to skip the opening and
   * drop the player straight back into the game.
   */
  restart(): void {
    this.machine.resetForNewGame();
    this.start(0);
    this.machine.state.setFlag(FLAG.RESTART_GAME, true);
  }

  /**
   * Run exactly one cycle.
   *
   * @returns false when no cycle ran: the game has stopped, or it is waiting
   *          for the player and will not move until they act
   */
  runOnce(): boolean {
    const { machine } = this;
    if (machine.stopped) return false;
    if (machine.pending) return false;

    if (!this.#script) {
      this.#beginCycle();
      this.#script = machine.run(MAIN_LOGIC);
    }

    try {
      const step = this.#script.next();
      if (!step.done) {
        // A script asked for the player. The cycle is not over; it is parked.
        machine.pending = step.value;
        return false;
      }
    } catch (error) {
      this.#script = null;
      if (!(error instanceof Unwind)) throw error;
      if (error.kind === 'quit') {
        machine.stopped = true;
        return false;
      }
      if (error.kind === 'restart') {
        this.restart();
        return true;
      }
      if (error.kind === 'restore') {
        // Nothing to load: the snapshot brought the room, the objects and the
        // picture with it. What is left is to stop counting this room as one
        // the game keeps re-entering, and to let the next cycle run normally.
        this.#lastRoom = machine.state.room;
        this.reentries = 1;
        this.#consumeOncePerCycle();
        this.count++;
        return true;
      }
      // new.room: the rest of this cycle is abandoned deliberately. What is
      // consumed once per cycle is still consumed, though -- a controller left
      // set here fires again next cycle, and a room entered by a controller
      // would be entered over and over.
      this.#consumeOncePerCycle();
      this.#enter(error.room);
      this.count++;
      return true;
    }

    this.#script = null;
    this.#endCycle();
    this.count++;
    return true;
  }

  /** Enter a room, keeping track of how often the same one comes round again. */
  #enter(room: number): void {
    this.reentries = room === this.#lastRoom ? this.reentries + 1 : 1;
    this.#lastRoom = room;
    enterRoom(this.machine, room);
  }

  /** Everything that happens before logic 0 gets to run. */
  #beginCycle(): void {
    const { machine } = this;
    const { state } = machine;
    const ego = machine.viewTable.ego;

    machine.resetInstructionBudget();
    this.#advanceClock();

    // The keyboard buffer holds one key for one cycle, so a keypress is seen
    // by exactly one pass of the scripts.
    state.setVar(VAR.KEY_PRESSED, machine.keyboard.takeKey());
    machine.prompt.maxLength = Math.max(1, state.getVar(VAR.MAX_INPUT_LENGTH));

    // Ego's direction lives in two places, and which one is authoritative is
    // exactly what player control means. Under the player, the keyboard leads
    // and the variable follows so scripts can read it; under the program, the
    // variable leads and ego follows.
    if (machine.playerControl) {
      ego.direction = machine.keyboard.direction;
      state.setVar(VAR.EGO_DIRECTION, ego.direction);
    } else {
      ego.direction = state.getVar(VAR.EGO_DIRECTION);
    }

    state.setVar(VAR.EGO_VIEW, ego.view ?? 0);

    // Scripted motions choose their direction before the scripts run, so a
    // script that reads a direction this cycle sees where the object is going.
    checkAllMotions(machine);
  }

  /** Everything that happens once logic 0 has finished. */
  #endCycle(): void {
    const { machine } = this;
    const { state } = machine;

    // A script may have set ego walking; that overrides the keyboard.
    machine.viewTable.ego.direction = state.getVar(VAR.EGO_DIRECTION);

    // Two passes, never one per object: restore what the objects covered, move
    // them, then draw them all again. Interleaving leaves trails where sprites
    // overlap, because one object's restore erases another's fresh pixels.
    eraseObjects(machine);
    cycleObjects(machine);
    updatePositions(machine);
    drawObjects(machine);

    // A room's setup runs on the cycle after it is entered, and only then.
    // Unlike the once-per-cycle flags below, this one is cleared here and not
    // on the new.room path -- a room that was just entered needs it to survive
    // into the next cycle, which is where its setup actually happens.
    state.setFlag(FLAG.NEW_ROOM, false);

    this.#consumeOncePerCycle();
  }

  /**
   * Use up everything that was true for exactly one cycle.
   *
   * A typed line belongs to the cycle that ran after it was entered, and so
   * does a controller. Leaving either set would let the next cycle act on it a
   * second time -- which, for a controller that changes room, means changing
   * room again on every cycle for ever.
   *
   * Called on both ways out of a cycle, the ordinary one and the new.room
   * unwind, because logic 0 has run either way. That matters most for the very
   * first cycle, which the game ends with new.room: clearing these only in
   * {@link Cycle.#endCycle} would leave logic 0's one-time announcements
   * standing into the next cycle, and its first-time block is not something to
   * offer a script twice.
   *
   * Note that this is the *end* of the cycle, not the start. A key pressed
   * between two cycles fires its controller straight away, and clearing at the
   * start of the next cycle would throw it away before any script could test
   * it. Clearing here also lets a menu choice made part-way through a cycle be
   * tested by the rest of that cycle, which is what the game's own logic does
   * immediately after opening its menu.
   */
  #consumeOncePerCycle(): void {
    const { state } = this.machine;

    state.setFlag(FLAG.PLAYER_COMMAND_ENTERED, false);
    this.machine.controllers.clear();

    // Logic 0's first pass, and a restart, are both one-cycle announcements:
    // read on the cycle after the reset, gone by the one after that.
    state.setFlag(FLAG.LOGIC_ZERO_FIRST_TIME, false);
    state.setFlag(FLAG.RESTART_GAME, false);
  }

  /**
   * Move the game clock on by one cycle's worth of time.
   *
   * The clock is not decoration. Scripts pace themselves against it -- the
   * game's own opening waits several seconds between the steps of its
   * introduction -- so a clock that never advances is a game that never starts.
   *
   * Time passes at the rate the game asked to be cycled at, so it stays in step
   * with the scripts rather than with the wall clock.
   */
  #advanceClock(): void {
    const { state } = this.machine;

    this.#ticks += Math.max(1, state.getVar(VAR.CYCLE_DELAY));
    if (this.#ticks < TICKS_PER_SECOND) return;
    this.#ticks -= TICKS_PER_SECOND;

    const seconds = state.getVar(VAR.CLOCK_SECONDS) + 1;
    if (seconds < 60) {
      state.setVar(VAR.CLOCK_SECONDS, seconds);
      return;
    }
    state.setVar(VAR.CLOCK_SECONDS, 0);

    const minutes = state.getVar(VAR.CLOCK_MINUTES) + 1;
    if (minutes < 60) {
      state.setVar(VAR.CLOCK_MINUTES, minutes);
      return;
    }
    state.setVar(VAR.CLOCK_MINUTES, 0);

    const hours = state.getVar(VAR.CLOCK_HOURS) + 1;
    if (hours < 24) {
      state.setVar(VAR.CLOCK_HOURS, hours);
      return;
    }
    state.setVar(VAR.CLOCK_HOURS, 0);
    state.setVar(VAR.CLOCK_DAYS, state.getVar(VAR.CLOCK_DAYS) + 1);
  }

  /**
   * Run whatever cycles are due for the time that has passed.
   *
   * @param elapsedMs time since the last call
   * @returns how many cycles ran
   */
  advance(elapsedMs: number): number {
    const { machine } = this;
    if (machine.stopped) return 0;

    // Sound is aged by real time, before anything else and whether or not a
    // cycle runs: a sound plays on through a window the game is parked on, and
    // the script waiting for it has to be released while it is parked.
    machine.tickSound(elapsedMs);

    // While the game waits for the player, time passes for what it is waiting
    // on -- a window can close itself -- but not for the game. Letting the
    // accumulator run would make it sprint to catch up the moment the window
    // closed.
    if (machine.pending) {
      if (machine.pending.tick(elapsedMs)) machine.dismissPending();
      return 0;
    }

    this.#accumulated += elapsedMs;

    const interval = this.intervalMs;
    let ran = 0;

    while (this.#accumulated >= interval && ran < MAX_CATCH_UP) {
      this.#accumulated -= interval;
      if (!this.runOnce()) break;
      ran++;
    }

    // Whatever could not be caught up is dropped rather than owed, so a long
    // stall does not leave the game permanently sprinting.
    if (this.#accumulated > interval * MAX_CATCH_UP) this.#accumulated = 0;

    return ran;
  }
}
