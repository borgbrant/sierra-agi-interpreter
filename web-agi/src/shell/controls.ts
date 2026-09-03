/**
 * The shell's own controls: the settings the *player* chooses, as opposed to
 * the ones the game's menus offer.
 *
 * Every control does something now, and two of them do half of what they will.
 * The graphics choice is two things at once: what the game is *drawn* in, and
 * what the game is *told* it is being drawn on. The second half is real for all
 * four modes -- a game told it is on a mono screen lays itself out for one, and
 * a game told it is a PCjr binds different keys -- while the first is real for
 * EGA and the PCjr only, because the PCjr's mode is the palette AGI targets.
 * CGA and Hercules are answered for and drawn in EGA's colours until M12 and
 * M13, and the control says so rather than implying more than it does.
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

/**
 * What choosing each mode actually does, said plainly.
 *
 * A player who picks Hercules and sees EGA colours should be told why, and a
 * player who picks it and sees the game's text move should be told that is the
 * game doing it rather than a glitch.
 */
const GRAPHICS_NOTE: Record<GraphicsMode, string> = {
  ega: 'sixteen colours, and the game laid out for a colour screen',
  pcjr: 'the same sixteen colours; the game binds a PCjr keyboard',
  cga: 'the game told it is on CGA, still drawn in EGA colours until M12',
  hercules: 'the game laid out for a mono screen, still drawn in EGA colours until M13',
};

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
        options.say(`graphics: ${labelOf(GRAPHICS_MODES, value)} — ${GRAPHICS_NOTE[value]}`);
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
