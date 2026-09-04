import { audioReady } from './audio/context.ts';
import { SoundPlayer } from './audio/player.ts';
import { buildHandlers } from './engine/commands/index.ts';
import { Cycle } from './engine/cycle.ts';
import { Machine } from './engine/machine.ts';
import { FLAG, VAR } from './engine/state.ts';
import { bindKeyboard } from './input/keyboard.ts';
import { present } from './engine/present.ts';
import { Renderer } from './render/renderer.ts';
import { decodeCgaTables, type CgaTables } from './render/cgatables.ts';
import { decodeHgcDither, type HgcDither } from './render/hgcdither.ts';
import { decodeHgcFont, type HgcFont } from './render/hgcfont.ts';
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
  createDebugTools,
  describeCurrentLogic,
  describeState,
} from './shell/debug.ts';
import { mountShell } from './shell/shell.ts';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('missing #app element');

const shell = mountShell(root);

try {
  // What loading is doing, said in the stage the canvas will take. Four
  // megabytes of resources and a first cycle is long enough that a page saying
  // nothing looks like a page that has failed.
  shell.setLoading('reading the game directory');

  const source = await BundledSource.load();
  const resources = await ResourceManager.open(source);
  shell.setLoading('decoding resources');
  await resources.preload();

  const objectBytes = await source.read('OBJECT');
  const wordBytes = await source.read('WORDS.TOK');
  if (!objectBytes) throw new Error('OBJECT is missing from the bundled game');
  if (!wordBytes) throw new Error('WORDS.TOK is missing from the bundled game');

  const objects = parseObjectFile(objectBytes);

  // Hercules brought its own font, and unlike the CGA and EGA font -- which
  // lived in the video BIOS and so has to be carried in the engine -- this one
  // is a file. Optional: a copy of the game without it costs Hercules its
  // letterforms and nothing else, so a failure to read or decode it is
  // reported and shrugged off rather than allowed to stop the game.
  let herculesFont: HgcFont | undefined;
  shell.setLoading('reading the interpreter\u2019s own files');
  try {
    const bytes = await source.read('HGC_FONT');
    if (bytes) herculesFont = decodeHgcFont(bytes);
  } catch (cause) {
    shell.showError('HGC_FONT could not be read; Hercules will draw in the engine\'s font', cause);
  }

  // And its dither table, which is 128 bytes inside the interpreter's own data
  // file. Optional for the same reason and with a smaller consequence: absent,
  // the table LSL1's copy of AGIDATA.OVL holds is used, which is the same
  // table for this game and possibly not for another.
  // And the dither tables, which are interpreter data rather than game data:
  // 128 bytes at 0x1bea are Hercules', and three tables below them are CGA's.
  // Optional for the same reason and with a smaller consequence: absent, the
  // tables LSL1's own copy of AGIDATA.OVL holds are used, which are the right
  // tables for this game and possibly not for another.
  let herculesDither: HgcDither | undefined;
  let cgaTables: CgaTables | undefined;
  try {
    const bytes = await source.read('AGIDATA.OVL');
    if (bytes) {
      herculesDither = decodeHgcDither(bytes);
      cgaTables = decodeCgaTables(bytes);
    }
  } catch (cause) {
    shell.showError('AGIDATA.OVL could not be read; the bundled dither tables will be used', cause);
  }
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

  /** Say what the shell just did, without overwriting it with engine telemetry. */
  const say = (text: string) => shell.setStatus(text);

  /**
   * What the player has chosen, as opposed to what the game asks for.
   *
   * Read back from the browser before the game starts, so the machine the game
   * runs on is settled before its first cycle -- the same reason the audio
   * context is waited for.
   */
  const settings = loadSettings(storage);
  // Both halves of the choice, before the first cycle: the scripts read the
  // monitor and computer types during start-up, and a game told afterwards has
  // already built its menus and bound its keys for the wrong machine.
  machine.setDisplayMode(settings.graphics);
  machine.setSoundChip(settings.sound);

  // The renderer is built after the settings are read, so the first frame is
  // drawn on the adapter the player chose rather than on EGA and then swapped.
  const renderer = new Renderer(settings.graphics, { herculesFont, herculesDither, cgaTables });

  const controls = new Controls(shell.settingsTools, {
    settings,
    onChange: (chosen) => {
      machine.setDisplayMode(chosen.graphics);
      machine.setSoundChip(chosen.sound);
      // A driver keeps nothing between frames, so a mode can change mid-room:
      // the next frame is repainted in full on the new one. What the scripts
      // were told changes with it, but they read it when they lay themselves
      // out -- so a mode switched mid-game shows up in the game's own layout
      // only from the next room, exactly as the original's startup choice did.
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

  const describeEngineStatus = () => {
    const pending = [...machine.stubs].sort((a, b) => b[1] - a[1]);
    const ego = machine.viewTable.ego;
    const again = cycle.reentries > 1 ? ` (entered ${cycle.reentries}x)` : '';
    return (
      `room ${machine.state.getVar(VAR.CURRENT_ROOM)}${again}, cycle ${cycle.count}, ` +
      `ego ${ego.x},${ego.y} pri ${ego.priority}` +
      (pending.length > 0 ? ` — ${pending.length} commands not yet implemented` : '')
    );
  };

  const refreshDeveloperStatus = () => shell.setDeveloperStatus(describeEngineStatus());

  const debugActions = {
    togglePriority: () => {
      const view = renderer.toggleView();
      paint();
      refreshDeveloperStatus();
      say(view === 'priority' ? 'developer: showing the priority screen' : 'developer: showing the visual screen');
    },
    showState: () => {
      shell.setLog([
        `--- engine state, ${new Date().toLocaleTimeString()} ---`,
        ...describeState(machine, cycle),
      ]);
      refreshDeveloperStatus();
    },
    showDisassembly: () => {
      shell.setLog(describeCurrentLogic(machine));
      refreshDeveloperStatus();
    },
  };

  createDebugTools(shell.debugTools, debugActions);
  shell.onDeveloperToggle(() => {
    if (shell.developerOpen) refreshDeveloperStatus();
  });

  bindDebugKeys({
    actions: debugActions,
    isEnabled: () => shell.developerOpen,
    gameClaimsKey: (key) => machine.keyBindings.controllerFor(key) !== undefined,
  });

  bindKeyboard((key) => {
    const claimed = machine.handleKey(key);
    paint();
    return claimed;
  });

  shell.setHelp([
    { keys: ['\u2190', '\u2191', '\u2193', '\u2192'], does: 'walk' },
    { keys: ['Enter'], does: 'do what you typed' },
    { keys: ['Esc'], does: 'menus' },
    { keys: ['Tab'], does: 'inventory' },
    { keys: ['F2'], does: 'sound' },
    ...(storage
      ? [{ keys: ['F5', 'F7'], does: 'save, restore' } as const]
      : []),
    storage
      ? 'The game\u2019s own menus list its other keys.'
      : 'This browser will not let the game save or restore.',
  ]);
  shell.setLog([
    ...formatSummary(summary),
    '',
    'Developer tools: open this panel, or use Alt+Shift+P/S/D while it is open.',
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

    shell.setStatus(`the game stopped in room ${room}`);
    shell.setHelp([
      'The game script stopped the interpreter.',
      'Reload the page to start again.',
    ]);
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
    shell.saveTools.append(button);
  };

  addTool('Export saves', () => {
    const saves = machine.saves;
    if (!saves?.available) {
      say('this browser will not let the game save or export saves');
      return;
    }
    if (saves.list().length === 0) {
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
    if (!machine.saves?.available) {
      say('this browser will not let the game import saves');
      return;
    }

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
  shell.setLoading('starting the interpreter');

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

  // The canvas has a frame on it from here, so the placeholder is in its way.
  shell.clearLoading();
  paint();
  canvas.fit();
  requestAnimationFrame(frame);

  // Report where the game is only on the developer surface.
  const status = window.setInterval(() => {
    if (machine.stopped) {
      window.clearInterval(status);
      return;
    }

    if (shell.developerOpen) refreshDeveloperStatus();
  }, 500);
} catch (cause) {
  shell.showError('Could not start the game', cause);
}
