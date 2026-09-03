import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildHandlers } from '../src/engine/commands/index.ts';
import { Cycle } from '../src/engine/cycle.ts';
import {
  MessageWindow,
  NumberQuestion,
  StringQuestion,
  type Key,
} from '../src/engine/interaction.ts';
import { InventoryScreen } from '../src/engine/inventory.ts';
import { Machine } from '../src/engine/machine.ts';
import { KeyBindings, MenuBar, MenuNavigation } from '../src/engine/menu.ts';
import { FLAG, VAR } from '../src/engine/state.ts';
import { keyFromEvent, keyNamed } from '../src/input/keyboard.ts';
import { Prompt } from '../src/input/prompt.ts';
import { Display } from '../src/render/display.ts';
import { layOutWindow } from '../src/render/text.ts';
import { ResourceManager } from '../src/resources/manager.ts';
import { parseObjectFile } from '../src/resources/objects.ts';
import { Vocabulary } from '../src/resources/words.ts';
import { DiskSource } from './helpers/disk-source.ts';

const source = await DiskSource.open();
const resources = await ResourceManager.open(source);
await resources.preload();
const objects = parseObjectFile((await source.read('OBJECT'))!);
const vocabulary = Vocabulary.parse((await source.read('WORDS.TOK'))!);

function machine(): Machine {
  const m = new Machine({ resources, objects, vocabulary });
  m.setHandlers(buildHandlers());
  return m;
}

const key = (name: string): Key => keyNamed(name);

// --- Message windows -------------------------------------------------------

test('a message window closes on any key', () => {
  const m = machine();
  const window = new MessageWindow(layOutWindow('hello'));
  assert.equal(window.key(m, key('x')), true);
});

test('a window with a close delay closes itself, and one without waits', () => {
  const m = machine();

  const timed = new MessageWindow(layOutWindow('hello'), 4); // four half-seconds
  assert.equal(timed.tick(1000), false, 'not yet');
  assert.equal(timed.tick(1200), true, 'after two seconds');

  const untimed = new MessageWindow(layOutWindow('hello'));
  assert.equal(untimed.tick(100000), false, 'waits however long it takes');
  assert.equal(untimed.key(m, key('Enter')), true);
});

// --- Questions -------------------------------------------------------------

test('a number question takes digits and nothing else', () => {
  const m = machine();
  const question = new NumberQuestion('How old are you? ', 209);

  for (const character of 'a3x0!') question.key(m, key(character));
  assert.equal(question.key(m, key('Enter')), true);

  question.finish(m);
  assert.equal(m.state.getVar(209), 30, 'the letters were ignored');
});

test('a number question with no answer reads as zero', () => {
  const m = machine();
  const question = new NumberQuestion('age? ', 100);
  question.key(m, key('Enter'));
  question.finish(m);
  assert.equal(m.state.getVar(100), 0);
});

test('backspace edits an answer', () => {
  const m = machine();
  const question = new NumberQuestion('age? ', 100);
  for (const character of '123') question.key(m, key(character));
  question.key(m, key('Backspace'));
  question.key(m, key('Enter'));
  question.finish(m);
  assert.equal(m.state.getVar(100), 12);
});

test('a string question writes into the interpreter strings', () => {
  const m = machine();
  const question = new StringQuestion('name? ', 3, 10);
  for (const character of 'Larry') question.key(m, key(character));
  question.key(m, key('Enter'));
  question.finish(m);
  assert.equal(m.state.getString(3), 'Larry');
});

test('a question draws its answer as it is typed', () => {
  const m = machine();
  const display = new Display();
  const question = new StringQuestion('name? ', 3, 10);

  question.key(m, key('L'));
  question.draw(display, m);

  // Something was drawn; the specific pixels are the window's business, but a
  // question that shows nothing back is unusable.
  assert.ok(display.pixels.some((pixel) => pixel !== 0));
});

// --- The command line ------------------------------------------------------

test('the prompt collects a line and hands it over on Enter', () => {
  const prompt = new Prompt();

  for (const character of 'look') assert.equal(prompt.key(character.charCodeAt(0), character), null);
  assert.equal(prompt.render(), ']look_');
  assert.equal(prompt.key(13, 'Enter'), 'look');
  assert.equal(prompt.text, '', 'and starts again empty');
});

