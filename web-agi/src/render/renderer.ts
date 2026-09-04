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
  hasMonoVariant,
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
   * Whether the game has asked for a monochrome display.
   *
   * Kept here because it survives a mode switch: a player who moves from CGA to
   * EGA and back while the game is in mono should come back to the mode the
   * game asked for. `present` is what tells this, once a frame, from the
   * monitor variable -- the only fact that crosses the seam in this direction.
   */
  #monochrome = false;

  /**
   * @param mode    which adapter to start on
   * @param options what the drivers need from outside, which is one font
   *
   * The options are kept rather than only used, because a mode switched later
   * builds a new driver and it needs them too.
   */
  constructor(mode: DisplayMode = 'ega', options: DriverOptions = {}) {
    this.#options = options;
    this.#monochrome = options.monochrome ?? false;
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
    this.#driver = this.#build(mode);
    return true;
  }

  /**
   * The game asking for mono, or asking to come back out of it.
   *
   * `toggle.monitor` is the command and "Graphics Mode <Ctrl-R>" the menu item
   * the player reaches it by. On CGA the original answered by putting the card
   * into 640x200 in two colours, so that is what this builds; on the other two
   * modes there is nothing to switch to and the answer is only what the scripts
   * are told.
   *
   * @returns whether the driver changed
   */
  setMonochrome(monochrome: boolean): boolean {
    if (monochrome === this.#monochrome) return false;
    this.#monochrome = monochrome;
    if (!hasMonoVariant(this.#driver.mode)) return false;
    this.#driver = this.#build(this.#driver.mode);
    return true;
  }

  #build(mode: DisplayMode): DisplayDriver {
    return createDriver(mode, { ...this.#options, monochrome: this.#monochrome });
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
