/**
 * The page shell stays out of the game's keyboard space.
 *
 * M14 keeps the developer tools, but moves them behind the developer panel and
 * refuses any shortcut the loaded game has already claimed. These tests keep
 * that rule out of the DOM, where it can be checked without a browser.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { KeyBindings } from '../src/engine/menu.ts';
import {
  debugActionForEvent,
  type DebugKeyEvent,
} from '../src/shell/debug.ts';

function event(values: Partial<DebugKeyEvent>): DebugKeyEvent {
  return {
    key: '',
    code: '',
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...values,
  };
}

test('unmodified function keys are not shell debug shortcuts', () => {
  const unclaimed = () => false;

  assert.equal(debugActionForEvent(event({ key: 'F7', code: 'F7' }), unclaimed), null);
  assert.equal(debugActionForEvent(event({ key: 'F8', code: 'F8' }), unclaimed), null);
  assert.equal(debugActionForEvent(event({ key: 'F9', code: 'F9' }), unclaimed), null);
});

test('developer shortcuts require both Alt and Shift', () => {
  const unclaimed = () => false;

  assert.equal(debugActionForEvent(event({ key: 'P', code: 'KeyP', altKey: true }), unclaimed), null);
  assert.equal(debugActionForEvent(event({ key: 'P', code: 'KeyP', shiftKey: true }), unclaimed), null);
  assert.equal(
    debugActionForEvent(event({ key: 'P', code: 'KeyP', altKey: true, shiftKey: true }), unclaimed),
    'priority',
  );
});

test('developer shortcuts are refused when the game has claimed the key', () => {
  const bindings = new KeyBindings();
  bindings.bind(0, 25, 99); // Alt+P: scan code 25, no character.

  const claimed = debugActionForEvent(
    event({ key: 'P', code: 'KeyP', altKey: true, shiftKey: true }),
    (key) => bindings.controllerFor(key) !== undefined,
  );

  assert.equal(claimed, null);
});

test('developer shortcuts map to the three debug actions when unclaimed', () => {
  const unclaimed = () => false;

  assert.equal(
    debugActionForEvent(event({ key: 'P', code: 'KeyP', altKey: true, shiftKey: true }), unclaimed),
    'priority',
  );
  assert.equal(
    debugActionForEvent(event({ key: 'S', code: 'KeyS', altKey: true, shiftKey: true }), unclaimed),
    'state',
  );
  assert.equal(
    debugActionForEvent(event({ key: 'D', code: 'KeyD', altKey: true, shiftKey: true }), unclaimed),
    'disassembly',
  );
});
