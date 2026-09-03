/**
 * Arithmetic, flags, strings, control flow and resource loading.
 *
 * These are implemented first because they need nothing else: everything the
 * rest of the engine does eventually reduces to setting a variable or a flag.
 *
 * AGI variables are 8-bit. Increment and decrement clamp rather than wrap, so a
 * counter parked at 255 stays there instead of falling back to zero.
 */
import type { Handler, Machine } from '../machine.ts';

const clamp = (value: number) => Math.max(0, Math.min(255, value));

/** Most graphics commands name a variable holding the resource number. */
const resourceOf = (m: Machine, variable: number) => m.state.getVar(variable);

export const CORE: Record<string, Handler> = {
  // --- variables ---------------------------------------------------------
  increment: (m, [v]) => m.state.setVar(v!, clamp(m.state.getVar(v!) + 1)),
  decrement: (m, [v]) => m.state.setVar(v!, clamp(m.state.getVar(v!) - 1)),
  assignn: (m, [v, n]) => m.state.setVar(v!, n!),
  assignv: (m, [a, b]) => m.state.setVar(a!, m.state.getVar(b!)),
  addn: (m, [v, n]) => m.state.setVar(v!, m.state.getVar(v!) + n!),
  addv: (m, [a, b]) => m.state.setVar(a!, m.state.getVar(a!) + m.state.getVar(b!)),
  subn: (m, [v, n]) => m.state.setVar(v!, m.state.getVar(v!) - n!),
  subv: (m, [a, b]) => m.state.setVar(a!, m.state.getVar(a!) - m.state.getVar(b!)),
  'mul.n': (m, [v, n]) => m.state.setVar(v!, m.state.getVar(v!) * n!),
  'mul.v': (m, [a, b]) => m.state.setVar(a!, m.state.getVar(a!) * m.state.getVar(b!)),
  'div.n': (m, [v, n]) => m.state.setVar(v!, n! === 0 ? 0 : Math.floor(m.state.getVar(v!) / n!)),
  'div.v': (m, [a, b]) => {
    const divisor = m.state.getVar(b!);
    m.state.setVar(a!, divisor === 0 ? 0 : Math.floor(m.state.getVar(a!) / divisor));
  },

  // Indirection: the variable named by a variable.
  lindirectv: (m, [a, b]) => m.state.setVar(m.state.getVar(a!), m.state.getVar(b!)),
  lindirectn: (m, [a, n]) => m.state.setVar(m.state.getVar(a!), n!),
  rindirect: (m, [a, b]) => m.state.setVar(a!, m.state.getVar(m.state.getVar(b!))),

  // --- flags -------------------------------------------------------------
  set: (m, [f]) => m.state.setFlag(f!, true),
  reset: (m, [f]) => m.state.setFlag(f!, false),
  toggle: (m, [f]) => m.state.setFlag(f!, !m.state.getFlag(f!)),
  'set.v': (m, [v]) => m.state.setFlag(m.state.getVar(v!), true),
  'reset.v': (m, [v]) => m.state.setFlag(m.state.getVar(v!), false),
  'toggle.v': (m, [v]) => {
    const flag = m.state.getVar(v!);
    m.state.setFlag(flag, !m.state.getFlag(flag));
  },

  // --- strings -----------------------------------------------------------
  'set.string': (m, [index, message]) => {
    // Messages belong to the script that is running, not to the game.
    m.state.setString(index!, m.message(message!) ?? '');
  },

  // --- control flow ------------------------------------------------------
  'new.room': (m, [room]) => m.newRoom(room!),
  'new.room.v': (m, [v]) => m.newRoom(m.state.getVar(v!)),
  call: (m, [id]) => m.execute(id!),
  'call.v': (m, [v]) => m.execute(m.state.getVar(v!)),
  quit: (m) => m.quit(),

  // --- resources ---------------------------------------------------------
  // Loading is a no-op with a preloaded game: every resource is already in
  // memory. The commands still exist so scripts sequence normally.
  'load.logics': () => {},
  'load.logics.v': () => {},
  'load.view': () => {},
  'load.view.v': () => {},
  'discard.view': () => {},
  'load.sound': () => {},

  // --- sound -------------------------------------------------------------
  // A script that starts a sound waits on the flag the sound sets when it is
  // over, so every way a sound can end has to set it -- finishing, being cut
  // off by the next sound, and being stopped. The machine owns that rule.
  sound: (m, [id, flag]) => m.playSound(id!, flag!),
  'stop.sound': (m) => m.stopSound(),

  // --- odds and ends -----------------------------------------------------
  random: (m, [low, high, v]) => {
    const min = low!;
    const span = Math.max(1, high! - min + 1);
    m.state.setVar(v!, min + Math.floor(Math.random() * span));
  },
  'set.horizon': (m, [y]) => {
    m.horizon = y!;
  },
  'prevent.input': (m) => {
    m.inputAccepted = false;
  },
  'accept.input': (m) => {
    m.inputAccepted = true;
  },
};

export { resourceOf };
