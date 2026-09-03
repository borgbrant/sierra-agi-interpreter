/**
 * AGI v2 PICTURE interpreter.
 *
 * A PICTURE resource is a vector command stream, not a bitmap: it is replayed
 * against two 160x168 screens, the visual screen the player sees and the
 * priority screen the interpreter uses for depth and control lines.
 *
 * The algorithms here follow the AGI Specifications, chapter 7 (Lance Ewing,
 * Claudio Matsuoka, Vassili Bykov). The line routine in particular has to match
 * Sierra's rounding exactly: a single pixel out of place opens a gap that a
 * later flood fill escapes through, and the whole picture floods.
 */

/** Pixels across. Each AGI pixel is two pixels wide on a 320x200 EGA screen. */
export const PICTURE_WIDTH = 160;

/** Pixels down. */
export const PICTURE_HEIGHT = 168;

/** The visual screen starts white; fills spread across white. */
export const WHITE = 15;

/** The priority screen starts red; priority-only fills spread across red. */
export const RED = 4;

/**
 * The 16 EGA colours, as 8-bit RGB. The specification lists them as 6-bit
 * values; 0x00/0x15/0x2A/0x3F scale exactly onto 0x00/0x55/0xAA/0xFF.
 */
export const EGA_PALETTE = Object.freeze([
  [0x00, 0x00, 0x00], // 0  black
  [0x00, 0x00, 0xaa], // 1  blue
  [0x00, 0xaa, 0x00], // 2  green
  [0x00, 0xaa, 0xaa], // 3  cyan
  [0xaa, 0x00, 0x00], // 4  red
  [0xaa, 0x00, 0xaa], // 5  magenta
  [0xaa, 0x55, 0x00], // 6  brown
  [0xaa, 0xaa, 0xaa], // 7  light grey
  [0x55, 0x55, 0x55], // 8  dark grey
  [0x55, 0x55, 0xff], // 9  light blue
  [0x55, 0xff, 0x55], // 10 light green
  [0x55, 0xff, 0xff], // 11 light cyan
  [0xff, 0x55, 0x55], // 12 light red
  [0xff, 0x55, 0xff], // 13 light magenta
  [0xff, 0xff, 0x55], // 14 yellow
  [0xff, 0xff, 0xff], // 15 white
]);

/** Drawing action codes. */
export const ACTION = Object.freeze({
  PIC_COLOUR: 0xf0,
  PIC_OFF: 0xf1,
  PRI_COLOUR: 0xf2,
  PRI_OFF: 0xf3,
  Y_CORNER: 0xf4,
  X_CORNER: 0xf5,
  LINE_ABS: 0xf6,
  LINE_REL: 0xf7,
  FILL: 0xf8,
  PEN: 0xf9,
  PLOT: 0xfa,
  END: 0xff,
});

/**
 * Pen shapes. A pen of size n covers a box (n + 1) wide and (2n + 1) tall —
 * narrow horizontally because AGI pixels are twice as wide as they are tall.
 * Rectangles fill that box; circles use these bitmaps, packed row-major, one
 * bit per pixel, MSB first, transcribed from the CIRCLE SIZES diagram in the
 * specification.
 */
const CIRCLE_BITMAPS = [
  [0x80],
  [0xfc],
  [0x5f, 0xf4],
  [0x66, 0xff, 0xf6, 0x60],
  [0x23, 0xbf, 0xff, 0xff, 0xee, 0x20],
  [0x31, 0xe7, 0x9e, 0xff, 0xff, 0xde, 0x79, 0xe3, 0x00],
  [0x38, 0xf9, 0xf3, 0xef, 0xff, 0xff, 0xff, 0xfe, 0xf9, 0xf3, 0xe3, 0x80],
  [
    0x18, 0x3c, 0x7e, 0x7e, 0x7e, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7e, 0x7e, 0x7e, 0x3c,
    0x18,
  ],
];

