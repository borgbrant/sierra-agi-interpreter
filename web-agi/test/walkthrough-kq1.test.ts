/**
 * Playing King's Quest I, from the walk-through.
 *
 * The second game, and the one the engine was never written against -- which
 * is what makes playing it worth a test of its own. `test/walk-throughs/kq1.md`
 * is the solution this follows; `kq1.steps.ts` beside it is the same path with
 * the rooms, the standing places and the waits the source does not record.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { VAR } from '../src/engine/state.ts';
import { describe, gameIsBundled, Playthrough, typedLines } from './helpers/playthrough.ts';
import {
  AFTER_THE_BRIDGE,
  AFTER_THE_GIANT,
  AFTER_THE_GNOME,
  AFTER_THE_KING,
  AFTER_THE_TREASURY,
  AFTER_THE_WITCH,
  MAXIMUM,
  REACHED,
  ROOM,
  THE_BEANSTALK,
  THE_FIDDLE,
  THE_GNOME,
  THE_PATH,
  THE_WAY_HOME,
  THE_WELL,
  TO_THE_KING,
} from './walk-throughs/kq1.steps.ts';

const skip = gameIsBundled('kq1') ? false : 'public/games/kq1 is not here';

test('the walk-through gets Graham in to see the king', { skip }, async () => {
  const graham = await Playthrough.open('kq1');

  assert.ok(graham.begin(), 'the title screen gave way to a room that takes input');
  assert.equal(graham.room, ROOM.outsideCastle);
  assert.equal(graham.machine.state.getVar(VAR.MAX_SCORE), MAXIMUM, 'the game the source describes');

  const progress = graham.play(TO_THE_KING);

  assert.equal(progress.step, null, describe(progress));
  assert.equal(graham.room, ROOM.throneRoom);
  assert.equal(graham.score, AFTER_THE_KING, 'the walk-through’s points for steps 2 and 4');
  assert.deepEqual([...graham.machine.stubs.keys()], [], 'commands reached but not implemented');
  assert.equal(graham.machine.stopped, false, 'and the game is still running');
});

/**
 * The long one: the whole walk-through, played.
 *
 * Judged at each place the path has a total worth naming, so that a change
 * which breaks the witch names the witch, rather than saying only that a
 * hundred and fifty-nine became a hundred and fifty-two. Every step in between
 * is judged as it is taken -- {@link Playthrough.play} fails a step that does
 * not pay the points the walk-through says it pays -- so these numbers are the
 * summary, not the whole test.
 */
test('the walk-through plays King’s Quest to the end', { skip }, async () => {
  const graham = await Playthrough.open('kq1');
  assert.ok(graham.begin());

  const at = (act: readonly unknown[]): number => THE_PATH.indexOf(act[0] as never);
  const throughTheWitch = at(THE_FIDDLE);
  const throughTheBridge = at(THE_GNOME);
  const throughTheGnome = at(THE_WELL);
  const throughTheTreasury = at(THE_BEANSTALK);
  const throughTheMountain = at(THE_WAY_HOME);

  let progress = graham.play(THE_PATH.slice(0, throughTheWitch));
  assert.equal(progress.step, null, describe(progress));
  assert.equal(graham.room, ROOM.gingerbreadHouse, 'out of the witch’s house again');
  assert.equal(graham.score, AFTER_THE_WITCH, 'the walk-through’s total through step 38');

  progress = graham.play(THE_PATH.slice(throughTheWitch, throughTheBridge));
  assert.equal(progress.step, null, describe(progress));
  assert.equal(graham.room, ROOM.bridge, 'at the bridge, with the troll in the stream');
  assert.equal(graham.score, AFTER_THE_BRIDGE, 'the walk-through’s total through step 51');

  progress = graham.play(THE_PATH.slice(throughTheBridge, throughTheGnome));
  assert.equal(progress.step, null, describe(progress));
  assert.equal(graham.room, ROOM.gnome, 'in the gnome’s clearing, with his beans');
  assert.equal(graham.score, AFTER_THE_GNOME, 'the walk-through’s total through step 54');

  // The well, the dragon, the condor, the rat and the treasury: rows 65 to 91,
  // played here rather than after the clouds so that the giant is met with the
  // magic shield in hand. `kq1.steps.ts` says why.
  progress = graham.play(THE_PATH.slice(throughTheGnome, throughTheTreasury));
  assert.equal(progress.step, null, describe(progress));
  assert.equal(graham.room, ROOM.mossyRock, 'out of the caverns through the small hole');
  assert.equal(graham.score, AFTER_THE_TREASURY, 'the walk-through’s total through step 91');

  progress = graham.play(THE_PATH.slice(throughTheTreasury, throughTheMountain));
  assert.equal(progress.step, null, describe(progress));
  assert.equal(graham.room, ROOM.lockedDoor, 'down the mountain and out of it');
  assert.equal(graham.score, AFTER_THE_GIANT, 'the walk-through’s total through step 64');

  progress = graham.play(THE_PATH.slice(throughTheMountain));
  assert.equal(progress.step, null, describe(progress));
  assert.equal(graham.room, ROOM.throneRoom, 'back in front of King Edward');
  // One more than the maximum the game states for itself, which is the game's
  // arithmetic and not the walk-through's -- see `REACHED`.
  assert.equal(graham.score, REACHED, 'every point the walk-through’s path pays');
  assert.equal(graham.score, MAXIMUM + 1, 'and one past what logic 0 calls full marks');
  assert.deepEqual([...graham.machine.stubs.keys()], [], 'commands reached but not implemented');
  assert.equal(graham.machine.stopped, false, 'and the game is still running');
});

test('the game understands every line the walk-through types', { skip }, async () => {
  const graham = await Playthrough.open('kq1');
  assert.ok(graham.begin());

  const lines = typedLines('kq1.md');
  assert.equal(lines.length, 56, 'every typed line of the table');

  const unrecognised: string[] = [];
  for (const line of lines) {
    graham.type(line);
    graham.run(2);
    if (graham.machine.state.getVar(VAR.UNKNOWN_WORD) !== 0) unrecognised.push(line);
  }

  // Including the gnome's name. The walk-through supposes it has to be carried
  // through the parser as an unknown token; it does not -- King's Quest keeps
  // `ifnkovhgroghprm` in WORDS.TOK, and `nikstlitselpmur` beside it.
  assert.deepEqual(unrecognised, [], 'every word of every line is in the game');
});
