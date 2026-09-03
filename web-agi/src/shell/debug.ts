/**
 * Keyboard access to the views that would otherwise need a debugger.
 *
 * The priority screen is the important one: occlusion and, later, blocking are
 * decided by pixels nobody can see, so being able to look at them is the
 * difference between diagnosing a bug and guessing at it.
 */
import type { Cycle } from '../engine/cycle.ts';
import type { Key } from '../engine/interaction.ts';
import type { Machine } from '../engine/machine.ts';
import { FLAG, VAR } from '../engine/state.ts';
import { keyFromEvent } from '../input/keyboard.ts';
import { disassemble } from '../logic/disasm.ts';
import type { ViewObject } from '../engine/viewtable.ts';

/**
 * Developer shortcuts are active only while the developer panel is open.
 * Buttons are the primary path; these exist for repeated debugging and are
 * checked against the game's own key bindings before the shell claims them.
 */
export type DebugAction = 'priority' | 'state' | 'disassembly';

export interface DebugKeyEvent {
  readonly key: string;
  readonly code: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}

const DEBUG_SHORTCUTS: { action: DebugAction; code: string; label: string; button: string }[] = [
  { action: 'priority', code: 'KeyP', label: 'Alt+Shift+P', button: 'Priority screen' },
  { action: 'state', code: 'KeyS', label: 'Alt+Shift+S', button: 'State dump' },
  { action: 'disassembly', code: 'KeyD', label: 'Alt+Shift+D', button: 'Disassemble room' },
];

export interface DebugActions {
  togglePriority: () => void;
  showState: () => void;
  showDisassembly: () => void;
}

export interface DebugKeysOptions {
  actions: DebugActions;
  /** Debug shortcuts are only live after the developer panel has been opened. */
  isEnabled: () => boolean;
  /** Whether the game has already claimed the key this browser event represents. */
  gameClaimsKey: (key: Key) => boolean;
}

/**
 * Developer buttons. They live behind the panel gesture, so none of them is
 * part of the player's normal surface.
 */
export function createDebugTools(parent: HTMLElement, actions: DebugActions): void {
  for (const shortcut of DEBUG_SHORTCUTS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = shortcut.button;
    button.title = shortcut.label;
    button.addEventListener('click', () => {
      runDebugAction(shortcut.action, actions);
      button.blur();
    });
    parent.append(button);
  }
}

/**
 * Bind optional debug shortcuts.
 *
 * @returns a function that unbinds them
 */
export function bindDebugKeys({ actions, isEnabled, gameClaimsKey }: DebugKeysOptions): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (!isEnabled()) return;

    const action = debugActionForEvent(event, gameClaimsKey);
    if (!action) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    runDebugAction(action, actions);
  };

  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}

/**
 * Which debug action a browser event asks for, if any.
 *
 * Exported so the no-shadowing rule can be tested without a browser.
 */
export function debugActionForEvent(
  event: DebugKeyEvent,
  gameClaimsKey: (key: Key) => boolean,
): DebugAction | null {
  if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return null;

  const shortcut = DEBUG_SHORTCUTS.find((candidate) => candidate.code === event.code);
  if (!shortcut) return null;

  if (gameClaimsKey(keyFromEvent(event as KeyboardEvent))) return null;
  return shortcut.action;
}

function runDebugAction(action: DebugAction, actions: DebugActions): void {
  switch (action) {
    case 'priority':
      actions.togglePriority();
      return;
    case 'state':
      actions.showState();
      return;
    case 'disassembly':
      actions.showDisassembly();
      return;
  }
}

/**
 * Everything about the engine's state that has ever mattered when a game got
 * stuck.
 *
 * Written for reading and pasting rather than for parsing. A game that is
 * misbehaving in a browser is otherwise a screenshot and a description, and
 * the last three defects here all turned on something invisible: which flags a
 * sequence was waiting on, whether an object was still being updated, whether
 * a room was quietly entering itself again.
 *
 * Variables and flags are reported by exception -- only those the game has
 * actually put something in -- because the interesting ones are always the
 * game's own, and which of the 256 those are is not knowable in advance.
 */
