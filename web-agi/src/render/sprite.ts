/**
 * Compositing VIEW cels onto the screens.
 *
 * A cel is drawn pixel by pixel through two filters: its transparent colour is
 * a hole rather than paint, and each pixel only lands where the object's
 * priority is at least the priority already on the screen. That second rule is
 * what puts a character behind a tree.
 *
 * Control lines are the one special case. They occupy priority values 0-3 in the
 * same buffer as the depths, so wherever a line was drawn there is no depth
 * left to compare against -- the line has overwritten it. Comparing against the
 * line itself lets a sprite through, and a line that runs across scenery
 * becomes a one-pixel hole in that scenery: in Lefty's bar, the floor's edge
 * runs diagonally into the black margin at the left, and ego standing there
 * leaks through the wall as a diagonal of ego-coloured pixels tracing the line.
 *
 * So a control-line pixel is not a depth but a gap in the depths, and the depth
 * to use is the first real one below it -- which is where the ground that line
 * was drawn on continues.
 */
import { celPixelsForLoop, TRANSPARENT } from 'agi-extract/view';

import { PICTURE_HEIGHT, PICTURE_WIDTH, Screens, type Bytes } from './screens.ts';

export { TRANSPARENT };

export interface Cel {
  width: number;
  height: number;
  transparent: number;
  mirrored: boolean;
  sourceLoop: number;
  pixels: Bytes;
}

export interface DrawCelOptions {
  /** Left edge, in game pixels. */
  x: number;
  /** Bottom edge: AGI positions an object by the bottom-left of its cel. */
  y: number;
  /** The object's drawing priority, normally 4-15. */
  priority: number;
  /** Which loop the cel is being drawn for, so mirroring can be resolved. */
  loop?: number;
  /** Also stamp the priority onto the priority screen, as a drawn object does. */
  writePriority?: boolean;
}

/**
 * Draw a cel onto the screens.
 *
 * @returns how many pixels were actually painted
 */
export function drawCel(screens: Screens, cel: Cel, options: DrawCelOptions): number {
  const { x, y, priority, loop = cel.sourceLoop, writePriority = true } = options;

  const pixels = celPixelsForLoop(cel as never, loop) as Bytes;
  const top = y - cel.height + 1;
  let painted = 0;

  for (let row = 0; row < cel.height; row++) {
    const screenY = top + row;
    if (screenY < 0 || screenY >= PICTURE_HEIGHT) continue;

    for (let column = 0; column < cel.width; column++) {
      const colour = pixels[row * cel.width + column]!;
      if (colour === TRANSPARENT) continue;

      const screenX = x + column;
      if (screenX < 0 || screenX >= PICTURE_WIDTH) continue;

      if (priority < effectivePriority(screens, screenX, screenY)) continue;

      const at = Screens.index(screenX, screenY);

      screens.visual[at] = colour;
      if (writePriority) screens.priority[at] = priority;
      painted++;
    }
  }

  return painted;
}

/** The lowest value that is a depth rather than a control line. */
const LOWEST_PRIORITY = 4;

/**
 * The depth a pixel really has, seeing past any control line drawn on it.
 *
 * Scans down the column for the first real priority, because a control line is
 * drawn along the ground it marks and the ground carries on below it. A line
 * with nothing but more line beneath it hides nothing, which is the reading
 * that leaves sprites at the very bottom of the picture alone.
 */
function effectivePriority(screens: Screens, x: number, y: number): number {
  for (let row = y; row < PICTURE_HEIGHT; row++) {
    const value = screens.priority[Screens.index(x, row)]!;
    if (value >= LOWEST_PRIORITY) return value;
  }
  return 0;
}

/**
 * A rectangle of both screens, saved so it can be put back.
 *
 * Sprites are composited over a static background, and the original does not
 * redraw the picture every cycle -- it puts back what each sprite covered.
 * Keeping that model matters beyond speed: `add.to.pic` draws *into* the
 * background permanently, and a full redraw from the PICTURE would erase it.
 */
export interface SavedArea {
  x: number;
  y: number;
  width: number;
  height: number;
  visual: Bytes;
  priority: Bytes;
}

/**
 * Copy a rectangle out of the screens.
 *
 * The rectangle is clipped to the picture, so an object hanging off an edge
 * saves only the part that is really there.
 */
export function saveArea(screens: Screens, x: number, y: number, width: number, height: number): SavedArea {
  const left = Math.max(0, x);
  const top = Math.max(0, y);
  const right = Math.min(PICTURE_WIDTH, x + width);
  const bottom = Math.min(PICTURE_HEIGHT, y + height);
  const w = Math.max(0, right - left);
  const h = Math.max(0, bottom - top);

  const visual = new Uint8Array(w * h);
  const priority = new Uint8Array(w * h);

  for (let row = 0; row < h; row++) {
    const from = Screens.index(left, top + row);
    visual.set(screens.visual.subarray(from, from + w), row * w);
    priority.set(screens.priority.subarray(from, from + w), row * w);
  }

  return { x: left, y: top, width: w, height: h, visual, priority };
}

/** Put a saved rectangle back. */
export function restoreArea(screens: Screens, area: SavedArea): void {
  for (let row = 0; row < area.height; row++) {
    const to = Screens.index(area.x, area.y + row);
    const from = row * area.width;
    screens.visual.set(area.visual.subarray(from, from + area.width), to);
    screens.priority.set(area.priority.subarray(from, from + area.width), to);
  }
}

/**
 * The rectangle a cel occupies when drawn at a position.
 *
 * Anchoring is bottom-left, so the top of the rectangle is derived rather than
 * given. Callers save this area before drawing and restore it afterwards.
 */
export function celArea(
  x: number,
  y: number,
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } {
  return { x, y: y - height + 1, width, height };
}
