/**
 * Composing the screens into the display buffer.
 *
 * Kept free of the DOM: the result is a byte buffer, so what the engine draws
 * can be asserted in a test. Only presenting it needs a canvas.
 */
import { Display, PICTURE_TOP } from './display.ts';
import { Screens } from './screens.ts';

/** Which of the two screens to show. */
export type ScreenView = 'visual' | 'priority';

/** What the display holds outside the picture area before anything is drawn. */
const CHROME_COLOUR = 0;

export class Renderer {
  readonly display = new Display();

  /**
   * Which screen is composed. The priority screen is a debugging view: it is
   * never shown during play, but occlusion and blocking problems are close to
   * invisible without it.
   */
  view: ScreenView = 'visual';

  /** Draw the current screens into the display buffer. */
  compose(screens: Screens): void {
    // Black behind the status line and the input area. The text layer draws
    // over both; this is what shows where it has written nothing.
    this.display.fill(CHROME_COLOUR);
    this.display.drawScreen(this.view === 'visual' ? screens.visual : screens.priority, PICTURE_TOP);
  }

  /** Switch between the visual and priority screens. */
  toggleView(): ScreenView {
    this.view = this.view === 'visual' ? 'priority' : 'visual';
    return this.view;
  }
}
