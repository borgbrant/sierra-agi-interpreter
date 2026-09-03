/**
 * The machine the game's scripts run on.
 *
 * The reserved variables and flags are the interface between the engine and the
 * scripts: the engine writes the current room, ego's position, what the player
 * pressed; the scripts read them and decide what happens. Getting this set
 * right is what makes a game behave rather than merely run, and a wrong slot
 * produces a game that executes without error and does the wrong thing.
 *
 * Every reserved slot therefore has a name, and tests refer to the name. A test
 * that says "the current room is written to the room variable" survives someone
 * discovering the number is wrong; one that says `variables[6]` does not.
 */

/**
 * Loudest the game's own volume control goes.
 *
 * Logic 0 raises VAR.SOUND_VOLUME only while it is under 15, which is where
 * the ceiling comes from -- it is the game's number, not a choice made here.
 */
export const MAX_SOUND_VOLUME = 15;

/** Variables the interpreter reserves for itself. Scripts may read all of them. */
export const VAR = {
  CURRENT_ROOM: 0,
  PREVIOUS_ROOM: 1,
  /** Which screen edge ego touched: 0 none, 1 top/horizon, 2 right, 3 bottom, 4 left. */
  EGO_EDGE_TOUCHED: 2,
  SCORE: 3,
  /** Number of the object, other than ego, that touched an edge. */
  OBJECT_TOUCHING_EDGE: 4,
  OBJECT_EDGE_TOUCHED: 5,
  /** Ego's direction of travel, 0 for stationary, 1-8 clockwise from north. */
  EGO_DIRECTION: 6,
  MAX_SCORE: 7,
  FREE_MEMORY_PAGES: 8,
  /** Position of the first word of player input that is not in the vocabulary. */
  UNKNOWN_WORD: 9,
  /** Delay between cycles, in twentieths of a second. */
  CYCLE_DELAY: 10,
  CLOCK_SECONDS: 11,
  CLOCK_MINUTES: 12,
  CLOCK_HOURS: 13,
  CLOCK_DAYS: 14,
  JOYSTICK_SENSITIVITY: 15,
  EGO_VIEW: 16,
  ERROR_CODE: 17,
  ERROR_INFO: 18,
  KEY_PRESSED: 19,
  /** 0 for an IBM PC. */
  COMPUTER_TYPE: 20,
  /** When non-zero, windows close on their own after half this many seconds. */
  WINDOW_CLOSE_DELAY: 21,
  /** 1 for PC speaker, 3 for Tandy. */
  SOUND_GENERATOR: 22,
  SOUND_VOLUME: 23,
  MAX_INPUT_LENGTH: 24,
  /** Item chosen from the status screen, or 0xFF when the player pressed escape. */
  SELECTED_ITEM: 25,
  /** 0 CGA, 2 Hercules, 3 EGA. */
  MONITOR_TYPE: 26,
} as const;

/** The highest variable the interpreter reserves. Above this the game is free. */
export const LAST_RESERVED_VAR = VAR.MONITOR_TYPE;

/** Flags the interpreter reserves for itself. */
export const FLAG = {
  /** Ego's base line stands entirely on water. */
  EGO_ON_WATER: 0,
  /** Ego is completely hidden behind something. */
  EGO_OBSCURED: 1,
  /** The player has entered a command line. */
  PLAYER_COMMAND_ENTERED: 2,
  /** Ego's base line touched a signal line. */
  EGO_TOUCHED_SIGNAL: 3,
  /** A said test has consumed the player's input. */
  SAID_ACCEPTED_INPUT: 4,
  /** Set while a room's script runs for the first time. */
  NEW_ROOM: 5,
  RESTART_GAME: 6,
  SCRIPT_BUFFER_BLOCKED: 7,
  JOYSTICK_SENSITIVITY_ENABLED: 8,
  SOUND_ON: 9,
  DEBUGGER_ENABLED: 10,
  /** Set while logic 0 runs for the first time. */
  LOGIC_ZERO_FIRST_TIME: 11,
  RESTORE_GAME: 12,
  STATUS_SELECTS_ITEMS: 13,
  MENU_ENABLED: 14,
  /** Leave message windows on screen instead of waiting for a key. */
  LEAVE_WINDOW_OPEN: 15,
} as const;

export const LAST_RESERVED_FLAG = FLAG.LEAVE_WINDOW_OPEN;

/** How many strings the interpreter holds, and how long each may be. */
export const STRING_COUNT = 12;
export const STRING_LENGTH = 40;

const VARIABLE_COUNT = 256;
const FLAG_COUNT = 256;

/**
 * Variables, flags and strings, shared by every script in the game.
 *
 * Held as plain data rather than spread across closures, so that saving a game
 * later is a matter of writing it out.
 */
export class GameState {
  /** 8-bit, and they wrap: AGI arithmetic is modulo 256. */
  readonly variables = new Uint8Array(VARIABLE_COUNT);
  readonly flags = new Uint8Array(FLAG_COUNT);
  readonly strings: string[] = new Array(STRING_COUNT).fill('');

  /** Room the game is in. Mirrored into VAR.CURRENT_ROOM. */
  room = 0;

  getVar(index: number): number {
    return this.variables[index] ?? 0;
  }

  setVar(index: number, value: number): void {
    if (index < VARIABLE_COUNT) this.variables[index] = value & 0xff;
  }

  getFlag(index: number): boolean {
    return this.flags[index] === 1;
  }

  setFlag(index: number, value: boolean): void {
    if (index < FLAG_COUNT) this.flags[index] = value ? 1 : 0;
  }

  getString(index: number): string {
    return this.strings[index] ?? '';
  }

  setString(index: number, value: string): void {
    if (index < STRING_COUNT) this.strings[index] = value.slice(0, STRING_LENGTH);
  }

  /** Reset to the state a new game starts from. */
  reset(): void {
    this.variables.fill(0);
    this.flags.fill(0);
    this.strings.fill('');
    this.room = 0;
  }
}