test('the marker leads the line and the cursor follows the typing', () => {
  // Two different characters from two different places: the game writes its
  // marker into string 0 and sets the cursor with set.cursor.char. Using one
  // for both is what turned this game's input line into `__`.
  const prompt = new Prompt();
  prompt.cursorChar = '_';

  for (const character of 'get') prompt.key(character.charCodeAt(0), character);

  assert.equal(prompt.render(']'), ']get_');
  assert.equal(prompt.render('>'), '>get_');
});

test('the prompt edits and cancels', () => {
  const prompt = new Prompt();
  for (const character of 'lok') prompt.key(character.charCodeAt(0), character);
  prompt.key(8, 'Backspace');
  assert.equal(prompt.text, 'lo');
  prompt.key(27, 'Escape');
  assert.equal(prompt.text, '', 'escape abandons the line');
});

test('the prompt stops at the length the game allows', () => {
  const prompt = new Prompt();
  prompt.maxLength = 5;
  for (const character of 'abcdefghij') prompt.key(character.charCodeAt(0), character);
  assert.equal(prompt.text, 'abcde');
});

test('typing reaches the command line while the arrows still walk', () => {
  const m = machine();
  m.inputAccepted = true;

  m.handleKey(key('l'));
  m.handleKey(key('ArrowRight'));

  assert.equal(m.prompt.text, 'l', 'the letter was typed');
  assert.equal(m.keyboard.direction, 3, 'and the arrow steered ego');
});

test('every key is recorded as the key just pressed, whatever consumes it', () => {
  // Scripts read the reserved variable directly to offer multiple-choice
  // questions while the command line is still on screen, so a key being typed
  // must also be visible there.
  const m = machine();
  m.inputAccepted = true;
  m.handleKey(key('c'));
  assert.equal(m.keyboard.takeKey(), 'c'.charCodeAt(0));
});

test('a key goes to whatever the game is waiting for, and nowhere else', () => {
  const m = machine();
  m.inputAccepted = true;
  m.pending = new NumberQuestion('age? ', 100);

  m.handleKey(key('7'));
  assert.equal(m.prompt.text, '', 'the command line did not see it');

  m.handleKey(key('Enter'));
  assert.equal(m.pending, null, 'the question ended');
  assert.equal(m.state.getVar(100), 7, 'and wrote its answer');
});

// --- Menus -----------------------------------------------------------------

function bar(): MenuBar {
  const menus = new MenuBar();
  menus.addMenu('File');
  menus.addItem('Save', 5);
  menus.addItem('-----', 24);
  menus.addItem('Quit', 22);
  menus.addMenu('Help');
  menus.addItem('About', 25);
  menus.submit();
  // The game disables its separator lines rather than marking them specially,
  // which is what makes them unreachable; the bar is built the same way here.
  menus.setEnabled(24, false);
  return menus;
}

test('a menu bar is only usable once it has been submitted', () => {
  const menus = new MenuBar();
  menus.addMenu('File');
  menus.addItem('Save', 5);
  assert.equal(menus.isUsable, false, 'still being defined');

  menus.submit();
  assert.equal(menus.isUsable, true);
});

test('choosing an item fires its controller', () => {
  const m = machine();
  const navigation = new MenuNavigation(bar());

  assert.equal(navigation.key(m, key('ArrowDown')), false);
  assert.equal(navigation.key(m, key('Enter')), true);
  navigation.finish(m);

  assert.deepEqual([...m.controllers], [22], 'the separator was skipped');
});

test('escaping the menu chooses nothing', () => {
  const m = machine();
  const navigation = new MenuNavigation(bar());

  assert.equal(navigation.key(m, key('Escape')), true);
  navigation.finish(m);

  assert.equal(navigation.chosen, null);
  assert.equal(m.controllers.size, 0);
});

test('a disabled item cannot be chosen', () => {
  const m = machine();
  const menus = bar();
  menus.setEnabled(5, false); // disable Save, the first item

  const navigation = new MenuNavigation(menus);
  navigation.key(m, key('Enter'));
  navigation.finish(m);

  assert.deepEqual([...m.controllers], [22], 'the cursor started past the disabled item');
});

test('moving between menus resets the item cursor', () => {
  const m = machine();
  const navigation = new MenuNavigation(bar());

  navigation.key(m, key('ArrowRight'));
  navigation.key(m, key('Enter'));
  navigation.finish(m);

  assert.deepEqual([...m.controllers], [25], 'the first item of the second menu');
});

// --- Key bindings ----------------------------------------------------------