/** Expanded circle masks: `CIRCLES[size][row * width + col]` is 0 or 1. */
const CIRCLES = CIRCLE_BITMAPS.map((bytes, size) => {
  const width = size + 1;
  const height = 2 * size + 1;
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) {
    mask[i] = (bytes[i >> 3] >> (7 - (i & 7))) & 1;
  }
  return { width, height, mask };
});

/**
 * The 32 bytes (256 bits) holding every splatter texture, and the starting bit
 * position within them for each of the 120 texture numbers.
 */
const TEXTURE = Uint8Array.from([
  0x20, 0x94, 0x02, 0x24, 0x90, 0x82, 0xa4, 0xa2, 0x82, 0x09, 0x0a, 0x22, 0x12, 0x10,
  0x42, 0x14, 0x91, 0x4a, 0x91, 0x11, 0x08, 0x12, 0x25, 0x10, 0x22, 0xa8, 0x14, 0x24,
  0x00, 0x50, 0x24, 0x04,
]);

const SPLATTER_START = Uint8Array.from([
  0x00, 0x18, 0x30, 0xc4, 0xdc, 0x65, 0xeb, 0x48, 0x60, 0xbd, 0x89, 0x04, 0x0a, 0xf4,
  0x7d, 0x6d, 0x85, 0xb0, 0x8e, 0x95, 0x1f, 0x22, 0x0d, 0xdf, 0x2a, 0x78, 0xd5, 0x73,
  0x1c, 0xb4, 0x40, 0xa1, 0xb9, 0x3c, 0xca, 0x58, 0x92, 0x34, 0xcc, 0xce, 0xd7, 0x42,
  0x90, 0x0f, 0x8b, 0x7f, 0x32, 0xed, 0x5c, 0x9d, 0xc8, 0x99, 0xad, 0x4e, 0x56, 0xa6,
  0xf7, 0x68, 0xb7, 0x25, 0x82, 0x37, 0x3a, 0x51, 0x69, 0x26, 0x38, 0x52, 0x9e, 0x9a,
  0x4f, 0xa7, 0x43, 0x10, 0x80, 0xee, 0x3d, 0x59, 0x35, 0xcf, 0x79, 0x74, 0xb5, 0xa2,
  0xb1, 0x96, 0x23, 0xe0, 0xbe, 0x05, 0xf5, 0x6e, 0x19, 0xc5, 0x66, 0x49, 0xf0, 0xd1,
  0x54, 0xa9, 0x70, 0x4b, 0xa4, 0xe2, 0xe6, 0xe5, 0xab, 0xe4, 0xd2, 0xaa, 0x4c, 0xe3,
  0x06, 0x6f, 0xc6, 0x4a, 0x75, 0xa3, 0x97, 0xe1,
]);

/**
 * Sierra's rounding. When a pixel placement is a 50:50 call, the direction the
 * line travels decides it — this is what makes lines land where the original
 * interpreter put them.
 *
 * @param {number} value
 * @param {number} direction
 * @returns {number}
 */
export function round(value, direction) {
  const frac = value - Math.floor(value);
  if (direction < 0) return frac <= 0.501 ? Math.floor(value) : Math.ceil(value);
  return frac < 0.499 ? Math.floor(value) : Math.ceil(value);
}

/**
 * The two screens a picture draws onto.
 */
export class PictureScreens {
  constructor() {
    /** Visual screen, one colour index per pixel. */
    this.visual = new Uint8Array(PICTURE_WIDTH * PICTURE_HEIGHT).fill(WHITE);
    /** Priority screen, one priority value per pixel. */
    this.priority = new Uint8Array(PICTURE_WIDTH * PICTURE_HEIGHT).fill(RED);

    this.picColour = 0;
    this.picOn = false;
    this.priColour = 0;
    this.priOn = false;
    /** Pen code set by 0xF9: bits 0-2 size, bit 4 rectangle, bit 5 splatter. */
    this.penCode = 0;
  }

