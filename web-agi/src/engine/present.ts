/**
 * Composing a frame.
 *
 * The order here is the whole of AGI's layering, and getting it wrong is how
 * text ends up behind the picture or a window ends up behind the thing it is
 * asking about:
 *
 * ```text
 * 1  the picture, with the objects already composited into it
 * 2  text written into cells, which the picture shows through
 * 3  the status line and the command line, which the engine owns -- on the
 *    rows the game asked for, not on rows this module decided
 * 4  a window a script left open
 * 5  whatever the game is waiting for, which is always on top
 * ```
 *
 * Nothing here writes to the game's own screens. Text is an overlay on the way
 * to the display, so a window closing reveals the scene underneath without the
 * picture having to be drawn again -- and so the engine's own tests can hash
 * the screens without the score getting into the hash.
 */
import { Frame } from '../render/frame.ts';
import type { Renderer, ScreenView } from '../render/renderer.ts';
import { COLUMNS } from '../render/text.ts';
import { PICTURE_ROW } from './layout.ts';
import { DEFAULT_PROMPT } from '../input/prompt.ts';
import type { Machine } from './machine.ts';
import { FLAG, PROMPT_STRING, VAR } from './state.ts';

/** What shows outside the picture, where nothing else has been drawn. */
const CHROME_COLOUR = 0;

/** Colours the status line is drawn in: black on white, as the original. */
const STATUS_FOREGROUND = 0;
const STATUS_BACKGROUND = 15;

/**
 * The status line's text.
 *
 * The engine writes this, not the game: scripts keep the score in reserved
 * variables and expect the interpreter to show it.
 *
 * Padded to the full width of the screen, because the status line is a bar
 * rather than a caption -- text alone leaves the cells past the last character
 * unwritten, and an unwritten cell shows whatever is behind it.
 */
export function statusLine(machine: Machine): string {
  const score = machine.state.getVar(VAR.SCORE);
  const max = machine.state.getVar(VAR.MAX_SCORE);
  const sound = machine.state.getFlag(FLAG.SOUND_ON) ? 'on' : 'off';
  const line = ` Score:${score} of ${max}`.padEnd(30) + `Sound:${sound}`;
  return line.padEnd(COLUMNS).slice(0, COLUMNS);
}

/**
 * Describe everything the player should see.
 *
 * The result is a {@link Frame} -- cells, screens and windows -- rather than
 * pixels. Which is the point: this module decides the order things are drawn
 * in, and the display driver decides what they look like.
 *
 * @param machine the game
 * @param view    which of the two screens to show
 */
export function buildFrame(machine: Machine, view: ScreenView = 'visual'): Frame {
  const frame = new Frame();

  if (machine.textMode) {
    frame.fill(machine.textBackground);
  } else {
    // Black behind the status line and the input area. The text layer draws
    // over both; this is what shows where it has written nothing.
    frame.fill(CHROME_COLOUR);
    frame.picture(
      view === 'visual' ? machine.screens.visual : machine.screens.priority,
      PICTURE_ROW,
    );
  }

  frame.cells(machine.textLayer);

  if (machine.statusLineVisible) {
    frame.text(
      statusLine(machine),
      0,
      machine.layout.statusRow,
      STATUS_FOREGROUND,
      STATUS_BACKGROUND,
    );
  }

  // The command line is only offered when the game is actually listening, and
  // never while it is waiting for something else. A script that has written on
  // the input row means to be there -- the game's own multiple-choice
  // questions put their instructions exactly there -- so the line yields to it
  // rather than covering it up.
  //
  // A display whose picture reaches the bottom of the screen has no row to
  // offer -- Hercules, where the grid's rows 1 to 24 are all picture. There the
  // command line is a box that opens when the player starts typing, and it is
  // an interaction rather than a layer, so it arrives with `machine.pending`
  // below and nothing is drawn here.
  if (
    !machine.commandLineIsBox &&
    machine.inputAccepted &&
    machine.prompt.visible &&
    !machine.pending &&
    machine.textLayer.rowIsEmpty(machine.layout.inputRow)
  ) {
    // The marker the line starts with is string 0, which is where AGI keeps it
    // and where this game writes its `]`.
    const marker = machine.state.getString(PROMPT_STRING) || DEFAULT_PROMPT;
    frame.text(
      machine.prompt.render(marker).padEnd(COLUMNS),
      0,
      machine.layout.inputRow,
      15,
      0,
    );
  }

  if (machine.window) frame.window(machine.window);
  machine.pending?.draw(frame, machine);

  return frame;
}

/**
 * Draw everything the player should see.
 *
 * @param machine  the game
 * @param renderer where it is drawn
 */
export function present(machine: Machine, renderer: Renderer): void {
  // The one fact that crosses the seam towards the display, and the only one:
  // the game's own "Graphics Mode <Ctrl-R>" sets the monitor variable to mono,
  // and on a CGA the original answered that by putting the card into 640x200 in
  // two colours. Read here rather than pushed by `toggle.monitor` so that a
  // restored save arrives in the right mode too -- the variable is the fact.
  renderer.setMonochrome(machine.monochrome);
  renderer.render(buildFrame(machine, renderer.view));
}
