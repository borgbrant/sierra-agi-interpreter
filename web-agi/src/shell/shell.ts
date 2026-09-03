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
    background: #171511;
    color: #ece6d8;
    font: 14px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .shell {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 14px 16px 20px;
    box-sizing: border-box;
  }
  .shell__title {
    font-size: 12px;
    letter-spacing: .08em;
    text-transform: uppercase;
    color: #b9985b;
    margin: 0;
  }
  .shell__stage { width: 100%; display: flex; align-items: center; justify-content: center; }
  .shell__controls {
    width: min(960px, 100%);
    display: flex;
    gap: 18px;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    padding: 6px 0;
    border-top: 1px solid #3b3022;
    border-bottom: 1px solid #3b3022;
  }
  .shell__control-group { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: center; }
  .shell__group { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: center; }
  .shell__group-title {
    font-size: 11px;
    letter-spacing: .08em;
    text-transform: uppercase;
    color: #8f8372;
  }
  .shell__choice {
    font-size: 13px;
    color: #cabfae;
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .shell select,
  .shell button {
    font: inherit;
    font-size: 13px;
    color: #ece6d8;
    background: #242018;
    border: 1px solid #584732;
    border-radius: 4px;
  }
  .shell select { padding: 4px 7px; }
  .shell button { padding: 5px 10px; cursor: pointer; }
  .shell button:hover { border-color: #8d7044; background: #2d271d; }
  .shell button:disabled { cursor: default; color: #7e7567; border-color: #3b3022; }
  .shell__status {
    min-height: 1.5em;
    color: #9bd28f;
    text-align: center;
  }
  .shell__help {
    width: min(760px, 100%);
    display: grid;
    gap: 2px;
    color: #beb4a4;
    text-align: center;
  }
  .shell__help p { margin: 0; }
  .shell__developer {
    width: min(960px, 100%);
    border-top: 1px solid #3b3022;
    padding-top: 8px;
    color: #a99f8f;
  }
  .shell__developer summary { width: fit-content; cursor: pointer; color: #b9985b; }
  .shell__developer-body { margin-top: 8px; display: grid; gap: 8px; }
  .shell__developer-status {
    min-height: 1.45em;
    font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    color: #8f8372;
  }
  .shell__debug-tools { display: flex; gap: 8px; flex-wrap: wrap; }
  .shell__log {
    max-height: 34vh;
    overflow: auto;
    margin: 0;
    padding: 10px 12px;
    border: 1px solid #31291f;
    background: #0f0e0c;
    white-space: pre-wrap;
    word-break: break-word;
    color: #b7b0a4;
    font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  .shell__log p { margin: 0 0 2px; }
  .shell__error {
    width: min(760px, 100%); margin: 0; padding: 12px 14px; box-sizing: border-box;
    border: 1px solid #7a2530; border-radius: 6px; background: #24141a; color: #f2b8bf;
    white-space: pre-wrap; word-break: break-word;
  }
  .shell__error strong { display: block; margin-bottom: 6px; color: #ff9aa6; }
`;

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
  #developer: HTMLDetailsElement;
  #developerStatus: HTMLElement;

  constructor(root: HTMLElement) {
    root.replaceChildren();
    root.className = 'shell';

    const style = document.createElement('style');
    style.textContent = STYLE;

    const title = document.createElement('h1');
    title.className = 'shell__title';
    title.textContent = 'Leisure Suit Larry 1 / web-agi';

    this.stage = document.createElement('div');
    this.stage.className = 'shell__stage';

    const controls = document.createElement('div');
    controls.className = 'shell__controls';

    this.settingsTools = document.createElement('div');
    this.settingsTools.className = 'shell__group';

    this.saveTools = document.createElement('div');
    this.saveTools.className = 'shell__group';
    controls.append(controlGroup('Settings', this.settingsTools), controlGroup('Saves', this.saveTools));

    this.#status = document.createElement('div');
    this.#status.className = 'shell__status';

    this.#help = document.createElement('div');
    this.#help.className = 'shell__help';

    this.#log = document.createElement('div');
    this.#log.className = 'shell__log';

    this.#errors = document.createElement('div');

    this.#developer = document.createElement('details');
    this.#developer.className = 'shell__developer';
    const summary = document.createElement('summary');
    summary.textContent = 'Developer';

    const developerBody = document.createElement('div');
    developerBody.className = 'shell__developer-body';

    this.debugTools = document.createElement('div');
    this.debugTools.className = 'shell__debug-tools';

    this.#developerStatus = document.createElement('div');
    this.#developerStatus.className = 'shell__developer-status';

    developerBody.append(this.debugTools, this.#developerStatus, this.#log);
    this.#developer.append(summary, developerBody);

    root.append(style, title, this.stage, controls, this.#status, this.#help, this.#errors, this.#developer);
  }

  /**
   * Replace the one-line status. Unlike the log this does not grow, so a
   * message that changes on every keypress does not fill the page.
   */
  setStatus(text: string): void {
    this.#status.textContent = text;
  }

  /** Replace the player-facing help text. */
  setHelp(lines: readonly string[]): void {
    this.#help.replaceChildren();
    for (const line of lines) {
      const paragraph = document.createElement('p');
      paragraph.textContent = line;
      this.#help.append(paragraph);
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

function groupTitle(text: string): HTMLElement {
  const title = document.createElement('span');
  title.className = 'shell__group-title';
  title.textContent = text;
  return title;
}

function controlGroup(title: string, body: HTMLElement): HTMLElement {
  const group = document.createElement('div');
  group.className = 'shell__control-group';
  group.append(groupTitle(title), body);
  return group;
}
