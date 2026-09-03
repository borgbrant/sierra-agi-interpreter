/**
 * The shell's own controls: the settings the *player* chooses, as opposed to
 * the ones the game's menus offer.
 *
 * Two of them name things the engine cannot do yet. That is deliberate rather
 * than an oversight: the choices exist here, in one place, with one type each,
 * so that building them later is a matter of reading a value instead of
 * inventing where the value lives. Until then they say plainly that nothing has
 * changed on screen, which is better than a control that silently does nothing.
 *
 * The sound switch is different, and is wired up: "off" is a state the engine
 * already has -- the game's own F2 sets the same flag -- so there was nothing to
 * defer.
 */

/**
 * Which display the game is drawn as.
 *
 * The four the original shipped, and it says so itself: the game's own
 * directory holds `CGA_GRAF.OVL`, `EGA_GRAF.OVL`, `HGC_GRAF.OVL` and
 * `JR_GRAF.OVL`, one driver per adapter.
 *
 * The game also branches on which one it is talking to -- it tests the
 * monitor-type variable in twenty-seven places, moving its text rows and, twice,
 * showing a different view. So a mode is two things at once: an adapter's
 * palette to draw with, and an answer the scripts get. Doing only the first
 * would leave a game drawing four colours while its scripts still believe in
 * sixteen.
 */
export type GraphicsMode = 'cga' | 'ega' | 'pcjr' | 'hercules';

/**
 * Which sound hardware the game is played on.
 *
 * The engine plays all four channels of every SOUND resource, which is what a
 * PCjr or a Tandy does. A PC speaker has one voice: it plays the first tone
 * channel and nothing else. The engine currently tells the game it is a PC
 * speaker while sounding like a PCjr, so this is a choice waiting for the two
 * to be made to agree.
 */
export type SoundChip = 'speaker' | 'pcjr';

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

/** What the player has chosen. */
export interface Settings {
  graphics: GraphicsMode;
  sound: SoundChip;
}

export interface ControlsOptions {
  /** The settings to start from; the controls write their choices into it. */
  settings: Settings;
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
        options.say(
          `sound: ${labelOf(SOUND_CHIPS, value)} is chosen, but is not built yet — still playing all four channels`,
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
