/**
 * The DOM around the engine: a place for the canvas, the player's controls, a
 * status line, and a surface that shows failures instead of hiding them in the
 * console.
 *
 * Thin, but not unconsidered. M14 separated what a player needs to know from
 * what a developer needs to see; M17 is about what that separation *looks*
 * like, and it works to three rules.
 *
 * **The canvas is the page.** It is the one element given room first: the
 * layout is a grid whose middle row is whatever the chrome leaves, and
 * `canvas.ts` measures that row rather than the window. Everything else is
 * quiet around it.
 *
 * **One set of tokens.** Colour, spacing and type are declared once at the top
 * and used by name, with a light palette beside the dark one and
 * `prefers-color-scheme` choosing. That is not a theme switch: the settings
 * this shell offers are the ones the *game* has, and the operating system
 * already knows this one.
 *
 * **No framework, one page.** Every rule below is in one string, the DOM is
 * built by hand, and the whole of it is a few kilobytes. What this milestone
 * costs, it costs in CSS.
 */

const STYLE = `
  :root {
    color-scheme: light dark;

    --bg: #f4efe4;
    --surface: #fffdf7;
    --surface-sunk: #e8e0cd;
    --line: #d6cab1;
    --line-strong: #b9a884;
    --ink: #241f17;
    --ink-dim: #6b6153;
    --accent: #8a5512;
    --accent-line: #b9884a;
    --good: #2c6538;
    --bad: #8c1f2a;
    --bad-line: #d9a2a6;
    --bad-surface: #fdeeec;
    --frame: #0b0b0c;

    --space-1: 4px;
    --space-2: 8px;
    --space-3: 12px;
    --space-4: 18px;
    --space-5: 28px;

    --text-xs: 11px;
    --text-sm: 13px;
    --text-md: 14px;
    --text-lg: 17px;

    --radius: 8px;
    --radius-sm: 5px;

    --sans: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;

    --stage-min: 180px;
  }

  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #14120f;
      --surface: #1e1b15;
      --surface-sunk: #100f0c;
      --line: #332b20;
      --line-strong: #574731;
      --ink: #ece6d8;
      --ink-dim: #9b9284;
      --accent: #e3b269;
      --accent-line: #7c6134;
      --good: #93cf88;
      --bad: #f2b8bf;
      --bad-line: #7a2530;
      --bad-surface: #241419;
      --frame: #000;
    }
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    background: var(--bg);
    color: var(--ink);
    font: var(--text-md)/1.5 var(--sans);
    -webkit-text-size-adjust: 100%;
  }

  .shell {
    /* Both, in this order: a browser that does not know dvh keeps vh, and one
       that does overrides it. A dropped declaration here is not cosmetic --
       without a definite height the stage row is sized by its content, which
       is the canvas, which is sized from the row. */
    min-height: 100vh;
    min-height: 100dvh;
    display: grid;
    grid-template-rows: auto minmax(var(--stage-min), 1fr) auto;
    gap: var(--space-2);
    padding-bottom: var(--space-3);
  }

  /* The header and the chrome are padded; the stage is not, because the
     canvas grows in whole multiples and 32px of padding is the difference
     between Hercules at 2x and Hercules at 1x on a 1440-wide screen. */
  .shell__header,
  .shell__chrome { padding-inline: clamp(var(--space-3), 3vw, var(--space-5)); }

  /* Every row of chrome is height the canvas does not get, and the numbers
     are unforgiving: Hercules at 2x is 696 pixels tall, so on a 1440x900
     laptop the whole page around the stage has to fit in 204 of them or that
     mode drops to 1x and is presented at half the size of the others. That is
     why the status line is up here beside the title rather than on a row of
     its own, and why there are three rows in total. */
  .shell__header {
    display: flex;
    align-items: baseline;
    gap: var(--space-2) var(--space-4);
    flex-wrap: wrap;
    padding-top: var(--space-2);
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--line);
  }
  .shell__title {
    margin: 0;
    font-size: var(--text-md);
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .shell__title span {
    font-size: var(--text-xs);
    font-weight: 500;
    letter-spacing: .09em;
    text-transform: uppercase;
    color: var(--accent);
  }
  .shell__named {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .shell__mark {
    margin: 0;
    font: var(--text-xs)/1 var(--mono);
    letter-spacing: .08em;
    text-transform: uppercase;
    color: var(--ink-dim);
  }

  /* The canvas is taken out of the flow, and this is the load-bearing rule of
     the whole layout: it is sized from the stage, so the stage must not be
     sized from it. In the flow the two chase each other -- the canvas shrinks
     the row, the row shrinks the canvas -- and they settle at whichever fixed
     point they reach first, which is how Hercules came out at 1x on a screen
     with room for 2x. Out of the flow the row's height is the grid's alone. */
  .shell__stage {
    position: relative;
    min-height: 0;
    overflow: hidden;
  }
  .shell__canvas {
    position: absolute;
    inset: 0;
    margin: auto;
    image-rendering: pixelated;
    background: var(--frame);
    border-radius: 2px;
    box-shadow: 0 0 0 1px var(--line-strong), 0 12px 32px -18px #000;
  }
  .shell__loading {
    position: absolute;
    inset: 0;
    margin: auto;
    height: fit-content;
    display: grid;
    gap: var(--space-2);
    justify-items: center;
    color: var(--ink-dim);
    font: var(--text-sm)/1.5 var(--mono);
  }
  .shell__loading::before {
    content: "";
    width: 96px;
    height: 3px;
    border-radius: 2px;
    background:
      linear-gradient(90deg, var(--accent) 0 33%, transparent 33% 100%) var(--line);
    background-size: 300% 100%;
    animation: shell-loading 1.1s linear infinite;
  }
  @keyframes shell-loading { to { background-position: -300% 0; } }
  @media (prefers-reduced-motion: reduce) {
    .shell__loading::before { animation: none; background-position: 0 0; }
  }

  .shell__chrome {
    display: grid;
    gap: var(--space-2);
    justify-items: center;
  }

  /* The controls and the keys on one row: two rows of chrome rather than
     four, and on a wide screen they sit at either end of the same line. */
  .shell__bar {
    width: 100%;
    max-width: 1100px;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-5);
    align-items: end;
    justify-content: center;
  }

  .shell__controls {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-4);
    align-items: end;
    justify-content: center;
  }
  .shell__group {
    display: grid;
    gap: var(--space-1);
    justify-items: start;
  }
  .shell__group-title {
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: .09em;
    text-transform: uppercase;
    color: var(--ink-dim);
  }
  /* End, not centre: the selects carry a caption above them and the sound
     button does not, so centring lines the button up with the middle of a
     taller item and it floats above the row it belongs to. */
  .shell__group-body {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: end;
  }
  .shell__choice {
    display: inline-grid;
    gap: 2px;
    font-size: var(--text-xs);
    color: var(--ink-dim);
  }

  .shell select,
  .shell button {
    font: var(--text-sm)/1.4 var(--sans);
    color: var(--ink);
    background: var(--surface);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    padding: 6px 10px;
    min-height: 34px;
  }
  .shell select { padding-inline: 8px 6px; }
  .shell button { cursor: pointer; }
  .shell select:hover,
  .shell button:hover { border-color: var(--accent-line); }
  .shell button:active { background: var(--surface-sunk); }
  .shell button:disabled { cursor: default; color: var(--ink-dim); border-color: var(--line); }

  /* The game keeps the keyboard, so every control hands focus straight back
     -- see controls.ts. A visible ring is what is owed in return: a keyboard
     user has to be able to see where they are while they are there. */
  .shell :focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .shell__status {
    margin: 0 0 0 auto;
    max-width: 62ch;
    text-align: right;
    font-size: var(--text-xs);
    color: var(--good);
  }

  .shell__help {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-3);
    align-items: center;
    justify-content: center;
    font-size: var(--text-xs);
    color: var(--ink-dim);
  }
  .shell__help-row { display: flex; align-items: center; gap: 5px; }
  .shell__help-note { flex-basis: 100%; text-align: center; max-width: 70ch; }
  .shell__keys { display: inline-flex; gap: 3px; }
  .shell kbd {
    font: 11px/1 var(--mono);
    color: var(--ink);
    background: var(--surface);
    border: 1px solid var(--line-strong);
    border-bottom-width: 2px;
    border-radius: 4px;
    padding: 4px 5px;
    min-width: 1.6em;
    text-align: center;
  }

  /* Said once, on the screens where it is true, and by the stylesheet rather
     than by a script: the game is typed at, and no width makes that untrue. */
  .shell__keyboard { display: none; }
  @media (max-width: 640px) {
    .shell__keyboard {
      display: block;
      margin: 0;
      max-width: 46ch;
      text-align: center;
      font-size: var(--text-sm);
      color: var(--ink-dim);
    }
    .shell__bar,
    .shell__controls { flex-direction: column; align-items: stretch; }
    .shell__title, .shell__status { text-align: left; }
    .shell__group { justify-items: stretch; }
    .shell__group-body > * { flex: 1 1 auto; }
    .shell select, .shell button { min-height: 40px; }
  }

  .shell__errors { width: 100%; max-width: 760px; display: grid; gap: var(--space-2); }
  .shell__errors:empty { display: none; }
  .shell__error {
    margin: 0;
    padding: var(--space-3);
    border: 1px solid var(--bad-line);
    border-radius: var(--radius);
    background: var(--bad-surface);
    color: var(--bad);
    white-space: pre-wrap;
    word-break: break-word;
    font-size: var(--text-sm);
  }
  .shell__error strong { display: block; margin-bottom: var(--space-1); }

  /* In the header, and opening *over* the stage rather than below it. Two
     reasons, and the second is the one that decided it: a panel in the flow
     costs the canvas 42 pixels of height whether or not anyone opens it, and
     a developer surface should not be able to resize the thing being
     debugged. */
  .shell__developer {
    position: relative;
    font-size: var(--text-sm);
    color: var(--ink-dim);
  }
  .shell__developer summary {
    cursor: pointer;
    list-style: none;
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: .09em;
    text-transform: uppercase;
    color: var(--accent);
  }
  .shell__developer summary::-webkit-details-marker { display: none; }
  .shell__developer summary:hover { border-color: var(--accent-line); }
  .shell__developer-body {
    position: absolute;
    z-index: 5;
    top: calc(100% + var(--space-1));
    right: 0;
    width: min(680px, calc(100vw - 2 * var(--space-3)));
    padding: var(--space-3);
    display: grid;
    gap: var(--space-2);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: 0 18px 40px -24px #000;
  }
  .shell__developer-status {
    min-height: 1.45em;
    font: var(--text-xs)/1.45 var(--mono);
    color: var(--ink-dim);
  }
  .shell__debug-tools { display: flex; gap: var(--space-2); flex-wrap: wrap; }
  .shell__log {
    max-height: min(34vh, 320px);
    overflow: auto;
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface-sunk);
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--ink);
    font: var(--text-xs)/1.5 var(--mono);
  }
  .shell__log p { margin: 0 0 2px; }
`;