  /**
   * Set one pixel on whichever screens are currently enabled.
   *
   * @param {number} x
   * @param {number} y
   */
  pset(x, y) {
    if (x < 0 || x >= PICTURE_WIDTH || y < 0 || y >= PICTURE_HEIGHT) return;
    const i = y * PICTURE_WIDTH + x;
    if (this.picOn) this.visual[i] = this.picColour;
    if (this.priOn) this.priority[i] = this.priColour;
  }

  /**
   * Draw a line using Sierra's algorithm.
   *
   * @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2
   */
  drawLine(x1, y1, x2, y2) {
    const height = y2 - y1;
    const width = x2 - x1;
    let addX = height === 0 ? 0 : width / Math.abs(height);
    let addY = width === 0 ? 0 : height / Math.abs(width);

    if (Math.abs(width) > Math.abs(height)) {
      let y = y1;
      addX = width === 0 ? 0 : Math.sign(width);
      for (let x = x1; x !== x2; x += addX) {
        this.pset(round(x, addX), round(y, addY));
        y += addY;
      }
      this.pset(x2, y2);
    } else {
      let x = x1;
      addY = height === 0 ? 0 : Math.sign(height);
      for (let y = y1; y !== y2; y += addY) {
        this.pset(round(x, addX), round(y, addY));
        x += addX;
      }
      this.pset(x2, y2);
    }
  }

  /**
   * Flood fill outward from a point, stopping at any pixel that is not the
   * background colour.
   *
   * With picture drawing enabled the boundary is read from the visual screen —
   * which is also what makes a combined fill stop at picture-only boundaries
   * that do not exist on the priority screen.
   *
   * @param {number} x
   * @param {number} y
   */
  fill(x, y) {
    if (!this.picOn && !this.priOn) return;
    // Filling white onto white paints nothing and has no priority screen to
    // update, so there is nothing to do.
    if (this.picOn && !this.priOn && this.picColour === WHITE) return;
    if (x < 0 || x >= PICTURE_WIDTH || y < 0 || y >= PICTURE_HEIGHT) return;

    const background = this.picOn ? this.visual : this.priority;
    const boundary = this.picOn ? WHITE : RED;

    // `seen` guarantees termination even when a fill paints its own background
    // colour; a pixel is never revisited, which is also true of the original.
    const seen = new Uint8Array(PICTURE_WIDTH * PICTURE_HEIGHT);
    const queue = [y * PICTURE_WIDTH + x];
    seen[queue[0]] = 1;

    for (let head = 0; head < queue.length; head++) {
      const i = queue[head];
      if (background[i] !== boundary) continue;

      const px = i % PICTURE_WIDTH;
      const py = (i - px) / PICTURE_WIDTH;
      this.pset(px, py);

      const push = (j) => {
        if (!seen[j] && background[j] === boundary) {
          seen[j] = 1;
          queue.push(j);
        }
      };

      if (px > 0) push(i - 1);
      if (px < PICTURE_WIDTH - 1) push(i + 1);
      if (py > 0) push(i - PICTURE_WIDTH);
      if (py < PICTURE_HEIGHT - 1) push(i + PICTURE_WIDTH);
    }
  }

  /**
   * Plot the current pen at a point.
   *
   * For a splatter pen the texture bits are consumed only at positions that are
   * part of the shape, so a circle uses the same bit sequence a rectangle would
   * but skips the corners it does not cover.
   *
   * @param {number} x
   * @param {number} y
   * @param {number} [patternNum] texture number, splatter pens only
   */
  plot(x, y, patternNum = 0) {
    const size = this.penCode & 0x07;
    const rectangle = (this.penCode & 0x10) !== 0;
    const splatter = (this.penCode & 0x20) !== 0;

    const shape = CIRCLES[size];
    const { width, height } = shape;

    // The plotted coordinate sits at the centre row, and just right of centre
    // on the narrow axis.
    const left = x - Math.ceil(size / 2);
    const top = y - size;

    let bit = splatter ? SPLATTER_START[(patternNum >> 1) & 0x7f] : 0;

    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        if (!rectangle && !shape.mask[row * width + col]) continue;

        let draw = true;
        if (splatter) {
          draw = ((TEXTURE[bit >> 3] >> (7 - (bit & 7))) & 1) === 1;
          // The interpreter wraps the bit position at 255 rather than 256.
          bit = bit + 1 === 255 ? 0 : bit + 1;
        }

        if (draw) this.pset(left + col, top + row);
      }
    }
  }
}