test('a bound character and a bound function key both fire their controller', () => {
  const bindings = new KeyBindings();
  bindings.bind('1'.charCodeAt(0), 0, 31); // set.key(49, 0, 31)
  bindings.bind(0, 63, 5); // set.key(0, 63, 5) -- F5

  assert.equal(bindings.controllerFor(key('1')), 31);
  assert.equal(bindings.controllerFor(key('F5')), 5);
  assert.equal(bindings.controllerFor(key('2')), undefined);
});

test('Ctrl and Alt combinations are read the way the PC reported them', () => {
  // A browser event, near enough: only these fields matter.
  const event = (fields: Partial<KeyboardEvent>) => keyFromEvent(fields as KeyboardEvent);

  const ctrlB = event({ key: 'b', code: 'KeyB', ctrlKey: true });
  assert.equal(ctrlB.char, 2, 'Ctrl+B is character 2');
  assert.equal(ctrlB.alt, undefined);

  const altX = event({ key: 'x', code: 'KeyX', altKey: true });
  assert.equal(altX.char, 0, 'Alt+X carries no character at all');
  assert.equal(altX.alt, true);

  // Some browsers report Alt+X as an accented letter, so the physical key is
  // what decides -- otherwise the game's Alt shortcuts stop working on a Mac.
  const altOnMac = event({ key: '≈', code: 'KeyX', altKey: true });
  assert.equal(altOnMac.name, 'X');
});

test('an Alt shortcut fires its controller and a plain letter does not', () => {
  const bindings = new KeyBindings();
  bindings.bind(0, 45, 21); // set.key(0, 45, 21) -- Alt+X

  assert.equal(bindings.controllerFor({ char: 0, name: 'X', code: 'KeyX', alt: true }), 21);
  assert.equal(
    bindings.controllerFor(key('x')),
    undefined,
    'typing x is not the same as pressing Alt+X',
  );
});

test('a Ctrl shortcut fires its controller', () => {
  const bindings = new KeyBindings();
  bindings.bind(2, 0, 41); // set.key(2, 0, 41) -- Ctrl+B, the boss key

  assert.equal(bindings.controllerFor({ char: 2, name: 'B', code: 'KeyB' }), 41);
});

test('a bound key is claimed before the command line sees it', () => {
  const m = machine();
  m.inputAccepted = true;
  m.keyBindings.bind('1'.charCodeAt(0), 0, 31);

  m.handleKey(key('1'));

  assert.deepEqual([...m.controllers], [31]);
  assert.equal(m.prompt.text, '', 'the digit was not typed');
});

// --- The inventory screen --------------------------------------------------

test('the inventory lists what the player is carrying', () => {
  const m = machine();
  m.inventory.take(1);
  m.inventory.take(3);

  const carried = m.inventory.carried().map((item) => item.id);
  assert.deepEqual(carried.includes(1) && carried.includes(3), true);
});

test('a selectable inventory reports the item chosen', () => {
  const m = machine();
  m.state.setFlag(FLAG.STATUS_SELECTS_ITEMS, true);
  const screen = new InventoryScreen([{ id: 4, name: 'Wallet' }, { id: 9, name: 'Lint' }], true);

  screen.key(m, key('ArrowDown'));
  assert.equal(screen.key(m, key('Enter')), true);
  screen.finish(m);

  assert.equal(m.state.getVar(VAR.SELECTED_ITEM), 9);
});

test('escaping the inventory reports no choice, not the first item', () => {
  const m = machine();
  const screen = new InventoryScreen([{ id: 4, name: 'Wallet' }], true);

  screen.key(m, key('Escape'));
  screen.finish(m);

  assert.equal(m.state.getVar(VAR.SELECTED_ITEM), 0xff);
});

test('an inventory that only shows the list reports no choice either', () => {
  const m = machine();
  const screen = new InventoryScreen([{ id: 4, name: 'Wallet' }], false);

  screen.key(m, key('Enter'));
  screen.finish(m);

  assert.equal(m.state.getVar(VAR.SELECTED_ITEM), 0xff);
});

// --- Waiting, as the cycle sees it -----------------------------------------

test('nothing runs while the game waits, and it picks up where it left off', () => {
  const m = machine();
  const cycle = new Cycle(m);
  cycle.start(0);
  cycle.runOnce();

  m.pending = new MessageWindow(layOutWindow('hello'));
  const before = cycle.count;

  assert.equal(cycle.runOnce(), false, 'no cycle ran');
  assert.equal(cycle.advance(10_000), 0, 'and time did not pile up');
  assert.equal(cycle.count, before);

  m.dismissPending();
  assert.equal(cycle.runOnce(), true, 'and it carries on afterwards');
});
