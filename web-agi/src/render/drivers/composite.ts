/**
 * A CGA on a composite monitor: the same card, a different screen.
 *
 * This is the only driver here that simulates a *monitor* rather than an
 * adapter, and it is a subclass rather than a sibling for exactly that reason.
 * The card is in 640x200 in two colours -- `CgaMonoDriver`'s mode, drawn with
 * the interpreter's own patterns -- and every pixel it writes is the pixel the
 * two-colour driver writes. What differs is the wire it goes down.
 *
 * ## Why the mode exists, which the tables answer
 *
 * On a composite monitor the CGA's pixel clock is four times the NTSC colour
 * subcarrier, so **four pixels are one colour cycle** and the pattern in them
 * is a colour. AGI's two-colour table gives each of the sixteen AGI colours a
 * four-pixel pattern of its own -- M16 found it at `0x1ba8` and proved it is a
 * permutation of all sixteen nibble values.
 *
 * Those two facts are the same fact. A permutation of sixteen four-bit patterns
 * is sixteen artefact colours, and `engine/hardware.ts` had already noticed the
 * other end of it: the game offers "Graphics Mode <Ctrl-R>" on CGA and nowhere
 * else, which is a thing only a composite screen has any use for.
 *
 * Running the interpreter's own patterns through the demodulator below is the
 * check, and it mostly holds:
 *
 * ```text
 * black and white       exact, at both ends
 * the two greys         both come out grey, and identically so -- 0101 and
 *                       1010 differ only in phase, which is the one thing a
 *                       composite monitor cannot see
 * the four dark hues    one bit each: blue, green, red, brown, 90 degrees apart
 * light against dark    the four three-bit patterns are all brighter than all
 *                       four one-bit ones -- 166 at the dimmest against 89 at
 *                       the brightest -- which is what a table built on
 *                       luminance and phase looks like
 * hue agreement         8 of the 12 chromatic colours within 30 degrees of the
 *                       palette's hue, mean error 22 degrees
 * the outlier           light magenta, 83 degrees out: its pattern is two
 *                       adjacent bits at half luminance, and Sierra assigned
 *                       the four two-bit patterns to colours whose luminances
 *                       do not match them either. Some of the table is hue and
 *                       some of it is what was left
 * ```
 *
 * ## What is fitted, and what is not
 *
 * The demodulator is arithmetic: luma is the mean over one colour cycle, chroma
 * is that cycle projected onto the subcarrier, and YIQ to RGB is the standard
 * matrix. None of that is a choice.
 *
 * The *burst phase* is a choice, because nothing in any file records it -- M16
 * looked, and `CGA_GRAF.OVL` sets a mode register and a colour, not a monitor.
 * So it is fitted: the angle that puts the sixteen decoded patterns closest to
 * the palette's own hues, which is 316 degrees. The saturation and the width of
 * the chroma filter are the monitor's knobs and are set to look like one.
 *
 * This mode is therefore a simulation in the way Hercules' phosphor is, and
 * further from its file than any other driver here. What it is not is invented:
 * every pixel it decodes was put there by the interpreter's own table.
 */
import { CGA_TABLES, type CgaTables } from '../cgatables.ts';
import { CgaMonoDriver } from './cgamono.ts';
import type { DisplayMode } from './driver.ts';

/**
 * The burst phase, in degrees.
 *
 * Fitted, and the only fitted number that changes which colour is which: it is
 * the angle at which the interpreter's sixteen patterns land nearest the
 * palette's sixteen hues. See the header.
 */
export const COMPOSITE_PHASE = 316;

/**
 * How wide the chroma filter is, in pixels.
 *
 * A real monitor's chroma bandwidth is a fraction of its luma bandwidth, which
 * is why composite pictures have sharp edges and soft colour. Eight pixels is
 * two colour cycles; four rings badly enough to move a two-bit pattern's hue,
 * and twelve buys nothing measurable.
 */
export const COMPOSITE_CHROMA_TAPS = 8;

/** How strong the colour is. A monitor's knob, set to look like one. */
export const COMPOSITE_SATURATION = 0.4;

/** Luma is the mean over one whole colour cycle, which is what cancels chroma. */
const LUMA_TAPS = 4;

/** cos and sin of the subcarrier, which repeat every four pixels. */
const CARRIER = (() => {
  const phase = (COMPOSITE_PHASE * Math.PI) / 180;
  const cos: number[] = [];
  const sin: number[] = [];
  for (let n = 0; n < 4; n++) {
    cos.push(Math.cos((n * Math.PI) / 2 + phase));
    sin.push(Math.sin((n * Math.PI) / 2 + phase));
  }
  return { cos, sin };
})();

