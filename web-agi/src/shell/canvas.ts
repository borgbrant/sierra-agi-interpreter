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
 */
import type { DisplayDriver } from '../render/drivers/driver.ts';

/**
 * The widest the canvas is allowed to grow, in CSS pixels.
 *
 * 1440 rather than 1280 for one reason: Hercules' buffer is 720 wide, and with
 * a 1280 cap the largest whole multiple that fits is 1, so it would be
 * presented at half the size of every other mode on the same screen. 1440 lets
 * it reach 2x. EGA and CGA are unaffected -- 1440 / 320 is 4.5, and the whole
 * multiple is still 4.
 */
const MAX_WIDTH = 1440;

/** Room left for the page around the canvas. */
const MARGIN = 32;

export class CanvasView {
  readonly element: HTMLCanvasElement;

  #context: CanvasRenderingContext2D;
  #image: ImageData;
  #rgba: Uint8ClampedArray;
  #onResize: () => void;

  /** The buffer size and aspect the backing store was last made for. */
  #width = 0;
  #height = 0;
  #aspect = 1;

  constructor(parent: HTMLElement) {
    this.element = document.createElement('canvas');
    this.element.style.imageRendering = 'pixelated';
    this.element.style.display = 'block';
    this.element.style.background = '#000';

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
  }

  /**
   * Size the element to the largest whole multiple of the buffer that fits.
   *
   * Whole multiples vertically, and the driver's aspect applied horizontally:
   * a stretched pixel cannot be an integer number of screen pixels wide, so the
   * dimension that stays sharp is the one the scale is chosen for.
   */
  fit(): void {
    if (this.#width === 0) return;

    const available = Math.max(1, Math.min(window.innerWidth - MARGIN, MAX_WIDTH));
    const scale = Math.max(1, Math.floor(available / (this.#width * this.#aspect)));
    this.element.style.width = `${Math.round(this.#width * this.#aspect * scale)}px`;
    this.element.style.height = `${this.#height * scale}px`;
  }

  /** Blit whatever the driver last drew. */
  present(driver: DisplayDriver): void {
    this.#resize(driver);
    driver.toRgba(this.#rgba);
    this.#context.putImageData(this.#image, 0, 0);
  }

  dispose(): void {
    window.removeEventListener('resize', this.#onResize);
    this.element.remove();
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