/**
 * One line of the player's help: the keys, and what they do.
 *
 * Keys as data rather than as prose. Four sentences with eight key names
 * inside them is what M14 shipped, and a player scanning for "how do I open
 * the inventory" had to read all four.
 */
export interface HelpKeys {
  keys: readonly string[];
  does: string;
}

/** A line of help: keys with a caption, or a sentence that stands alone. */
export type HelpLine = HelpKeys | string;

/** Where the engine mounts, and where failures surface. */
export class Shell {
  readonly stage: HTMLElement;

  /** Settings the player can change while the game runs. */
  readonly settingsTools: HTMLElement;

  /** Save-file actions, kept apart from runtime settings. */
  readonly saveTools: HTMLElement;

  /** Developer tools, hidden behind the developer panel. */
  readonly debugTools: HTMLElement;

  #status: HTMLElement;
  #help: HTMLElement;
  #log: HTMLElement;
  #errors: HTMLElement;
  #loading: HTMLElement | null;
  #developer: HTMLDetailsElement;
  #developerStatus: HTMLElement;

  constructor(root: HTMLElement) {
    root.replaceChildren();
    root.className = 'shell';

    const style = document.createElement('style');
    style.textContent = STYLE;

    this.#status = document.createElement('p');
    this.#status.className = 'shell__status';
    this.#status.setAttribute('role', 'status');

    this.#log = document.createElement('div');
    this.#log.className = 'shell__log';

    this.debugTools = document.createElement('div');
    this.debugTools.className = 'shell__debug-tools';

    this.#developerStatus = document.createElement('div');
    this.#developerStatus.className = 'shell__developer-status';

    this.#developer = document.createElement('details');
    this.#developer.className = 'shell__developer';
    const summary = document.createElement('summary');
    summary.textContent = 'Developer';

    const developerBody = document.createElement('div');
    developerBody.className = 'shell__developer-body';
    developerBody.append(this.debugTools, this.#developerStatus, this.#log);
    this.#developer.append(summary, developerBody);

    root.append(style, this.#header());

    this.stage = document.createElement('main');
    this.stage.className = 'shell__stage';

    // Something in the stage from the first paint of the page, because loading
    // the game takes long enough to look like nothing happening.
    this.#loading = document.createElement('div');
    this.#loading.className = 'shell__loading';
    this.#loading.textContent = 'starting';
    this.stage.append(this.#loading);

    const chrome = document.createElement('footer');
    chrome.className = 'shell__chrome';

    this.settingsTools = document.createElement('div');
    this.settingsTools.className = 'shell__group-body';

    this.saveTools = document.createElement('div');
    this.saveTools.className = 'shell__group-body';

    const controls = document.createElement('div');
    controls.className = 'shell__controls';
    controls.append(
      controlGroup('The machine', this.settingsTools),
      controlGroup('Saved games', this.saveTools),
    );

    this.#help = document.createElement('div');
    this.#help.className = 'shell__help';

    const keyboard = document.createElement('p');
    keyboard.className = 'shell__keyboard';
    keyboard.textContent =
      'This is a keyboard game: Larry is walked with the arrow keys and told what to do by typing. A phone can watch it, but not play it.';

    this.#errors = document.createElement('div');
    this.#errors.className = 'shell__errors';

    const bar = document.createElement('div');
    bar.className = 'shell__bar';
    bar.append(controls, this.#help);

    chrome.append(bar, keyboard, this.#errors);
    root.append(this.stage, chrome);
  }

  /** What the page is called, in the game's own words rather than the repo's. */
  #header(): HTMLElement {
    const header = document.createElement('header');
    header.className = 'shell__header';

    const title = document.createElement('h1');
    title.className = 'shell__title';
    const subtitle = document.createElement('span');
    subtitle.textContent = 'in the Land of the Lounge Lizards';
    title.append('Leisure Suit Larry ', subtitle);

    const mark = document.createElement('p');
    mark.className = 'shell__mark';
    mark.textContent = 'web-agi';

    // The name and the mark are one thing; the status is the other end of the
    // line, so a message about the last thing the shell did never pushes the
    // title around.
    const named = document.createElement('div');
    named.className = 'shell__named';
    named.append(title, mark);

    header.append(named, this.#status, this.#developer);
    return header;
  }

  /**
   * Say which part of loading is happening, in the stage the canvas will take.
   *
   * The game is four megabytes of resources, a font, a dither table and a
   * first cycle before there is anything to see, and a page that says nothing
   * for that long is a page that looks broken.
   */
  setLoading(text: string): void {
    if (this.#loading) this.#loading.textContent = text;
  }

  /** The canvas has something on it; the placeholder is in the way. */
  clearLoading(): void {
    this.#loading?.remove();
    this.#loading = null;
  }

  /**
   * Replace the one-line status. Unlike the log this does not grow, so a
   * message that changes on every keypress does not fill the page.
   */
  setStatus(text: string): void {
    this.#status.textContent = text;
  }

  /**
   * Replace the player-facing help.
   *
   * Keys are drawn as keys. A row of key caps is scanned rather than read,
   * which is what someone looking for one shortcut is doing.
   */
  setHelp(lines: readonly HelpLine[]): void {
    this.#help.replaceChildren();

    for (const line of lines) {
      const row = document.createElement('div');

      if (typeof line === 'string') {
        row.className = 'shell__help-row shell__help-note';
        row.textContent = line;
        this.#help.append(row);
        continue;
      }

      row.className = 'shell__help-row';

      const keys = document.createElement('span');
      keys.className = 'shell__keys';
      for (const key of line.keys) {
        const cap = document.createElement('kbd');
        cap.textContent = key;
        keys.append(cap);
      }

      const does = document.createElement('span');
      does.textContent = line.does;

      row.append(keys, does);
      this.#help.append(row);
    }
  }

  /** Append a line of status text. */
  log(text: string): void {
    const line = document.createElement('p');
    line.textContent = text;
    this.#log.append(line);
  }

  /** Replace all status text with these lines. */
  setLog(lines: readonly string[]): void {
    this.#log.replaceChildren();
    for (const line of lines) this.log(line);
  }

  /** Replace the one-line developer telemetry. */
  setDeveloperStatus(text: string): void {
    this.#developerStatus.textContent = text;
  }

  /** Whether the developer panel is open. */
  get developerOpen(): boolean {
    return this.#developer.open;
  }

  /** Run when the developer panel is opened or closed. */
  onDeveloperToggle(handler: () => void): () => void {
    this.#developer.addEventListener('toggle', handler);
    return () => this.#developer.removeEventListener('toggle', handler);
  }

  /**
   * Show a failure. Errors are surfaced rather than swallowed: during
   * development a missing resource or an unimplemented opcode is the
   * interesting event, not noise to be hidden.
   */
  showError(what: string, cause?: unknown): void {
    const box = document.createElement('div');
    box.className = 'shell__error';

    const heading = document.createElement('strong');
    heading.textContent = what;
    box.append(heading);

    const detail = describe(cause);
    if (detail) box.append(detail);

    this.#errors.append(box);
    console.error(what, cause);
  }
}

/**
 * Render a thrown value as text, keeping the parts that help: the error code
 * agi-extract attaches, the message, and the stack.
 *
 * @param cause anything that was thrown
 */
function describe(cause: unknown): string {
  if (cause === undefined || cause === null) return '';
  if (!(cause instanceof Error)) return String(cause);

  const code = 'code' in cause && typeof cause.code === 'string' ? `${cause.code}: ` : '';
  const stack = cause.stack ? `\n\n${cause.stack}` : '';
  return `${code}${cause.message}${stack}`;
}

/**
 * Mount the shell into the page and route otherwise-invisible failures into it.
 *
 * @param root the element to take over
 */
export function mountShell(root: HTMLElement): Shell {
  const shell = new Shell(root);

  window.addEventListener('error', (event) => {
    shell.showError('Uncaught error', event.error ?? event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    shell.showError('Unhandled promise rejection', event.reason);
  });

  return shell;
}

function controlGroup(title: string, body: HTMLElement): HTMLElement {
  const group = document.createElement('div');
  group.className = 'shell__group';

  const heading = document.createElement('span');
  heading.className = 'shell__group-title';
  heading.textContent = title;

  group.append(heading, body);
  return group;
}
