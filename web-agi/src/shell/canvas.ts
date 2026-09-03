/**
 * The canvas the display buffer is presented on.
 *
 * The backing store stays at the display's own 320x200 and CSS scales it by a
 * whole number, so pixels stay square and sharp rather than being resampled.
 */
import { DISPLAY_HEIGHT, DISPLAY_WIDTH, type Display } from '../render/display.ts';

export class CanvasView {
  readonly element: HTMLCanvasElement;

  #context: CanvasRenderingContext2D;
  #image: ImageData;
  #rgba: Uint8ClampedArray;
  #onResize: () => void;

  constructor(parent: HTMLElement) {
    this.element = document.createElement('canvas');
    this.element.width = DISPLAY_WIDTH;
    this.element.height = DISPLAY_HEIGHT;
    this.element.style.imageRendering = 'pixelated';
    this.element.style.display = 'block';
    this.element.style.background = '#000';

    const context = this.element.getContext('2d', { alpha: false });
    if (!context) throw new Error('this browser has no 2D canvas context');
    context.imageSmoothingEnabled = false;

    this.#context = context;
    this.#image = context.createImageData(DISPLAY_WIDTH, DISPLAY_HEIGHT);
    this.#rgba = this.#image.data;

    parent.append(this.element);

    this.#onResize = () => this.fit();
    window.addEventListener('resize', this.#onResize);
    this.fit();
  }

  /** Size the element to the largest whole multiple that fits the window. */
  fit(): void {
    const available = Math.max(1, Math.min(window.innerWidth - 32, 1280));
    const scale = Math.max(1, Math.floor(available / DISPLAY_WIDTH));
    this.element.style.width = `${DISPLAY_WIDTH * scale}px`;
    this.element.style.height = `${DISPLAY_HEIGHT * scale}px`;
  }

  /** Blit a display buffer to the canvas. */
  present(display: Display): void {
    display.toRgba(this.#rgba);
    this.#context.putImageData(this.#image, 0, 0);
  }

  dispose(): void {
    window.removeEventListener('resize', this.#onResize);
    this.element.remove();
  }
}
