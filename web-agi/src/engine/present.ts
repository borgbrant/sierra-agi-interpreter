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
 * 3  the status line and the command line, which the engine owns
 * 4  a window a script left open
 * 5  whatever the game is waiting for, which is always on top
 * ```
 *
 * Nothing here writes to the game's own screens. Text is an overlay on the way
 * to the display, so a window closing reveals the scene underneath without the
 * picture having to be drawn again -- and so the engine's own tests can hash
 * the screens without the score getting into the hash.
 */
import { Renderer } from '../render/renderer.ts';
import { COLUMNS, drawText, drawWindow, PROMPT_ROW, STATUS_ROW } from '../render/text.ts';
import type { Machine } from './machine.ts';
import { FLAG, VAR } from './state.ts';

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
 * Draw everything the player should see.
 *
 * @param machine  the game
 * @param renderer where it is drawn
 */
export function present(machine: Machine, renderer: Renderer): void {
  if (machine.textMode) {
    renderer.display.fill(machine.textBackground);
  } else {
    renderer.compose(machine.screens);
  }

  machine.textLayer.draw(renderer.display);

  if (machine.statusLineVisible) {
    drawText(
      renderer.display,
      statusLine(machine),
      0,
      STATUS_ROW,
      STATUS_FOREGROUND,
      STATUS_BACKGROUND,
    );
  }

  // The command line is only offered when the game is actually listening, and
  // never while it is waiting for something else. A script that has written on
  // the input row means to be there -- the game's own multiple-choice
  // questions put their instructions exactly there -- so the line yields to it
  // rather than covering it up.
  if (
    machine.inputAccepted &&
    machine.prompt.visible &&
    !machine.pending &&
    machine.textLayer.rowIsEmpty(PROMPT_ROW)
  ) {
    drawText(renderer.display, machine.prompt.render().padEnd(40), 0, PROMPT_ROW, 15, 0);
  }

  if (machine.window) drawWindow(renderer.display, machine.window);
  machine.pending?.draw(renderer.display, machine);
}
