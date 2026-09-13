/**
 * A game's LOGIC resources as readable text.
 *
 * The engine can disassemble bytecode already -- `src/logic/disasm.ts`, which
 * the debug overlay's F9 uses -- but a disassembly on its own is nearly
 * unreadable, because every `said(...)` comes out as the word *numbers* the
 * parser compares against. So this joins the two halves the interpreter keeps
 * apart: the bytecode, and WORDS.TOK. `said(5, 25)` becomes `said(acquire,
 * dagger)`, and a room's script can be read.
 *
 * What it is for is answering questions about a game that no walk-through
 * records: which room is which number, where in a room a line has to be said
 * from, what a step actually pays, which flag means what. The walk-through
 * tests in `test/walk-throughs/` were written against its output.
 *
 * Two things to know before reading what it prints.
 *
 * The `if` is not what it looks like. `if (C) goto N` is the condition as the
 * bytecode stores it, and AGI's rule is that a *true* condition falls through
 * into the block while a false one jumps to N. So the line reads "while C, do
 * what follows; otherwise skip to N".
 *
 * Room logics are numbered like rooms. LOGIC 28 is room 28, and `new.room(65)`
 * at the foot of it is the door into room 65.
 *
 * Usage:
 *   node scripts/dump-logic.mjs kq1 28 65      # to stdout
 *   node scripts/dump-logic.mjs kq1            # every logic, to --out
 *   node scripts/dump-logic.mjs kq1 --out .logic/kq1
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { disassemble } from '../src/logic/disasm.ts';
import { parseLogic } from '../src/logic/resource.ts';
import { ResourceManager } from '../src/resources/manager.ts';
import { Vocabulary } from '../src/resources/words.ts';
import { DiskSource } from '../test/helpers/disk-source.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const GAMES = resolve(HERE, '..', 'public', 'games');

const argv = process.argv.slice(2);
const outAt = argv.indexOf('--out');
const out = outAt === -1 ? null : argv[outAt + 1];
const rest = outAt === -1 ? argv : [...argv.slice(0, outAt), ...argv.slice(outAt + 2)];
const [game, ...wanted] = rest;

if (!game) {
  console.error('usage: node scripts/dump-logic.mjs <game> [--out <dir>] [logic numbers...]');
  process.exit(2);
}

/**
 * The spelling to print for a word number.
 *
 * Synonyms share a number, so a group has to be printed as one of them; the
 * first alphabetically is as good as any and is at least stable. The two
 * numbers AGI reserves keep their meaning instead: 0 is a word the parser
 * throws away and 1 is "any word at all".
 */
function spellings(vocabulary) {
  const byNumber = new Map([
    [0, 'ignored'],
    [1, 'ANYWORD'],
  ]);
  for (const entry of vocabulary.entries) {
    if (!byNumber.has(entry.number)) byNumber.set(entry.number, entry.word);
  }
  return byNumber;
}

const source = await DiskSource.open(resolve(GAMES, game));
const resources = await ResourceManager.open(source);
await resources.preload();
const words = spellings(Vocabulary.parse(readFileSync(resolve(GAMES, game, 'WORDS.TOK'))));

/** One logic, disassembled, with its `said` words and its messages. */
function render(id) {
  const logic = parseLogic(resources.loadSync('logic', id));
  const body = disassemble(logic, { messageWidth: 300 })
    .join('\n')
    .replace(/said\(([\d, ]+)\)/g, (_, numbers) =>
      `said(${numbers.split(', ').map((n) => words.get(Number(n)) ?? n).join(', ')})`,
    );
  const messages = logic.messages.texts
    .map((text, number) => (text ? `  #${number} ${JSON.stringify(text)}` : null))
    .filter(Boolean)
    .join('\n');
  return `${body}\n--- messages ---\n${messages}\n`;
}

const ids = wanted.length > 0 ? wanted.map(Number) : resources.ids('logic');

if (!out && wanted.length > 0) {
  for (const id of ids) console.log(`===== LOGIC ${id} =====\n${render(id)}`);
} else {
  const directory = out ?? resolve(HERE, '..', '.logic', game);
  mkdirSync(directory, { recursive: true });
  for (const id of ids) {
    writeFileSync(resolve(directory, `logic.${String(id).padStart(3, '0')}.txt`), render(id));
  }
  console.log(`wrote ${ids.length} logics to ${directory}`);
}
