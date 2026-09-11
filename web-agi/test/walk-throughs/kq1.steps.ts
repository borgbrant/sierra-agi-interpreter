/**
 * `kq1.md` as engine input.
 *
 * The markdown beside this file is the walk-through: the room, the typed line
 * and the points it pays. This is the same path in the form a test can run,
 * and it supplies the two things the source says it does not have -- the AGI
 * room numbers, and where in a room the player has to be standing.
 *
 * The numbers in the comments are the row of the table each step comes from.
 */
import type { Step } from '../helpers/playthrough.ts';

/** Rooms the path visits, against the names the walk-through gives them. */
export const ROOM = {
  outsideCastle: 1,
  castleDoor: 2,
  entranceHall: 55,
  greatHall: 54,
  throneRoom: 53,
} as const;

/**
 * From the first screen to the king. Steps 1 to 5.
 *
 * The doors are worth watching: `open door` is followed by `sound(15,28)` and
 * a script that waits for that sound to end before it moves the player inside.
 * A harness that runs cycles without letting time pass never hears the end of
 * it and the game stops there, which is why {@link Playthrough.run} ages the
 * sound by a cycle's worth of time.
 */
export const TO_THE_KING: readonly Step[] = [
  { go: 'west' }, // 1: west, onto the bridge
  { say: 'open door', points: 1 }, // 2: and the doors carry Graham inside
  { wait: 60 },
  { go: 'north' }, // 3: north, then west along the red carpet
  { go: 'west' },
  { say: 'bow to king', points: 3 }, // 4
  // The throne room answers anything said from outside `posn(0,60,85,86,113)`
  // with "It is proper to stand directly in front of ... King Edward", so the
  // walk-through's "talk to king" is a step about where to stand.
  { walk: [72, 100] },
  { say: 'talk to king' }, // 5
  { wait: 60 },
];

/** The walk-through's own running total once the king has been bowed to. */
export const AFTER_THE_KING = 4;
