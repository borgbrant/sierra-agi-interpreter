/**
 * The engine's side of the display seam.
 *
 * It holds the driver, and it holds the one rendering choice that is the
 * engine's rather than an adapter's: which of the two screens is being shown.
 * Everything else about how a frame becomes pixels belongs to the driver, and
 * nothing here asks which driver that is.
 *
 * Kept free of the DOM: the result is a byte buffer, so what the engine draws
 * can be asserted in a test. Only presenting it needs a canvas.
 */
import { PICTURE_ROW } from '../engine/layout.ts';
import {
  createDriver,
  type DisplayDriver,
  type DisplayMode,
  type DriverOptions,
} from './drivers/index.ts';
import { Frame } from './frame.ts';
import type { Screens } from './screens.ts';

/** Which of the two screens to show. */
export type ScreenView = 'visual' | 'priority';

/** What the display holds outside the picture area before anything is drawn. */
const CHROME_COLOUR = 0;

export class Renderer {
  /**
   * Which screen is composed. The priority screen is a debugging view: it is
   * never shown during play, but occlusion and blocking problems are close to
   * invisible without it.
   */
  view: ScreenView = 'visual';

  #driver: DisplayDriver;
  #options: DriverOptions;

  /**
   * @param mode    which adapter to start on
   * @param options what the drivers need from outside, which is one font
   *
   * The options are kept rather than only used, because a mode switched later
   * builds a new driver and it needs them too.
   */
  constructor(mode: DisplayMode = 'ega', options: DriverOptions = {}) {
    this.#options = options;
    this.#driver = createDriver(mode, options);
  }

  /** The driver in use: its size and aspect are what the canvas follows. */
  get driver(): DisplayDriver {
    return this.#driver;
  }

  /** The framebuffer the last frame was drawn into. */
  get display() {
    return this.#driver.display;
  }

  /**
   * Draw the game onto whatever adapter is running.
   *
   * Every pixel of every frame goes through here.
   */
  render(frame: Frame): void {
    this.#driver.draw(frame);
  }

  /**
   * Swap adapters.
   *
   * A driver keeps nothing between frames, so switching is only a matter of
   * building the other one -- the next frame repaints in full, at whatever size
   * the new driver asks for, with no room to reload.
   *
   * @returns whether the driver changed
   */
  setMode(mode: DisplayMode): boolean {
    if (mode === this.#driver.mode) return false;
    this.#driver = createDriver(mode, this.#options);
    return true;
  }

  /**
   * Draw nothing but the current screens.
   *
   * The picture on its own, with chrome behind the status line and the input
   * area. What the engine shows the player is a fuller frame than this; see
   * `engine/present.ts`.
   */
  compose(screens: Screens): void {
    const frame = new Frame();
    frame.fill(CHROME_COLOUR);
    frame.picture(this.view === 'visual' ? screens.visual : screens.priority, PICTURE_ROW);
    this.render(frame);
  }

  /** Switch between the visual and priority screens. */
  toggleView(): ScreenView {
    this.view = this.view === 'visual' ? 'priority' : 'visual';
    return this.view;
  }
}
