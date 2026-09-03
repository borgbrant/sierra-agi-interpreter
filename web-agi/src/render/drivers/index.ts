/**
 * Choosing a driver.
 *
 * The one place a mode name becomes a driver, so that arriving at CGA (M12) or
 * Hercules (M13) is a line here rather than a search for everywhere the choice
 * is read.
 *
 * All four modes are EGA today. The PCjr's will not stay a placeholder for
 * long and is barely one now -- its 160x200 mode is the sixteen-colour palette
 * AGI targets, so EGA's pixels really are its pixels, and what M11 adds is the
 * answer the scripts get rather than a new way to draw.
 */
import type { DisplayDriver, DisplayMode } from './driver.ts';
import { EgaDriver } from './ega.ts';

export type { DisplayDriver, DisplayMode } from './driver.ts';
export { EgaDriver } from './ega.ts';

/**
 * Build the driver for a mode.
 *
 * Every mode gets a driver, and it reports the mode it was asked for. Three of
 * them draw EGA's pixels for now, which is what lets the shell say "chosen,
 * but not drawn yet" truthfully instead of quietly ignoring the choice.
 */
export function createDriver(mode: DisplayMode): DisplayDriver {
  return new EgaDriver(mode);
}
