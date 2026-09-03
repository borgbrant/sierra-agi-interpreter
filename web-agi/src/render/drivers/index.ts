/**
 * Choosing a driver.
 *
 * The one place a mode name becomes a driver, so that arriving at CGA (M12) or
 * Hercules (M13) is a line here rather than a search for everywhere the choice
 * is read.
 *
 * All three modes are EGA today; two of them will not be.
 */
import type { DisplayDriver, DisplayMode } from './driver.ts';
import { EgaDriver } from './ega.ts';

export type { DisplayDriver, DisplayMode } from './driver.ts';
export { EgaDriver } from './ega.ts';

/**
 * Build the driver for a mode.
 *
 * Every mode gets a driver, and it reports the mode it was asked for. CGA's and
 * Hercules' draw EGA's pixels for now, which is what lets the shell say
 * "chosen, but not drawn yet" truthfully instead of quietly ignoring the
 * choice.
 */
export function createDriver(mode: DisplayMode): DisplayDriver {
  return new EgaDriver(mode);
}
