/**
 * Playing Leisure Suit Larry, from the walk-through.
 *
 * `test/walk-throughs/lsl1.md` is a distilled solution: every line the player
 * types and the points it pays. This runs it -- not a unit test of a command
 * but the game itself, played from the age questions to the ending and judged
 * by the score its own scripts keep.
 *
 * What the walk-through cannot supply is in `lsl1.steps.ts` beside it: the
 * rooms, and the way between them. Where in a room a line has to be typed is
 * supplied by nobody -- the harness walks about until the game answers, which
 * is what a player does, and where that is not enough the steps file names the
 * `posn` box the script itself tests and says so.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Machine } from '../src/engine/machine.ts';
import { VAR } from '../src/engine/state.ts';
import { describe, gameIsBundled, Playthrough, type Step, typedLines } from './helpers/playthrough.ts';
import * as steps from './walk-throughs/lsl1.steps.ts';

const skip = gameIsBundled('lsl1') ? false : 'public/games/lsl1 is not here';

/**
 * Getting past the opening, which is not part of the walk-through.
 *
 * The age question is answered honestly. The copy-protection questions after
 * it are answered from the script's own expectation -- variable 93 holds the
 * right choice as 1 to 4, and the script reads the keypress as the character
 * minus 96 -- which is what a player with the game's box in front of them
 * knows.
 */
export const opening = (machine: Machine): string =>
  machine.pending
    ? '30'
    : String.fromCharCode(96 + Math.min(4, Math.max(1, machine.state.getVar(93))));

/**
 * The walk-through in the order it is played, and what each act ends on.
 *
 * The totals are the source's own running totals, re-derived against the game
 * rather than copied: `lsl1.md` warns that its table does not add up, and two
 * of these are where that shows.
 */
const ACTS: readonly [name: string, steps: readonly Step[], total: number][] = [
  ["Lefty's", steps.LEFTYS, steps.AFTER_LEFTYS],
  ['the cab across town', steps.TO_THE_STORE, steps.AFTER_THE_CAB],
  ['the telephone survey', steps.THE_PAY_PHONE, steps.AFTER_THE_PHONE],
  ['the convenience store', steps.THE_STORE, steps.AFTER_THE_STORE],
  ["the pimp's television", steps.TO_THE_PIMP, steps.AFTER_THE_PIMP],
  ['the hooker and the alley', steps.THE_HOOKER, steps.AFTER_THE_HOOKER],
  ['the man with the apples', steps.TO_THE_CASINO, steps.AFTER_TO_THE_CASINO],
  ['the casino', steps.THE_CASINO, steps.AFTER_THE_CASINO],
  ['the magazine and the call to Sierra', steps.THE_MAGAZINE, steps.AFTER_THE_MAGAZINE],
  ['the disco', steps.THE_DISCO, steps.AFTER_THE_DISCO],
  ['the wedding', steps.THE_WEDDING, steps.AFTER_THE_WEDDING],
  ['the honeymoon suite', steps.THE_HONEYMOON_SUITE, steps.AFTER_THE_HONEYMOON_SUITE],
  ['the wine', steps.THE_WINE, steps.AFTER_THE_WINE],
  ['the honeymoon', steps.THE_HONEYMOON, steps.AFTER_THE_HONEYMOON],
  ['the Spanish Fly', steps.THE_SPANISH_FLY, steps.AFTER_THE_SPANISH_FLY],
  ['the penthouse', steps.THE_PENTHOUSE, steps.AFTER_THE_PENTHOUSE],
  ['Eve, and the ending', steps.THE_END, steps.AFTER_THE_END],
];

test('the walk-through plays the game through to its ending', { skip }, async () => {
  const larry = await Playthrough.open('lsl1');

  assert.ok(larry.begin({ answer: opening }), 'the opening reached a room that takes input');
  assert.equal(larry.room, steps.ROOM.street, 'and it is the street outside Lefty’s');
  assert.ok(larry.machine.state.getVar(VAR.MAX_SCORE) > 0, 'the game keeps a score');

  // Act by act, because a playthrough judged only at the end says "the score
  // is wrong" and nothing about which of a hundred and sixty steps went wrong.
  for (const [name, act, total] of ACTS) {
    const progress = larry.play(act);
    assert.equal(progress.step, null, `${name}: ${describe(progress)}`);
    assert.equal(larry.score, total, `${name}: the walk-through’s running total`);
  }

  assert.equal(larry.score, steps.AFTER_THE_END, 'the whole game, 222 points');
  assert.deepEqual([...larry.machine.stubs.keys()], [], 'commands reached but not implemented');
});

/**
 * The four lines of the walk-through that are not words.
 *
 * Telephone numbers and a bet, which the walk-through's own notes name: they
 * are punctuation the tokeniser has to carry through to the scripts rather
 * than words to look up, and the game answers them all the same.
 */
const NOT_WORDS = new Set(['555-6969', '555-8039', '209-6836858', '20']);

test('the game understands every line the walk-through types', { skip }, async () => {
  // Read out of the markdown, so this covers all 161 of them in the order the
  // source gives them. What it tests is the parser: a line the game cannot even
  // read is a step no playthrough could reach.
  const larry = await Playthrough.open('lsl1');
  assert.ok(larry.begin({ answer: opening }));

  const lines = typedLines('lsl1.md');
  assert.equal(lines.length, 161, 'the whole table');

  const unrecognised: string[] = [];
  for (const line of lines) {
    larry.type(line);
    larry.run(2);
    if (larry.machine.state.getVar(VAR.UNKNOWN_WORD) !== 0) unrecognised.push(line);
  }

  assert.deepEqual(new Set(unrecognised), NOT_WORDS, 'only the literal numbers are not words');
});
