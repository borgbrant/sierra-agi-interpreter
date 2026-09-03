/**
 * Putting the objects on screen.
 *
 * The picture is static and the objects are composited over it, so every cycle
 * has to put back what the objects covered last time before drawing them where
 * they are now. Doing that per object -- restore this one, move it, draw it,
 * then move on to the next -- leaves trails wherever two objects overlap,
 * because the second one's restore paints over the first one's fresh pixels.
 *
 * So it is two passes, always: restore everything, then draw everything.
 */
import { PICTURE_WIDTH, Screens } from '../render/screens.ts';
import { celArea, drawCel, restoreArea, saveArea, type Cel, type SavedArea } from '../render/sprite.ts';
import type { Machine } from './machine.ts';
import type { ViewObject } from './viewtable.ts';

/**
 * Put back everything the previous draw covered.
 *
 * In reverse, so overlapping saves unwind in the order they were taken and the
 * screen ends up exactly as it was before the pass.
 */
export function eraseObjects(machine: Machine): void {
  for (let i = machine.savedAreas.length - 1; i >= 0; i--) {
    restoreArea(machine.screens, machine.savedAreas[i]!);
  }
  machine.savedAreas.length = 0;
}

/**
 * Draw every visible object, saving what each one covers.
 *
 * Objects are drawn from the back forwards, so a nearer object paints over a
 * further one. The priority test inside {@link drawCel} handles scenery; this
 * ordering is what handles objects against each other. Nothing here writes to
 * the priority screen -- an object's depth belongs to the object, not to the
 * ground it happens to be standing on.
 */
export function drawObjects(machine: Machine): void {
  for (const object of drawingOrder(machine)) {
    const cel = object.currentCel;
    if (!cel) continue;

    const area = celArea(object.x, object.y, cel.width, cel.height);
    machine.savedAreas.push(
      saveArea(machine.screens, area.x, area.y, area.width, area.height),
    );

    drawCel(machine.screens, cel, {
      x: object.x,
      y: object.y,
      priority: object.priority,
      loop: object.loop,
      writePriority: false,
    });
  }
}

/** Visible objects, furthest away first. */
function drawingOrder(machine: Machine): ViewObject[] {
  return machine.viewTable
    .visible()
    .sort((a, b) => a.priority - b.priority || a.y - b.y || a.number - b.number);
}

/**
 * Draw a cel into the background permanently, as `add.to.pic` does.
 *
 * Unlike an animated object this really is part of the scene afterwards: it
 * writes the priority screen too, so ego walks behind it and can be blocked by
 * the control lines it lays down.
 *
 * @param margin control-line value written along the base of the cel, or -1 for
 *               none. Scripts use it to make added scenery solid.
 */
export function addToPicture(
  machine: Machine,
  object: { cel: Cel; loop: number },
  x: number,
  y: number,
  priority: number,
  margin: number,
): void {
  drawCel(machine.background, object.cel, {
    x,
    y,
    priority,
    loop: object.loop,
    writePriority: true,
  });

  if (margin >= 0 && margin <= 3) {
    for (let i = 0; i < object.cel.width; i++) {
      const at = x + i;
      if (at < 0 || at >= PICTURE_WIDTH) continue;
      machine.background.priority[Screens.index(at, y)] = margin;
    }
  }

  // The scene changed underneath whatever is drawn on top of it.
  machine.screens.copyFrom(machine.background);
  machine.savedAreas.length = 0;
}

export type { SavedArea };
