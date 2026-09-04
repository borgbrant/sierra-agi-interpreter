/**
 * The canvas a driver's framebuffer is presented on.
 *
 * The backing store is the running driver's own size and the CSS scales it, so
 * pixels stay sharp rather than being resampled. Neither number is a constant
 * here: EGA's buffer is 320x200 and Hercules' is 720x348, and a canvas that
 * assumed either would be the wrong size for the other.
 *
 * Two things follow the driver. Its buffer size decides the backing store,
 * which is re-made when the driver changes; and its pixel aspect decides how
 * wide the element is drawn, because a buffer whose pixels are not square has
 * to be stretched to be right. EGA's are square -- the 160-wide picture has
 * already been doubled -- so for it the stretch is 1 and nothing moves.
 *
 * The size it is presented at is decided by `fitPresentation` against the box
 * the page has given the stage. Until M17 that box was the window's *width*,
 * with no reference to its height, so a laptop got an 800-pixel-tall canvas in
 * a 900-pixel window and the command line the player types into scrolled off
 * the bottom.
 */
import type { DisplayDriver } from '../render/drivers/driver.ts';

/** Enough of a driver to decide how big to draw it. */
export interface DisplayBuffer {
  /** The framebuffer's width in pixels. */
  readonly width: number;
  /** The framebuffer's height in pixels. */
  readonly height: number;
  /** How wide one of its pixels is presented, relative to its height. */
  readonly pixelAspect: number;
}

/** The space the page has to present it in, in CSS pixels. */
export interface Box {
  readonly width: number;
  readonly height: number;
}

/** How big to draw the element, and at what multiple of the buffer. */
export interface Presentation {
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  /** Whether the scale is a whole number, and so one buffer pixel per cell. */
  readonly whole: boolean;
}

/**
 * The largest size the buffer can be presented at inside `box`.
 *
 * Whole multiples while it is being *enlarged*, which is what keeps a pixel a
 * square block of screen pixels and keeps a dither pattern the pattern the
 * interpreter wrote. That matters most in the mode where it is least
 * convenient: Hercules' 720x348 doubles to 1440, so between 1x and 2x there is
 * nothing, and a fractional step there would smear the very pattern M15 went
 * to the file to get right.
 *
 * Below 1x the rule has to give way, because the alternative is not a fuzzy
 * canvas but a canvas wider than the screen: Hercules' buffer does not fit a
 * phone at any whole multiple, and before M17 it overflowed one. A shrunk
 * buffer resamples, and that is the honest cost of showing it at all.
 *
 * @param buffer the driver's framebuffer
 * @param box the space available, in CSS pixels
 */
export function fitPresentation(buffer: DisplayBuffer, box: Box): Presentation {
  const shown = buffer.width * buffer.pixelAspect;
  if (shown <= 0 || buffer.height <= 0 || box.width <= 0 || box.height <= 0) {
    return { width: 0, height: 0, scale: 0, whole: false };
  }

  const fit = Math.min(box.width / shown, box.height / buffer.height);
  const scale = fit >= 1 ? Math.floor(fit) : fit;

  return {
    width: Math.floor(shown * scale),
    height: Math.floor(buffer.height * scale),
    scale,
    whole: Number.isInteger(scale),
  };
}

/**
 * The smallest stage the page will squeeze the canvas into.
 *
 * A viewport short enough that the chrome leaves less than this gets a page
 * that scrolls rather than a canvas nobody can see. The stylesheet's stage row
 * holds the same floor, and this is the number it holds.
 */
export const MIN_STAGE_HEIGHT = 180;

export class CanvasView {
  readonly element: HTMLCanvasElement;

  #stage: HTMLElement;
  #context: CanvasRenderingContext2D;
  #image: ImageData;
  #rgba: Uint8ClampedArray;
  #onResize: () => void;
  #observer: ResizeObserver | undefined;

  /** The buffer size and aspect the backing store was last made for. */
  #width = 0;
  #height = 0;
  #aspect = 1;

  /** The size last written to the element's style, so it is written once. */
  #shownWidth = 0;
  #shownHeight = 0;

  constructor(parent: HTMLElement) {
    this.#stage = parent;

    this.element = document.createElement('canvas');
    this.element.className = 'shell__canvas';

    const context = this.element.getContext('2d', { alpha: false });
    if (!context) throw new Error('this browser has no 2D canvas context');
    context.imageSmoothingEnabled = false;

    this.#context = context;
    // Replaced by the first #resize, which is what learns the driver's size.
    this.#image = context.createImageData(1, 1);
    this.#rgba = this.#image.data;

    parent.append(this.element);

    this.#onResize = () => this.fit();
    window.addEventListener('resize', this.#onResize);

    // The window is not the only thing that changes the stage: the developer
    // panel opening, the error box appearing and the controls wrapping to a
    // second row all take height from it, and none of them is a window resize.
    if (typeof ResizeObserver !== 'undefined') {
      this.#observer = new ResizeObserver(() => this.fit());
      this.#observer.observe(parent);
    }
  }

  /** Size the element to the largest the stage can hold it at. */
  fit(): void {
    if (this.#width === 0) return;

    const shown = fitPresentation(
      { width: this.#width, height: this.#height, pixelAspect: this.#aspect },
      this.#box(),
    );
    if (shown.width === 0) return;
    if (shown.width === this.#shownWidth && shown.height === this.#shownHeight) return;

    this.#shownWidth = shown.width;
    this.#shownHeight = shown.height;
    this.element.style.width = `${shown.width}px`;
    this.element.style.height = `${shown.height}px`;
  }

  /** Blit whatever the driver last drew. */
  present(driver: DisplayDriver): void {
    this.#resize(driver);
    driver.toRgba(this.#rgba);
    this.#context.putImageData(this.#image, 0, 0);
  }

  dispose(): void {
    window.removeEventListener('resize', this.#onResize);
    this.#observer?.disconnect();
    this.element.remove();
  }

  /**
   * The space the stage has, measured rather than derived from the window.
   *
   * The stage is a grid row the stylesheet gives whatever the page's chrome
   * leaves, so measuring it is what makes the canvas answer to the controls
   * wrapping or the developer panel opening. It cannot feed back into itself:
   * the row's height is the grid's to decide, and the canvas is clipped to it.
   */
  #box(): Box {
    const width = this.#stage.clientWidth;
    const height = this.#stage.clientHeight;
    if (width > 0 && height > 0) return { width, height };

    // Before the first layout, or in a stage the page has not sized yet.
    return {
      width: Math.max(1, window.innerWidth),
      height: Math.max(MIN_STAGE_HEIGHT, window.innerHeight - 200),
    };
  }

  /** Re-make the backing store when the driver's buffer is a different size. */
  #resize(driver: DisplayDriver): void {
    const { width, height } = driver.display;
    if (width === this.#width && height === this.#height && driver.pixelAspect === this.#aspect) {
      return;
    }

    this.#width = width;
    this.#height = height;
    this.#aspect = driver.pixelAspect;

    this.element.width = width;
    this.element.height = height;
    // A fresh ImageData rather than a resized one: its buffer is fixed at the
    // size it was made with, and toRgba writes the whole of it.
    this.#image = this.#context.createImageData(width, height);
    this.#rgba = this.#image.data;
    this.#context.imageSmoothingEnabled = false;

    this.fit();
  }
}