/** A Hann window over the chroma filter, and its total weight. */
const CHROMA = (() => {
  const weights: number[] = [];
  for (let k = 0; k < COMPOSITE_CHROMA_TAPS; k++) {
    weights.push(0.5 - 0.5 * Math.cos((2 * Math.PI * (k + 0.5)) / COMPOSITE_CHROMA_TAPS));
  }
  const total = weights.reduce((sum, w) => sum + w, 0);
  return { weights, gain: (2 * COMPOSITE_SATURATION) / total };
})();

export class CgaCompositeDriver extends CgaMonoDriver {
  /**
   * Its own mode, unlike the two-colour driver it extends.
   *
   * `CgaMonoDriver` reports `cga` because the game switches the card into it
   * mid-play and nothing above the seam should notice. A composite monitor is
   * the opposite case: the player chose it, it is in the shell's list, and it
   * stays until they choose otherwise.
   */
  override readonly mode: DisplayMode = 'composite';

  /**
   * A colour screen, whatever the card is doing.
   *
   * The card is in two colours and the monitor shows sixteen, and it is the
   * monitor the scripts are laying themselves out for. `engine/hardware.ts`
   * tells them CGA, which is the branch that offers `Ctrl-R` -- the menu item
   * that only makes sense on this screen.
   */
  override readonly monochrome: boolean = false;

  constructor(tables: CgaTables = CGA_TABLES) {
    super(tables);
  }

  /**
   * Demodulate the scanlines into colour.
   *
   * Per pixel: luma is the mean of one colour cycle, chroma is two cycles
   * projected onto the subcarrier through a Hann window, and the two become RGB
   * through the NTSC matrix. Off the ends of a line the signal is black, which
   * is what blanking is.
   */
  override toRgba(into?: Uint8ClampedArray): Uint8ClampedArray {
    // Measured at about 5 ms a frame against the two-colour driver's 0.4, on
    // 640x200 -- thirteen times the work and a third of a 60 Hz budget, which
    // is what a monitor costs. Skipping unlit samples was tried and is slower:
    // the branch costs more than the multiply it avoids.
    const { width, height, pixels } = this.display;
    const out = into ?? new Uint8ClampedArray(width * height * 4);

    const half = COMPOSITE_CHROMA_TAPS >> 1;

    for (let row = 0; row < height; row++) {
      const line = row * width;

      for (let x = 0; x < width; x++) {
        let luma = 0;
        for (let k = 0; k < LUMA_TAPS; k++) {
          const at = x + k - 1;
          if (at >= 0 && at < width) luma += pixels[line + at]!;
        }
        luma /= LUMA_TAPS;

        let i = 0;
        let q = 0;
        for (let k = 0; k < COMPOSITE_CHROMA_TAPS; k++) {
          const at = x + k - half + 1;
          if (at < 0 || at >= width) continue;
          const sample = pixels[line + at]! * CHROMA.weights[k]!;
          i += sample * CARRIER.cos[at & 3]!;
          q += sample * CARRIER.sin[at & 3]!;
        }
        i *= CHROMA.gain;
        q *= CHROMA.gain;

        const at = (line + x) * 4;
        out[at] = 255 * (luma + 0.956 * i + 0.621 * q);
        out[at + 1] = 255 * (luma - 0.272 * i - 0.647 * q);
        out[at + 2] = 255 * (luma - 1.106 * i + 1.703 * q);
        out[at + 3] = 255;
      }
    }

    return out;
  }
}

/**
 * What one AGI colour decodes to, on its own.
 *
 * A run of that colour, demodulated in the middle where its neighbours cannot
 * reach it. Used by the tests that hold the header's claims, and by anything
 * that wants to say what a colour looks like on this screen.
 *
 * @param colour an AGI colour, 0-15
 * @param tables the interpreter's tables, when the game came with them
 */
export function compositeColour(
  colour: number,
  tables: CgaTables = CGA_TABLES,
): [number, number, number] {
  const pattern = tables.mono[colour & 0x0f]!;
  const width = 32;
  const driver = new CgaCompositeDriver(tables);
  const { pixels } = driver.display;

  for (let x = 0; x < width; x++) {
    // The pattern repeated, most significant bit leftmost, as the blit stores
    // it -- see `monoLit`.
    pixels[x] = (pattern >> (3 - (x & 3))) & 1;
  }

  const rgba = driver.toRgba();
  const at = 16 * 4; // the middle of the run, four cycles in
  return [rgba[at]!, rgba[at + 1]!, rgba[at + 2]!];
}
