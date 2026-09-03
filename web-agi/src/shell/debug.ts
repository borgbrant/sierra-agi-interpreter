/**
 * Keyboard access to the views that would otherwise need a debugger.
 *
 * The priority screen is the important one: occlusion and, later, blocking are
 * decided by pixels nobody can see, so being able to look at them is the
 * difference between diagnosing a bug and guessing at it.
 */
import type { Cycle } from '../engine/cycle.ts';
import type { Machine } from '../engine/machine.ts';
import { VAR } from '../engine/state.ts';
import { disassemble } from '../logic/disasm.ts';
import type { ViewObject } from '../engine/viewtable.ts';
import type { Renderer } from '../render/renderer.ts';

/**
 * The key that switches views.
 *
 * A function key rather than a letter: every letter now goes to the game's
 * command line, and a debug toggle that also types is worse than useless.
 */
export const DEBUG_KEY = 'F7';

export interface DebugKeysOptions {
  renderer: Renderer;
  /** Called after a toggle, to repaint. */
  onChange: () => void;
  /** Called with a line describing what changed. */
  onStatus?: (text: string) => void;
}

/**
 * Bind the debug keys.
 *
 * @returns a function that unbinds them
 */
export function bindDebugKeys({ renderer, onChange, onStatus }: DebugKeysOptions): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== DEBUG_KEY) return;
    event.preventDefault();

    const view = renderer.toggleView();
    onChange();
    onStatus?.(view === 'priority' ? 'showing the priority screen' : 'showing the visual screen');
  };

  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}

/** The key that dumps the engine's state. */
export const STATE_KEY = 'F8';

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

/** The key that disassembles the room's script. */
export const DISASM_KEY = 'F9';

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