/**
 * Interpret a PICTURE resource payload.
 *
 * Unknown action codes and a truncated stream end the picture rather than
 * throwing: a damaged resource still yields whatever was drawn before the
 * damage, which is more useful than nothing.
 *
 * @param {Buffer | Uint8Array} data raw PICTURE payload (no VOL header)
 * @returns {PictureScreens}
 */
export function decodePicture(data) {
  const screens = new PictureScreens();
  let i = 0;

  const hasArg = () => i < data.length && data[i] < 0xf0;
  const arg = () => data[i++];

  while (i < data.length) {
    const code = data[i++];
    if (code < 0xf0) continue; // stray argument byte before any action
    if (code === ACTION.END) break;

    switch (code) {
      case ACTION.PIC_COLOUR:
        if (!hasArg()) return screens;
        screens.picColour = arg() & 0x0f;
        screens.picOn = true;
        break;

      case ACTION.PIC_OFF:
        screens.picOn = false;
        break;

      case ACTION.PRI_COLOUR:
        if (!hasArg()) return screens;
        screens.priColour = arg() & 0x0f;
        screens.priOn = true;
        break;

      case ACTION.PRI_OFF:
        screens.priOn = false;
        break;

      case ACTION.Y_CORNER:
      case ACTION.X_CORNER: {
        if (!hasArg()) break;
        let x = arg();
        if (!hasArg()) break;
        let y = arg();
        screens.pset(x, y);

        // A Y corner moves vertically first, an X corner horizontally.
        let vertical = code === ACTION.Y_CORNER;
        while (hasArg()) {
          if (vertical) {
            const y2 = arg();
            screens.drawLine(x, y, x, y2);
            y = y2;
          } else {
            const x2 = arg();
            screens.drawLine(x, y, x2, y);
            x = x2;
          }
          vertical = !vertical;
        }
        break;
      }

      case ACTION.LINE_ABS: {
        if (!hasArg()) break;
        let x = arg();
        if (!hasArg()) break;
        let y = arg();
        screens.pset(x, y);

        while (hasArg()) {
          const x2 = arg();
          if (!hasArg()) break;
          const y2 = arg();
          screens.drawLine(x, y, x2, y2);
          x = x2;
          y = y2;
        }
        break;
      }

      case ACTION.LINE_REL: {
        if (!hasArg()) break;
        let x = arg();
        if (!hasArg()) break;
        let y = arg();
        screens.pset(x, y);

        while (hasArg()) {
          const disp = arg();
          // SXXX SYYY: bit 7 and bit 3 are the sign bits, giving -7..+7.
          const dx = (disp & 0x80 ? -1 : 1) * ((disp >> 4) & 0x07);
          const dy = (disp & 0x08 ? -1 : 1) * (disp & 0x07);
          const x2 = x + dx;
          const y2 = y + dy;
          screens.drawLine(x, y, x2, y2);
          x = x2;
          y = y2;
        }
        break;
      }

      case ACTION.FILL:
        while (hasArg()) {
          const x = arg();
          if (!hasArg()) break;
          screens.fill(x, arg());
        }
        break;

      case ACTION.PEN:
        if (!hasArg()) break;
        screens.penCode = arg();
        break;

      case ACTION.PLOT: {
        const splatter = (screens.penCode & 0x20) !== 0;
        while (hasArg()) {
          let pattern = 0;
          if (splatter) {
            pattern = arg();
            if (!hasArg()) break;
          }
          const x = arg();
          if (!hasArg()) break;
          screens.plot(x, arg(), pattern);
        }
        break;
      }

      default:
        // 0xFB-0xFE are unused in AGI; skip their arguments and carry on.
        while (hasArg()) arg();
        break;
    }
  }

  return screens;
}
