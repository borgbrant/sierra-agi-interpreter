/**
 * Playing King's Quest I, from the walk-through.
 *
 * The second game, and the one the engine was never written against -- which
 * is what makes playing it worth a test of its own. `test/walk-throughs/kq1.md`
 * is the solution this follows; `kq1.steps.ts` beside it is the same path with
 * the rooms and the standing places the source does not record.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { VAR } from '../src/engine/state.ts';
import { describe, gameIsBundled, Playthrough, typedLines } from './helpers/playthrough.ts';
import { AFTER_THE_KING, ROOM, TO_THE_KING } from './walk-throughs/kq1.steps.ts';

const skip = gameIsBundled('kq1') ? false : 'public/games/kq1 is not here';

test('the walk-through gets Graham in to see the king', { skip }, async () => {
  const graham = await Playthrough.open('kq1');

  assert.ok(graham.begin(), 'the title screen gave way to a room that takes input');
  assert.equal(graham.room, ROOM.outsideCastle);
  assert.equal(graham.machine.state.getVar(VAR.MAX_SCORE), 158, 'the game the source describes');

  const progress = graham.play(TO_THE_KING);

  assert.equal(progress.step, null, describe(progress));
  assert.equal(graham.room, ROOM.throneRoom);
  assert.equal(graham.score, AFTER_THE_KING, 'the walk-through’s points for steps 2 and 4');
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
