/**
 * Changing rooms.
 *
 * `new.room` is not a jump. It tears down what belonged to the old room, moves
 * the room number into the reserved variables, and arranges for the new room's
 * script to run from a fresh cycle. The order matters and is easy to get subtly
 * wrong, so it lives in one place with its own tests.
 */
import { PICTURE_HEIGHT, PICTURE_WIDTH } from '../render/screens.ts';
import { EDGE, noBlock } from './motion.ts';
import { FLAG, VAR } from './state.ts';
import type { Machine } from './machine.ts';

/** Where the horizon sits until a room moves it. */
export const DEFAULT_HORIZON = 36;

/**
 * Enter a room.
 *
 * @param machine the machine to move
 * @param room    the room to enter
 */
export function enterRoom(machine: Machine, room: number): void {
  const { state } = machine;
  const previous = state.room;

  // A room's script is reloaded rather than resumed, so anything it cached
  // about the old room is dropped.
  if (previous !== room) machine.discardLogic(previous);

  state.room = room;
  state.setVar(VAR.PREVIOUS_ROOM, previous);
  state.setVar(VAR.CURRENT_ROOM, room);

  // Every object belongs to the room it was created in, so the table is wiped
  // and the decoded views with it. Ego is the exception: it keeps its view and
  // its position, because it is the thing that walked here.
  machine.viewTable.reset();
  machine.viewTable.discardViews();
  machine.savedAreas.length = 0;
  machine.block = noBlock();
  machine.playerControl = true;
  machine.keyboard.clear();

  // Ego arrives at the opposite edge from the one it left by, which is what
  // makes walking off the side of a screen continue into the next one.
  repositionEgoForEdge(machine, state.getVar(VAR.EGO_EDGE_TOUCHED));

  // Contact information belongs to the room just left.
  state.setVar(VAR.EGO_EDGE_TOUCHED, 0);
  state.setVar(VAR.OBJECT_TOUCHING_EDGE, 0);
  state.setVar(VAR.OBJECT_EDGE_TOUCHED, 0);
  state.setVar(VAR.UNKNOWN_WORD, 0);

  state.setFlag(FLAG.NEW_ROOM, true);
  state.setFlag(FLAG.PLAYER_COMMAND_ENTERED, false);
  state.setFlag(FLAG.SAID_ACCEPTED_INPUT, false);

  machine.horizon = DEFAULT_HORIZON;
  machine.inputAccepted = true;
  machine.pendingRoom = null;
  machine.pictureShown = false;
}

/**
 * Move ego to the far side of the screen it just walked off.
 *
 * The room's own script may override this, and usually does when the exit is
 * not a plain screen edge. Nothing happens when ego did not touch an edge --
 * a room entered by a script keeps ego wherever the script left it.
 *
 * @param edge the edge ego touched in the room it is leaving
 */
export function repositionEgoForEdge(machine: Machine, edge: number): void {
  const ego = machine.viewTable.ego;

  switch (edge) {
    case EDGE.TOP:
      ego.y = PICTURE_HEIGHT - 1;
      break;
    case EDGE.RIGHT:
      ego.x = 0;
      break;
    case EDGE.BOTTOM:
      ego.y = DEFAULT_HORIZON + 1;
      break;
    case EDGE.LEFT:
      ego.x = PICTURE_WIDTH - ego.width;
      break;
    default:
      break;
  }
}
