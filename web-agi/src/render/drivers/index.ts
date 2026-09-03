/**
 * Choosing a driver.
 *
 * The one place a mode name becomes a driver, so that arriving at CGA (M12) or
 * Hercules (M13) is a line here rather than a search for everywhere the choice
 * is read.
 *
 * Two of the three are real. Hercules still draws EGA's pixels while reporting
 * the mode it was asked for, which is what lets the shell say "chosen, but not
 * drawn yet" truthfully instead of quietly ignoring the choice.
 */
import { CgaDriver } from './cga.ts';
import type { DisplayDriver, DisplayMode } from './driver.ts';
import { EgaDriver } from './ega.ts';

export type { DisplayDriver, DisplayMode } from './driver.ts';
export { CgaDriver } from './cga.ts';
export { EgaDriver } from './ega.ts';

/** Build the driver for a mode. */
export function createDriver(mode: DisplayMode): DisplayDriver {
  switch (mode) {
    case 'cga':
      return new CgaDriver();

    case 'ega':
      return new EgaDriver(mode);

    // M13. Reports Hercules and draws EGA, which the shell tells the player.
    case 'hercules':
      return new EgaDriver(mode);
  }
}
