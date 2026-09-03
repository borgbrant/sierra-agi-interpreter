import { audioReady } from './audio/context.ts';
import { SoundPlayer } from './audio/player.ts';
import { buildHandlers } from './engine/commands/index.ts';
import { Cycle } from './engine/cycle.ts';
import { Machine } from './engine/machine.ts';
import { FLAG, VAR } from './engine/state.ts';
import { bindKeyboard } from './input/keyboard.ts';
import { present } from './engine/present.ts';
import { Renderer } from './render/renderer.ts';
import { fingerprint } from './engine/snapshot.ts';
import { ResourceManager } from './resources/manager.ts';
import { browserStorage, exportSaves, importSaves, SaveStore } from './storage/saves.ts';
import { parseObjectFile } from './resources/objects.ts';
import { BundledSource } from './resources/source.ts';
import { formatSummary, summariseGame } from './resources/summary.ts';
import { Vocabulary } from './resources/words.ts';
import { CanvasView } from './shell/canvas.ts';
import { Controls } from './shell/controls.ts';
import { loadSettings, saveSettings } from './shell/settings.ts';
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

  const sound = new SoundPlayer();
  const machine = new Machine({ resources, objects, vocabulary, sound });
  machine.setHandlers(buildHandlers());

  // Saved games live in the browser, keyed by which game they belong to. A
  // browser that refuses storage leaves the store empty rather than absent, so
  // the save screen can say so instead of the command silently doing nothing.
  const storage = browserStorage();
  machine.saves = new SaveStore(fingerprint(machine), storage);

  const cycle = new Cycle(machine);

  const canvas = new CanvasView(shell.stage);

  /**
   * Say something to the player, and let them read it.
   *
   * The status line otherwise reports where the game is twice a second, which
   * would wipe a message before anyone could see it.
   */
  let statusHeldUntil = 0;
  const say = (text: string) => {
    shell.setStatus(text);
    statusHeldUntil = Date.now() + 4000;
  };

  /**
   * What the player has chosen, as opposed to what the game asks for.
   *
   * Read back from the browser before the game starts, so the machine the game
   * runs on is settled before its first cycle -- the same reason the audio
   * context is waited for.
   */
  const settings = loadSettings(storage);
  machine.setSoundChip(settings.sound);

  // The renderer is built after the settings are read, so the first frame is
  // drawn on the adapter the player chose rather than on EGA and then swapped.
  const renderer = new Renderer(settings.graphics);

  const controls = new Controls(shell.tools, {
    settings,
    onChange: (chosen) => {
      machine.setSoundChip(chosen.sound);
      // A driver keeps nothing between frames, so a mode can change mid-room:
      // the next frame is repainted in full on the new one.
      if (renderer.setMode(chosen.graphics)) paint();
      saveSettings(storage, chosen);
    },
    isSoundOn: () => machine.state.getFlag(FLAG.SOUND_ON),
    // The same flag the game's own F2 and Options menu set, so the two agree
    // rather than each keeping their own idea of whether sound is on.
    toggleSound: () => {
      machine.state.setFlag(FLAG.SOUND_ON, !machine.state.getFlag(FLAG.SOUND_ON));
      machine.tickSound(0);
    },
    say,
  });

  const paint = () => {
    present(machine, renderer);
    canvas.present(renderer.driver);
    controls.refresh();
  };

  bindDebugKeys({ renderer, onChange: paint, onStatus: say });
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
    'sound starts off: press F2 or the Sound button to switch it on',
    storage
      ? 'F5 saves the game and F7 restores it, as the game\'s own menus say'
      : 'this browser will not let the game save; F5 and F7 will say so',
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

  /**
   * Saves as a file, so they survive the browser clearing its site data.
   *
   * The two buttons live in the shell rather than on a key, because every key
   * worth having is one the game has already bound.
   */
  const addTool = (label: string, onClick: () => void) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', onClick);
    // The game keeps the keyboard: a button left focused would swallow the
    // next keypress instead of walking ego.
    button.addEventListener('click', () => button.blur());
    shell.tools.append(button);
  };

  addTool('Export saves', () => {
    const saves = machine.saves;
    if (!saves || saves.list().length === 0) {
      say('there are no saved games to export');
      return;
    }

    const blob = new Blob([exportSaves(saves)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'web-agi-saves.json';
    link.click();
    URL.revokeObjectURL(url);
    say(`exported ${saves.list().length} saved game(s)`);
  });

  addTool('Import saves', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file || !machine.saves) return;

      try {
        const count = importSaves(machine.saves, await file.text());
        say(`imported ${count} saved game(s); press F7 to restore one`);
      } catch (cause) {
        shell.showError('Those saves could not be imported', cause);
      }
    });
    input.click();
  });

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

  cycle.start(0);

  // The game starts with its sound off, because no browser will let a page make
  // a noise before it has been touched and a game that says "Sound:on" while
  // playing nothing is worse than one that says what it is doing. The game's own
  // start-up script switches sound on during the first cycle, so this waits for
  // that cycle rather than racing it.
  cycle.runOnce();
  machine.state.setFlag(FLAG.SOUND_ON, false);
  say('sound is off — press F2, or the Sound button, to switch it on');

  // Not waited for: the first key or click builds the audio, and whatever is
  // playing by then is handed over at the point it has reached.
  void audioReady().then((output) => {
    if (output) sound.setOutput(output);
  });

  paint();
  requestAnimationFrame(frame);

  // Report where the game is and what it reached that the engine cannot do yet.
  const status = window.setInterval(() => {
    if (machine.stopped) {
      window.clearInterval(status);
      return;
    }

    // Whatever was said last stays up long enough to be read.
    if (Date.now() < statusHeldUntil) return;

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
