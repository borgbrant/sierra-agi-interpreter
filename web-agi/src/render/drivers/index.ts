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
import type { CgaTables } from '../cgatables.ts';
import type { HgcDither } from '../hgcdither.ts';
import type { HgcFont } from '../hgcfont.ts';
import { CgaDriver } from './cga.ts';
import { CgaMonoDriver } from './cgamono.ts';
import type { DisplayDriver, DisplayMode } from './driver.ts';
import { EgaDriver } from './ega.ts';
import { HerculesDriver } from './hercules.ts';

export type { DisplayDriver, DisplayMode } from './driver.ts';
export { CgaDriver } from './cga.ts';
export { CgaMonoDriver } from './cgamono.ts';
export { EgaDriver } from './ega.ts';
export { HerculesDriver } from './hercules.ts';

/**
 * What a driver needs beyond its mode.
 *
 * Three entries, and all three are files the *interpreter* shipped rather than
 * the game: Hercules brought its own font, and both it and CGA keep their
 * dither tables in `AGIDATA.OVL`. Absent, the engine draws in its own font and
 * uses the tables LSL1's copy holds.
 *
 * And one thing that is not a file: whether the game has asked for a
 * monochrome display. That is the only case in which something above the seam
 * changes the display, and it is here rather than inside a driver because a
 * driver reads no game state -- it is told.
 */
export interface DriverOptions {
  /** `HGC_FONT`, decoded, when the game came with it. */
  herculesFont?: HgcFont | undefined;

  /** `AGIDATA.OVL`'s Hercules dither table, when the game came with it. */
  herculesDither?: HgcDither | undefined;

  /** `AGIDATA.OVL`'s three CGA tables, when the game came with it. */
  cgaTables?: CgaTables | undefined;

  /**
   * Whether the game has asked for mono, which only CGA can answer.
   *
   * `toggle.monitor` is the command, "Graphics Mode <Ctrl-R>" is the menu item,
   * and on a CGA the original answered it by putting the card into 640x200 in
   * two colours. EGA and Hercules have no second mode to switch to: one has no
   * table for it in any file, and the other is monochrome already.
   */
  monochrome?: boolean | undefined;
}

/**
 * Whether a mode has a second driver for when the game asks for mono.
 *
 * Only CGA does, and that is not a gap: EGA's overlay has no table for a
 * two-colour mode and Hercules is monochrome already, so `toggle.monitor` on
 * either of those changes what the scripts are told and nothing else -- which
 * is what it changed on the original too.
 */
export function hasMonoVariant(mode: DisplayMode): boolean {
  return mode === 'cga';
}

/** Build the driver for a mode. */
export function createDriver(mode: DisplayMode, options: DriverOptions = {}): DisplayDriver {
  switch (mode) {
    case 'cga':
      return options.monochrome
        ? new CgaMonoDriver(options.cgaTables)
        : new CgaDriver(options.cgaTables);

    case 'ega':
      return new EgaDriver(mode);

    case 'hercules':
      return new HerculesDriver(options.herculesFont, options.herculesDither);
  }
}
