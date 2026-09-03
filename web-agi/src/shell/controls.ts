/**
 * The shell's own controls: the settings the *player* chooses, as opposed to
 * the ones the game's menus offer.
 *
 * One of them names something the engine cannot do yet. That is deliberate
 * rather than an oversight: the choice is typed and kept where the others are,
 * so that building it later is a matter of reading a value instead of inventing
 * where the value lives. Until then it says plainly that nothing has changed on
 * screen, which is better than a control that silently does nothing.
 *
 * The two sound controls are real. The chip switch changes what is played --
 * one voice or four -- and what the scripts are told they are being played on;
 * the on/off switch sets the same flag the game's own F2 sets, so the two
 * cannot disagree.
 */
import type { SoundChip } from '../audio/output.ts';
import type { GraphicsMode, Settings } from './settings.ts';

export const GRAPHICS_MODES: { value: GraphicsMode; label: string }[] = [
  { value: 'ega', label: 'EGA' },
  { value: 'cga', label: 'CGA' },
  { value: 'pcjr', label: 'PCjr' },
  { value: 'hercules', label: 'Hercules' },
];

export const SOUND_CHIPS: { value: SoundChip; label: string }[] = [
  { value: 'speaker', label: 'PC speaker' },
  { value: 'pcjr', label: 'PCjr / Tandy' },
];

export interface ControlsOptions {
  /** The settings to start from; the controls write their choices into it. */
  settings: Settings;
  /** Called after any choice, so it can be acted on and remembered. */
  onChange: (settings: Settings) => void;
  /** Whether the game's sound is currently on, which the game can change too. */
  isSoundOn: () => boolean;
  /** Turn the game's sound off, or on again. */
  toggleSound: () => void;
  /** Say something to the player: what changed, or what has not been built. */
  say: (text: string) => void;
}

/**
 * The row of controls under the canvas.
 *
 * Everything here hands focus straight back: a control left focused would eat
 * the next keypress instead of walking ego.
 */
export class Controls {
  #options: ControlsOptions;
  #soundButton: HTMLButtonElement;

  constructor(parent: HTMLElement, options: ControlsOptions) {
    this.#options = options;

    parent.append(
      this.#select('Graphics', GRAPHICS_MODES, options.settings.graphics, (value) => {
        options.settings.graphics = value;
        options.onChange(options.settings);
        options.say(
          value === 'ega'
            ? 'graphics: EGA'
            : `graphics: ${labelOf(GRAPHICS_MODES, value)} is chosen, but is not built yet — still drawing EGA`,
        );
      }),
    );

    parent.append(
      this.#select('Sound', SOUND_CHIPS, options.settings.sound, (value) => {
        options.settings.sound = value;
        options.onChange(options.settings);
        options.say(
          value === 'speaker'
            ? 'sound: PC speaker — one voice, and no volume'
            : 'sound: PCjr / Tandy — three tone voices and noise',
        );
      }),
    );

    this.#soundButton = document.createElement('button');
    this.#soundButton.type = 'button';
    this.#soundButton.addEventListener('click', () => {
      options.toggleSound();
      this.refresh();
      options.say(`sound ${options.isSoundOn() ? 'on' : 'off'}`);
      this.#soundButton.blur();
    });
    parent.append(this.#soundButton);

    this.refresh();
  }

  /**
   * Match the sound button to the game.
   *
   * The game turns its own sound on and off -- F2 and the Options menu do the
   * same thing this button does -- so the label follows the flag rather than
   * remembering what was last pressed here.
   */
  refresh(): void {
    this.#soundButton.textContent = this.#options.isSoundOn() ? 'Sound: on' : 'Sound: off';
  }

  #select<T extends string>(
    label: string,
    choices: { value: T; label: string }[],
    current: T,
    onChange: (value: T) => void,
  ): HTMLElement {
    const wrapper = document.createElement('label');
    wrapper.className = 'shell__choice';
    wrapper.append(`${label}: `);

    const select = document.createElement('select');
    for (const choice of choices) {
      const option = document.createElement('option');
      option.value = choice.value;
      option.textContent = choice.label;
      option.selected = choice.value === current;
      select.append(option);
    }

    select.addEventListener('change', () => {
      onChange(select.value as T);
      select.blur();
    });

    wrapper.append(select);
    return wrapper;
  }
}

function labelOf<T extends string>(choices: { value: T; label: string }[], value: T): string {
  return choices.find((choice) => choice.value === value)?.label ?? value;
}
