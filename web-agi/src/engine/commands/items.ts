/**
 * Inventory, menus and the screens the player opens.
 *
 * The inventory commands are thin -- an item's whereabouts is one number -- but
 * the number matters: 255 means the player is carrying it and 0 means it has
 * left the game. `drop` is therefore not "put it in this room", it is "take it
 * out of play", and a script that wants an item on the floor uses `put`.
 */
import { decodeView } from 'agi-extract/view';

import { InventoryScreen, ObjectCloseUp } from '../inventory.ts';
import type { Handler, Machine } from '../machine.ts';
import { MenuNavigation } from '../menu.ts';
import { formatMessage } from '../message.ts';
import { FLAG } from '../state.ts';

/** Load a VIEW for its own sake, rather than for an animated object. */
function view(m: Machine, id: number) {
  return decodeView(m.resources.loadSync('view', id)) as {
    loops: { cels: { width: number; height: number; pixels: Uint8Array }[] }[];
    description: string | null;
  };
}

/** The close-up of an item, as `show.obj` draws it. */
function closeUp(m: Machine, id: number) {
  try {
    const decoded = view(m, id);
    const cel = decoded.loops[0]?.cels[0];
    const description = decoded.description ?? '';
    return new ObjectCloseUp(cel as never, formatMessage(m, description));
  } catch {
    // A script asking for a view that is not there is worth seeing, but not
    // worth stopping the game for.
    m.stub(`show.obj: view ${id} could not be loaded`);
    return undefined;
  }
}

export const ITEMS: Record<string, Handler> = {
  // --- where things are --------------------------------------------------
  get: (m, [item]) => m.inventory.take(item!),
  'get.v': (m, [v]) => m.inventory.take(m.state.getVar(v!)),
  drop: (m, [item]) => m.inventory.drop(item!),
  put: (m, [item, room]) => m.inventory.setRoom(item!, room!),
  'put.v': (m, [vitem, vroom]) =>
    m.inventory.setRoom(m.state.getVar(vitem!), m.state.getVar(vroom!)),
  'get.room.v': (m, [vitem, vroom]) =>
    m.state.setVar(vroom!, m.inventory.roomOf(m.state.getVar(vitem!))),

  // --- looking at things -------------------------------------------------
  status: (m) =>
    new InventoryScreen(m.inventory.carried(), m.state.getFlag(FLAG.STATUS_SELECTS_ITEMS)),

  'show.obj': (m, [id]) => closeUp(m, id!),
  'show.obj.v': (m, [v]) => closeUp(m, m.state.getVar(v!)),

  // `obj.status.v` is a debugging command in the original; there is nothing
  // for it to report to here, so it is noted rather than pretended.
  'obj.status.v': (m) => m.stub('obj.status.v'),

  // --- menus -------------------------------------------------------------
  'set.menu': (m, [message]) => m.menuBar.addMenu(formatMessage(m, m.message(message!) ?? '')),
  'set.menu.item': (m, [message, controller]) =>
    m.menuBar.addItem(formatMessage(m, m.message(message!) ?? ''), controller!),
  'submit.menu': (m) => m.menuBar.submit(),
  'enable.item': (m, [controller]) => m.menuBar.setEnabled(controller!, true),
  'disable.item': (m, [controller]) => m.menuBar.setEnabled(controller!, false),

  'menu.input': (m) => {
    if (!m.menuBar.isUsable || !m.state.getFlag(FLAG.MENU_ENABLED)) return;
    return new MenuNavigation(m.menuBar);
  },

  'set.key': (m, [char, scanCode, controller]) =>
    m.keyBindings.bind(char!, scanCode!, controller!),

  // --- the game as a whole ------------------------------------------------
  // Saving needs a place to put a game, which is a later phase; the commands
  // are answered rather than ignored so a script that offers them and then
  // checks whether they happened sees a truthful "no".
  'save.game': (m) => m.stub('save.game'),
  'restore.game': (m) => m.stub('restore.game'),
  'restart.game': (m) => m.restart(),
  'init.disk': () => {},

  // Developer commands from the original interpreter. They have no meaning
  // outside it, and doing nothing is the honest implementation.
  'show.mem': () => {},
  version: () => {},
  'script.size': () => {},
  'set.game.id': () => {},
  log: () => {},
  'trace.on': () => {},
  'trace.info': () => {},
  // Not developer commands: this pair is how a script waits for a keypress
  // across cycles. See CompiledLogic.scanStart.
  'set.scan.start': (m) => m.setScanStart(),
  'reset.scan.start': (m) => m.resetScanStart(),
  'init.joy': () => {},
  'toggle.monitor': () => {},
};