export function describeState(machine: Machine, cycle: Cycle): string[] {
  const { state } = machine;
  const lines: string[] = [];

  const waiting = machine.pending
    ? machine.pending.constructor.name
    : machine.window
      ? 'a window left open'
      : 'nothing';

  lines.push(
    `room ${state.getVar(VAR.CURRENT_ROOM)} (entered ${cycle.reentries}x), ` +
      `previous ${state.getVar(VAR.PREVIOUS_ROOM)}, cycle ${cycle.count}, waiting on ${waiting}`,
  );
  lines.push(
    `clock ${state.getVar(VAR.CLOCK_HOURS)}:${state.getVar(VAR.CLOCK_MINUTES)}:` +
      `${state.getVar(VAR.CLOCK_SECONDS)}, delay ${state.getVar(VAR.CYCLE_DELAY)}, ` +
      `player control ${machine.playerControl}, input ${machine.inputAccepted}`,
  );
  lines.push(
    `sound ${machine.sound.isPlaying ? `${Math.round(machine.sound.remainingMs)}ms left` : 'idle'}` +
      `, ${state.getFlag(FLAG.SOUND_ON) ? 'on' : 'off'}` +
      `, volume ${state.getVar(VAR.SOUND_VOLUME)}` +
      `, ${machine.sound.chip} (v${VAR.SOUND_GENERATOR}=${state.getVar(VAR.SOUND_GENERATOR)})`,
  );

  for (const object of machine.viewTable.objects) {
    if (!object.animated && object.view === null) continue;
    lines.push(`  ${describeObject(object)}`);
  }

  const vars: string[] = [];
  for (let i = 0; i < 256; i++) {
    if (state.getVar(i) !== 0) vars.push(`${i}=${state.getVar(i)}`);
  }
  lines.push(`vars: ${vars.join(' ')}`);

  const flags: number[] = [];
  for (let i = 0; i < 256; i++) if (state.getFlag(i)) flags.push(i);
  lines.push(`flags set: ${flags.join(' ')}`);

  const strings = machine.state.strings
    .map((value, index) => (value === '' ? null : `${index}="${value}"`))
    .filter((entry) => entry !== null);
  if (strings.length > 0) lines.push(`strings: ${strings.join(' ')}`);

  const stubs = [...machine.stubs].sort((a, b) => b[1] - a[1]).map(([name, n]) => `${name}x${n}`);
  lines.push(`not implemented, reached: ${stubs.join(' ') || 'none'}`);

  return lines;
}

/** One screen object, in one line. */
function describeObject(object: ViewObject): string {
  const marks = [
    object.animated ? 'animated' : '',
    object.drawn ? 'drawn' : '',
    object.update ? 'update' : '',
    object.cycling ? 'cycling' : '',
    object.fixedLoop ? 'fixed-loop' : '',
    object.fixedPriority ? 'fixed-pri' : '',
    object.ignoresBlocks ? 'ignores-blocks' : '',
    object.ignoresObjects ? 'ignores-objects' : '',
    object.ignoresHorizon ? 'ignores-horizon' : '',
  ].filter((mark) => mark !== '');

  return (
    `obj ${object.number}: view ${object.view ?? '-'} loop ${object.loop}/${object.loopCount} ` +
    `cel ${object.cel}/${object.celCount} at ${object.x},${object.y} pri ${object.priority} ` +
    `dir ${object.direction} step ${object.stepSize}/${object.stepTime} ` +
    `cycle ${CYCLE_NAMES[object.cycleType]} motion ${MOTION_NAMES[object.motion]} ` +
    `[${marks.join(' ')}]`
  );
}

const CYCLE_NAMES = ['normal', 'end-of-loop', 'reverse-loop', 'reverse'] as const;
const MOTION_NAMES = ['normal', 'wander', 'follow-ego', 'move-to'] as const;

/**
 * The current room's script, as readable text.
 *
 * The last resort when a room misbehaves. Reserved variables and flags are
 * where an interpreter runs without error and still does the wrong thing, and
 * no amount of state dumping says what the script was *trying* to do -- only
 * reading it does. Messages are shown inline, because a script's own text is
 * usually the fastest way to recognise which part of it you are looking at.
 *
 * The room's script rather than {@link Machine.currentLogic}: nothing is
 * running between cycles, which is exactly when there is a chance to press a
 * key. By AGI convention room N's script is logic N.
 */
export function describeCurrentLogic(machine: Machine): string[] {
  const room = machine.state.getVar(VAR.CURRENT_ROOM);

  let compiled;
  try {
    compiled = machine.compile(room);
  } catch (cause) {
    return [`logic ${room} could not be read: ${cause instanceof Error ? cause.message : cause}`];
  }

  return [
    `--- logic ${room}, ${compiled.instructions.length} instructions, ` +
      `${compiled.resource.messages.texts.length} messages ---`,
    ...disassemble(compiled.resource),
  ];
}
