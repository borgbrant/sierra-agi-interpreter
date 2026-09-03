/**
 * The two screens a room is drawn on.
 *
 * The visual screen is what the player sees. The priority screen is never
 * displayed: it carries the depth information that decides whether a sprite is
 * drawn in front of scenery or hidden behind it, plus the control lines that
 * say where an object may walk.
 *
 * Both are the picture's own 160x168, not the 320x200 the display uses. An AGI
 * pixel is twice as wide as it is tall; that correction happens on the way to
 * the display, so everything here works in game coordinates.
 */
import { decodePicture, PICTURE_HEIGHT, PICTURE_WIDTH, RED, WHITE } from 'agi-extract/pic';

/**
 * The screen dimensions and the two background colours are the picture
 * interpreter's own: the visual screen starts white and the priority screen
 * red, because that is what its fills spread across. Re-exported rather than
 * restated so there is one definition of each.
 */
export { PICTURE_HEIGHT, PICTURE_WIDTH, RED, WHITE };

/** What the four control values mean where they appear on the priority screen. */
export const CONTROL = {
  UNCONDITIONAL_OBSTACLE: 0,
  CONDITIONAL_OBSTACLE: 1,
  ALARM: 2,
  WATER: 3,
} as const;

const SIZE = PICTURE_WIDTH * PICTURE_HEIGHT;

/**
 * A byte buffer whose backing store we do not care about.
 *
 * TypeScript makes `Uint8Array` generic over its buffer, and decoders hand back
 * the wider `ArrayBufferLike` form. Widening here beats casting at every call.
 */
export type Bytes = Uint8Array<ArrayBufferLike>;

/**
 * A visual screen and its priority screen, kept together because almost
 * everything that touches one touches the other.
 */
export class Screens {
  readonly visual: Bytes;
  readonly priority: Bytes;

  constructor(visual: Bytes = new Uint8Array(SIZE).fill(WHITE), priority: Bytes = new Uint8Array(SIZE).fill(RED)) {
    if (visual.length !== SIZE || priority.length !== SIZE) {
      throw new Error(`screens must be ${PICTURE_WIDTH}x${PICTURE_HEIGHT}`);
    }
    this.visual = visual;
    this.priority = priority;
  }

  /** Reset to the state a picture starts from. */
  clear(): void {
    this.visual.fill(WHITE);
    this.priority.fill(RED);
  }

  /** An independent copy, used to keep a clean background to restore from. */
  clone(): Screens {
    return new Screens(this.visual.slice(), this.priority.slice());
  }

  /** Overwrite these screens with another's contents, reusing the buffers. */
  copyFrom(other: Screens): void {
    this.visual.set(other.visual);
    this.priority.set(other.priority);
  }

  /** Index into either buffer. */
  static index(x: number, y: number): number {
    return y * PICTURE_WIDTH + x;
  }

  colourAt(x: number, y: number): number {
    return this.visual[Screens.index(x, y)]!;
  }

  priorityAt(x: number, y: number): number {
    return this.priority[Screens.index(x, y)]!;
  }

  /**
   * Interpret a PICTURE resource onto a fresh pair of screens.
   *
   * The vector interpreter is agi-extract's, which already reproduces Sierra's
   * line rounding and fill rules and is tested against them.
   *
   * @param payload raw PICTURE bytes, without the VOL header
   */
  static fromPicture(payload: Uint8Array): Screens {
    const drawn = decodePicture(payload) as { visual: Bytes; priority: Bytes };
    return new Screens(drawn.visual, drawn.priority);
  }
}
