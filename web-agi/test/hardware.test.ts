/**
 * What the scripts are drawn on.
 *
 * The half of the graphics work that has nothing to do with pixels. The game
 * asks what it is being displayed on in twenty-six places and lays itself out
 * accordingly, and every one of these tests is an observable consequence of an
 * answer -- a menu item that appears, a key that is bound, a line of text the
 * game decides not to print. None of it needs a new palette to see.
 *
 * Everything asserted here was read out of the game's own bytecode first, with
 * the address it was read from in the comment. A test whose expectation came
 * from the documentation rather than from this game would be a test of the
 * documentation.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { SoundChip } from '../src/audio/output.ts';
import { buildHandlers } from '../src/engine/commands/index.ts';
import { Cycle } from '../src/engine/cycle.ts';
import { COMPUTER, MONITOR } from '../src/engine/hardware.ts';
import { DEFAULT_LAYOUT } from '../src/engine/layout.ts';
import { Machine } from '../src/engine/machine.ts';
import { StringQuestion } from '../src/engine/interaction.ts';
import { buildFrame } from '../src/engine/present.ts';
import { applySnapshot, captureSnapshot } from '../src/engine/snapshot.ts';
import { VAR } from '../src/engine/state.ts';
import type { DisplayMode } from '../src/render/drivers/driver.ts';
import { Frame } from '../src/render/frame.ts';
import { ResourceManager } from '../src/resources/manager.ts';
import { parseObjectFile } from '../src/resources/objects.ts';
import { Vocabulary } from '../src/resources/words.ts';
import { DiskSource } from './helpers/disk-source.ts';

const source = await DiskSource.open();
const resources = await ResourceManager.open(source);
await resources.preload();
const objects = parseObjectFile((await source.read('OBJECT'))!);
const vocabulary = Vocabulary.parse((await source.read('WORDS.TOK'))!);

/** A fixed random sequence, so every run takes the same path. */
const FIRST_SEED = 0x2f6e2b1;
let seed = FIRST_SEED;
Math.random = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x80000000;
};

/**
 * A game started on a particular machine.
 *
 * The two choices are made before the first cycle, deliberately: the scripts
 * read both during start-up, and a game told afterwards has already built its
 * menus and bound its keys for a machine it is not on.
 */
function boot(mode: DisplayMode, chip: SoundChip = 'speaker', cycles = 0) {
  seed = FIRST_SEED;

  const machine = new Machine({ resources, objects, vocabulary });
  machine.setHandlers(buildHandlers());
  machine.setDisplayMode(mode);
  machine.setSoundChip(chip);

  const cycle = new Cycle(machine);
  cycle.start(0);
  for (let i = 0; i < cycles; i++) if (!cycle.runOnce()) break;

  return { machine, cycle };
}

/** Every menu item the game has defined, by its text. */
function menuItems(machine: Machine): string[] {
  return machine.menuBar.menus.flatMap((menu) => menu.items.map((item) => item.text.trim()));
}

/** The controller a key fires, or undefined when the game never bound it. */
function controllerFor(machine: Machine, char: string, code: string): number | undefined {
  return machine.keyBindings.controllerFor({ char: char.charCodeAt(0), name: char, code });
}

/** What has been written into a row of the text plane, dots for empty cells. */
function row(machine: Machine, index: number): string {
  let text = '';
  for (let column = 0; column < 40; column++) {
    const code = machine.textLayer.chars[index * 40 + column]!;
    text += code === 0 ? '.' : String.fromCharCode(code);
  }
  return text;
}

// --- configure.screen ------------------------------------------------------

test('the game asks for a screen layout, and gets the one it asks for', () => {
  // Logic 51:29 calls configure.screen(1, 23, 0) once, at start-up, and
  // unconditionally -- not from its mono branch, which is what the plan
  // expected. Starting from a deliberately wrong layout is what proves the
  // command was reached rather than never called: the numbers it asks for are
  // the ones the engine would have assumed anyway.
  const machine = new Machine({ resources, objects, vocabulary });
  machine.setHandlers(buildHandlers());
  machine.layout = { minPrintRow: 9, inputRow: 9, statusRow: 9 };

  const cycle = new Cycle(machine);
  cycle.start(0);
  for (let i = 0; i < 40; i++) if (!cycle.runOnce()) break;

  assert.deepEqual(machine.layout, DEFAULT_LAYOUT);
});

