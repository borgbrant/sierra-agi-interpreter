/**
 * What a display driver is.
 *
 * The original AGI shipped one graphics overlay per adapter -- `EGA_GRAF.OVL`,
 * `CGA_GRAF.OVL`, `JR_GRAF.OVL`, `HGC_GRAF.OVL` -- chose one at startup and
 * drew through it. This is that seam. The engine hands down a {@link Frame},
 * which describes what to show in character cells and the picture's own
 * 160x168 pixels, and the driver decides everything else:
 *
 * ```text
 * its canvas size and pixel aspect      how a character cell becomes pixels
 * its palette, and how 16 map to fewer  its font
 * ```
 *
 * That list is why the interface carries size and cell shape rather than only
 * a palette. **Hercules is 720x348**, not 320x200, and its font is the game's
 * own `HGC_FONT`: 3072 bytes, 256 glyphs of twelve rows against the eight the
 * IBM font draws. An interface shaped around EGA would have nowhere to put
 * either fact, so it is shaped around the mode that moves the most.
 *
 * Nothing above the seam asks which driver is running. The one fact that
 * travels back up is {@link DisplayDriver.monochrome}, and that is the
 * scripts' business rather than the renderer's: the game tests a reserved
 * variable in twenty-seven places, and twenty-six of them are asking whether
 * this is a mono screen so that it can lay itself out differently. Wiring that
 * variable is M11's work; the fact is exposed here so M11 has somewhere to
 * read it from.
 */
import type { Display } from '../display.ts';
import type { Frame } from '../frame.ts';

/**
 * Which adapter the game is drawn as.
 *
 * Declared here rather than in the shell, because a mode *is* a driver: the
 * shell's setting is a choice between these, not a separate vocabulary.
 *
 * Three, not the four overlays the original shipped. `JR_GRAF.OVL` has no
 * entry, because a PCjr driver would be this list's only member with nothing
 * of its own: its 160x200 mode *is* the sixteen-colour palette AGI was drawn
 * for, so its pixels are EGA's pixels, and the bundled game never
 * distinguishes its monitor value. See `engine/hardware.ts` for the whole of
 * what was lost by leaving it out.
 */
export type DisplayMode = 'cga' | 'ega' | 'hercules';

export interface DisplayDriver {
  /** Which adapter this is. */
  readonly mode: DisplayMode;

  /** The framebuffer a frame is drawn into: this driver's size and palette. */
  readonly display: Display;

  /**
   * How wide one framebuffer pixel should be shown relative to its height.
   *
   * A property of the adapter, not of the buffer. EGA's 320x200 was shown on a
   * 4:3 screen, so its pixels are 1.2 times taller than they are wide; the
   * canvas is what acts on this.
   */
  readonly pixelAspect: number;

  /** Whether the scripts should be told this is a monochrome display. */
  readonly monochrome: boolean;

  /**
   * Draw a frame into {@link display}.
   *
   * Every pixel the game shows comes from here. The frame is drawn in the
   * order its layers were added; nothing is remembered between frames, so a
   * driver may be swapped for another and the next frame repaints in full.
   */
  draw(frame: Frame): void;

  /**
   * Expand what was last drawn to RGBA, for a canvas.
   *
   * @param into a buffer to reuse, avoiding an allocation per frame
   */
  toRgba(into?: Uint8ClampedArray): Uint8ClampedArray;
}
