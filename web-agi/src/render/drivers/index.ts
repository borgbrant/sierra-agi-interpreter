/**
 * Choosing a driver.
 *
 * The one place a mode name becomes a driver, so that arriving at CGA (M12) or
 * Hercules (M13) is a line here rather than a search for everywhere the choice
 * is read.
 *
 * All three are real, and no two are alike: sixteen colours at 320x200, four
 * at the same size, and two at 720x348 in a cell of its own. `JR_GRAF.OVL` is
 * the fourth the original shipped and has no entry here; `engine/hardware.ts`
 * says why.
 */
import type { HgcDither } from '../hgcdither.ts';
import type { HgcFont } from '../hgcfont.ts';
import { CgaDriver } from './cga.ts';
import type { DisplayDriver, DisplayMode } from './driver.ts';
import { EgaDriver } from './ega.ts';
import { HerculesDriver } from './hercules.ts';

export type { DisplayDriver, DisplayMode } from './driver.ts';
export { CgaDriver } from './cga.ts';
export { EgaDriver } from './ega.ts';
export { HerculesDriver } from './hercules.ts';

/**
 * What a driver needs beyond its mode.
 *
 * Two entries, and both are Hercules', because Hercules is the only mode whose
 * driver was a pair of files rather than a routine: it brought its own font,
 * and its dither table lives in the interpreter's data. Absent, the engine
 * draws in its own font and uses the table LSL1's copy holds.
 */
export interface DriverOptions {
  /** `HGC_FONT`, decoded, when the game came with it. */
  herculesFont?: HgcFont | undefined;

  /** `AGIDATA.OVL`'s dither table, when the game came with it. */
  herculesDither?: HgcDither | undefined;
}

/** Build the driver for a mode. */
export function createDriver(mode: DisplayMode, options: DriverOptions = {}): DisplayDriver {
  switch (mode) {
    case 'cga':
      return new CgaDriver();

    case 'ega':
      return new EgaDriver(mode);

    case 'hercules':
      return new HerculesDriver(options.herculesFont, options.herculesDither);
  }
}