test('the status line and the input line go where the game puts them', () => {
  const { machine } = boot('ega', 'speaker', 120);
  machine.statusLineVisible = true;
  machine.inputAccepted = true;
  machine.prompt.visible = true;
  machine.pending = null;
  // The opening writes its credits across rows 23 and 24, and the command line
  // yields to text a script put there -- which is correct, and would make this
  // test look like a missing input row.
  machine.textLayer.clear();

  const rowsOf = (m: Machine) =>
    buildFrame(m, 'visual')
      .layers.filter((layer) => layer.kind === 'text')
      .map((layer) => layer.row);

  const asAsked = rowsOf(machine);
  assert.ok(asAsked.includes(DEFAULT_LAYOUT.statusRow), 'the status line, where the game put it');
  assert.ok(asAsked.includes(DEFAULT_LAYOUT.inputRow), 'and the input line');

  // Moved somewhere the engine never assumed. Nothing about the frame should
  // remember the old rows: they were constants in three modules, and this is
  // what says they are not any more.
  machine.layout = { minPrintRow: 2, inputRow: 12, statusRow: 4 };
  const moved = rowsOf(machine);

  assert.ok(moved.includes(4), 'the status line followed');
  assert.ok(moved.includes(12), 'and so did the input line');
  assert.ok(!moved.includes(23), 'and row 23 is not written on out of habit');
});

test('a question will not open above the floor the game set', () => {
  // Through an interaction rather than through layOutWindow directly, because
  // the wiring is the part that was missing: a floor nothing reads is a floor
  // that does not exist.
  const { machine } = boot('ega');
  machine.layout = { ...DEFAULT_LAYOUT, minPrintRow: 8 };

  const question = new StringQuestion('name? ', 1, 10, 0, 1);
  const frame = new Frame();
  question.draw(frame, machine);

  const window = frame.layers.find((layer) => layer.kind === 'window');
  assert.ok(window?.kind === 'window');
  assert.equal(window.window.row, 8, 'nudged down to the floor, not over the rows above it');
});

// --- what the machine is ---------------------------------------------------

test('the monitor variable follows the display the player chose', () => {
  assert.equal(boot('ega').machine.state.getVar(VAR.MONITOR_TYPE), MONITOR.EGA);
  assert.equal(boot('cga').machine.state.getVar(VAR.MONITOR_TYPE), MONITOR.CGA);
  assert.equal(boot('hercules').machine.state.getVar(VAR.MONITOR_TYPE), MONITOR.MONO);
});

test('the computer type comes from the sound chip, and nothing else', () => {
  // The PCjr's chip on ordinary graphics is a Tandy 1000, and that is the only
  // machine other than a plain PC the shell can describe. The display has no
  // say: none of the three modes on offer implies a different computer.
  const computer = (mode: DisplayMode, chip: SoundChip) =>
    boot(mode, chip).machine.state.getVar(VAR.COMPUTER_TYPE);

  assert.equal(computer('ega', 'pcjr'), COMPUTER.TANDY);
  assert.equal(computer('cga', 'pcjr'), COMPUTER.TANDY, 'whatever the display is');
  assert.equal(computer('hercules', 'pcjr'), COMPUTER.TANDY);
  assert.equal(computer('ega', 'speaker'), COMPUTER.IBM_PC);
  assert.equal(computer('cga', 'speaker'), COMPUTER.IBM_PC);
});

test('switching the sound chip alone can change the computer type', () => {
  // The two settings meet at the computer type, so neither may be set without
  // the other being reconsidered.
  const { machine } = boot('ega', 'speaker');
  assert.equal(machine.state.getVar(VAR.COMPUTER_TYPE), COMPUTER.IBM_PC);

  machine.setSoundChip('pcjr');
  assert.equal(machine.state.getVar(VAR.COMPUTER_TYPE), COMPUTER.TANDY);

  machine.setSoundChip('speaker');
  assert.equal(machine.state.getVar(VAR.COMPUTER_TYPE), COMPUTER.IBM_PC);
});

// --- what the game does with the answers -----------------------------------

test('only a CGA screen is offered the graphics-mode toggle', () => {
  // Logic 0:89 asks for an IBM PC that is neither mono nor EGA -- which is to
  // say CGA -- and only then adds "Graphics Mode <Ctrl-R>" to its menu. It is
  // the one place the game reads the monitor type for something other than
  // "is this mono", and the only script-visible difference CGA has.
  const hasToggle = (mode: DisplayMode) =>
    menuItems(boot(mode, 'speaker', 40).machine).some((text) => text.startsWith('Graphics Mode'));

  assert.equal(hasToggle('cga'), true);
  assert.equal(hasToggle('ega'), false);
  assert.equal(hasToggle('hercules'), false);
});

