/**
 * The DOM around the engine: a place for the canvas, a status area, and a
 * surface that shows failures instead of hiding them in the console.
 *
 * Deliberately thin. The engine draws into a canvas; everything here exists so
 * that when something goes wrong there is somewhere for it to say so.
 */

const STYLE = `
  :root { color-scheme: dark; }
  body {
    margin: 0;
    background: #101014;
    color: #d8d8e0;
    font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  .shell { min-height: 100vh; display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 16px; box-sizing: border-box; }
  .shell__title { font-size: 12px; letter-spacing: .12em; text-transform: uppercase; color: #6f6f80; margin: 0; }
  .shell__stage { display: flex; align-items: center; justify-content: center; }
  .shell__status { min-height: 1.5em; color: #6f8fbf; }
  .shell__log { width: min(640px, 100%); margin: 0; white-space: pre-wrap; word-break: break-word; color: #9a9aad; }
  .shell__tools { display: flex; gap: 8px; }
  .shell__tools button {
    font: inherit; font-size: 12px; color: #9a9aad; background: #1b1b22;
    border: 1px solid #33333f; border-radius: 4px; padding: 4px 10px; cursor: pointer;
  }
  .shell__tools button:hover { color: #d8d8e0; border-color: #4a4a5a; }
  .shell__log p { margin: 0 0 2px; }
  .shell__error {
    width: min(640px, 100%); margin: 0; padding: 12px 14px; box-sizing: border-box;
    border: 1px solid #7a2530; border-radius: 6px; background: #24141a; color: #f2b8bf;
    white-space: pre-wrap; word-break: break-word;
  }
  .shell__error strong { display: block; margin-bottom: 6px; color: #ff9aa6; }
`;

/** Where the engine mounts, and where failures surface. */
export class Shell {
  readonly stage: HTMLElement;

  /** Where the shell's own controls go, as opposed to the game's. */
  readonly tools: HTMLElement;

  #status: HTMLElement;
  #log: HTMLElement;
  #errors: HTMLElement;

  constructor(root: HTMLElement) {
    root.replaceChildren();
    root.className = 'shell';

    const style = document.createElement('style');
    style.textContent = STYLE;

    const title = document.createElement('h1');
    title.className = 'shell__title';
    title.textContent = 'web-agi';

    this.stage = document.createElement('div');
    this.stage.className = 'shell__stage';

    this.tools = document.createElement('div');
    this.tools.className = 'shell__tools';

    this.#status = document.createElement('div');
    this.#status.className = 'shell__status';

    this.#log = document.createElement('div');
    this.#log.className = 'shell__log';

    this.#errors = document.createElement('div');

    root.append(style, title, this.stage, this.tools, this.#status, this.#log, this.#errors);
  }

  /**
   * Replace the one-line status. Unlike the log this does not grow, so a
   * message that changes on every keypress does not fill the page.
   */
  setStatus(text: string): void {
    this.#status.textContent = text;
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
