import { buildHandlers } from './engine/commands/index.ts';
import { Cycle } from './engine/cycle.ts';
import { Machine } from './engine/machine.ts';
import { VAR } from './engine/state.ts';
import { bindKeyboard } from './input/keyboard.ts';
import { present } from './engine/present.ts';
import { Renderer } from './render/renderer.ts';
import { ResourceManager } from './resources/manager.ts';
import { parseObjectFile } from './resources/objects.ts';
import { BundledSource } from './resources/source.ts';
import { formatSummary, summariseGame } from './resources/summary.ts';
import { Vocabulary } from './resources/words.ts';
import { CanvasView } from './shell/canvas.ts';
import {
  bindDebugKeys,
  describeCurrentLogic,
  describeState,
  DISASM_KEY,
  STATE_KEY,
} from './shell/debug.ts';
import { mountShell } from './shell/shell.ts';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('missing #app element');

const shell = mountShell(root);

try {
  shell.log('loading game files...');

  const source = await BundledSource.load();
  const resources = await ResourceManager.open(source);
  await resources.preload();

  const objectBytes = await source.read('OBJECT');
  const wordBytes = await source.read('WORDS.TOK');
  if (!objectBytes) throw new Error('OBJECT is missing from the bundled game');
  if (!wordBytes) throw new Error('WORDS.TOK is missing from the bundled game');

  const objects = parseObjectFile(objectBytes);
  const vocabulary = Vocabulary.parse(wordBytes);
  const summary = summariseGame(resources, objects, vocabulary);

  const machine = new Machine({ resources, objects, vocabulary });
  machine.setHandlers(buildHandlers());

  const cycle = new Cycle(machine);
  cycle.start(0);

  const canvas = new CanvasView(shell.stage);
  const renderer = new Renderer();

  const paint = () => {
    present(machine, renderer);
    canvas.present(renderer.display);
  };

  bindDebugKeys({ renderer, onChange: paint, onStatus: (text) => shell.setStatus(text) });
  bindKeyboard((key) => {
    // The state dump is bound here rather than with the view toggle because it
    // has to see the cycle as well as the machine.
    if (key.name === STATE_KEY) {
      shell.setLog([
        `--- engine state, ${new Date().toLocaleTimeString()} ---`,
        ...describeState(machine, cycle),
      ]);
      return true;
    }

    if (key.name === DISASM_KEY) {
      shell.setLog(describeCurrentLogic(machine));
      return true;
    }

    const claimed = machine.handleKey(key);
    paint();
    return claimed;
  });

  shell.setLog([
    ...formatSummary(summary),
    '',
    'arrow keys walk ego; type commands and press ENTER',
    'ESC opens the menu, TAB the inventory, and the game\'s own shortcuts work',
    '(Ctrl-B, Alt-Z, F1-F10 and the rest, as its menus advertise)',
    'F7 toggles the priority screen, F8 dumps the engine state below,',
    'F9 disassembles the current room\'s script',
  ]);

  /**
   * Say why the picture stopped moving.
   *
   * A script quitting is a normal thing for a game to do, not a failure -- but
   * on screen it is indistinguishable from the engine having died, so it has to
   * announce itself. The commands the game reached and the engine could not do
   * are listed with it, because one of them is almost always the reason.
   */
  const reportStop = () => {
    const pending = [...machine.stubs].sort((a, b) => b[1] - a[1]).map(([name]) => name);
    const room = machine.state.getVar(VAR.CURRENT_ROOM);

    shell.setStatus(`the game quit, in room ${room}`);
    shell.setLog([
      `The game asked to stop, in room ${room}, after ${cycle.count} cycles.`,
      '',
      'This is the script deciding the game is over, not a crash: the opening',
      'quits if its age question is answered with too low a number, and the',
      'game quits when the player asks it to.',
      '',
      pending.length > 0 ? `Reached but not yet implemented: ${pending.join(', ')}` : '',
      '',
      'Reload the page to start again.',
    ]);
  };

  // Cycles run on their own clock; the display only paints what is there.
  let last = performance.now();

  const frame = (now: number) => {
    const elapsed = now - last;
    last = now;

    try {
      cycle.advance(elapsed);
      // Painting every frame rather than only on a cycle: the player types
      // between cycles, and the line they are typing has to keep up with them.
      paint();
    } catch (cause) {
      shell.showError('The engine stopped', cause);
      return;
    }

    if (machine.stopped) {
      paint();
      reportStop();
      return;
    }

    requestAnimationFrame(frame);
  };

  paint();
  requestAnimationFrame(frame);

  // Report where the game is and what it reached that the engine cannot do yet.
  const status = window.setInterval(() => {
    if (machine.stopped) {
      window.clearInterval(status);
      return;
    }

    const pending = [...machine.stubs].sort((a, b) => b[1] - a[1]);
    const ego = machine.viewTable.ego;
    // The re-entry count is shown because a room that keeps setting itself up
    // is what a looping animation looks like from the inside, and it is the
    // one thing about a stuck game that is worth being able to read off the
    // screen rather than guess at.
    const again = cycle.reentries > 1 ? ` (entered ${cycle.reentries}x)` : '';
    shell.setStatus(
      `room ${machine.state.getVar(VAR.CURRENT_ROOM)}${again}, cycle ${cycle.count}, ` +
        `ego ${ego.x},${ego.y} pri ${ego.priority}` +
        (pending.length > 0 ? ` — ${pending.length} commands not yet implemented` : ''),
    );
  }, 500);
} catch (cause) {
  shell.showError('Could not start the game', cause);
}