test('no machine the shell can describe gets the number keys', () => {
  // Logic 51:307 binds 1-0 to controllers 1-10 for computer type 1 alone -- a
  // PCjr, whose chiclet keyboard had no function keys. The shell cannot offer
  // one, so the branch is unreachable, and this is the test that says so: if a
  // computer choice is ever added, this is what will fail and point at it.
  for (const mode of ['ega', 'cga', 'hercules'] as DisplayMode[]) {
    for (const chip of ['speaker', 'pcjr'] as SoundChip[]) {
      const machine = boot(mode, chip, 40).machine;
      assert.equal(controllerFor(machine, '1', 'Digit1'), undefined, `${mode}/${chip}`);
    }
  }
});

test('a Tandy gets the volume keys, and a PC has none to get', () => {
  // Logic 51:210 binds `=`, `-` and `+` for computer type 2, and logic 0:334
  // acts on their controllers for the same type. A PC speaker has no volume,
  // so the game does not offer to change it. This is the one machine other
  // than a plain PC the shell can describe, so it is the whole of what the
  // computer type does here.
  const tandy = boot('ega', 'pcjr', 40).machine;
  const pc = boot('ega', 'speaker', 40).machine;

  assert.equal(controllerFor(tandy, '+', 'Equal'), 38);
  assert.equal(controllerFor(tandy, '-', 'Minus'), 39);
  assert.equal(controllerFor(pc, '+', 'Equal'), undefined);
  assert.equal(controllerFor(pc, '-', 'Minus'), undefined);
});

test('told it is mono, the game lays its opening out differently', () => {
  // Logic 1:195 prints the development-system credits on rows 23 and 24 when
  // the display is not mono, and skips them when it is. Nothing about the
  // engine's own layout moves: this is the game using the screen differently
  // because of what it was told, which is the whole point of the milestone.
  const colour = boot('ega', 'speaker', 120).machine;
  const mono = boot('hercules', 'speaker', 120).machine;

  assert.match(row(colour, 23), /Adventure Game Development System/);
  assert.match(row(colour, 24), /Sierra On-Line/);

  assert.equal(row(mono, 23).replaceAll('.', '').trim(), '', 'nothing on row 23');
  assert.equal(row(mono, 24).replaceAll('.', '').trim(), '', 'nor on row 24');
});

test('toggle.monitor turns mono on and off again', () => {
  // The game's own Ctrl-R. It flips what the scripts are told, not what the
  // driver draws -- which is exactly the split this milestone is about.
  const { machine } = boot('cga', 'speaker', 40);
  assert.equal(machine.state.getVar(VAR.MONITOR_TYPE), MONITOR.CGA);

  machine.toggleMonitor();
  assert.equal(machine.state.getVar(VAR.MONITOR_TYPE), MONITOR.MONO);

  machine.toggleMonitor();
  assert.equal(machine.state.getVar(VAR.MONITOR_TYPE), MONITOR.CGA, 'back to the chosen display');
});

// --- and it survives a save ------------------------------------------------

test('the screen layout is part of the game, so a save carries it', () => {
  const { machine } = boot('ega', 'speaker', 40);
  machine.layout = { minPrintRow: 3, inputRow: 20, statusRow: 1 };

  const snapshot = captureSnapshot(machine);
  machine.layout = { ...DEFAULT_LAYOUT };
  applySnapshot(machine, snapshot);

  assert.deepEqual(machine.layout, { minPrintRow: 3, inputRow: 20, statusRow: 1 });
});

test('a save written before layouts existed restores as the default', () => {
  // Not a guess: an engine without a layout could not have had one other than
  // the default, so reading the field's absence as the default is a fact about
  // the old format. It is what makes the field addable without a format bump.
  const { machine } = boot('ega', 'speaker', 40);
  const snapshot = captureSnapshot(machine);
  delete snapshot.layout;

  machine.layout = { minPrintRow: 9, inputRow: 9, statusRow: 9 };
  applySnapshot(machine, snapshot);

  assert.deepEqual(machine.layout, DEFAULT_LAYOUT);
});
