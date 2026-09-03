/**
 * What the player has chosen, and how it is remembered.
 *
 * Distinct from a saved game: this is about the machine the game is played on
 * rather than about the game. It therefore belongs to the browser rather than
 * to a slot, and outlives any particular game.
 *
 * A setting that has to be made again on every visit is a setting people stop
 * using, so these are written down -- and a browser that will not keep them is
 * not worth interrupting anyone over, so failing to write them is quiet. That
 * is the opposite of the rule for saved games, and deliberately: one is a
 * preference, the other is somebody's evening.
 */
import type { SoundChip } from '../audio/output.ts';
import type { DisplayMode } from '../render/drivers/driver.ts';
import type { KeyValueStore } from '../storage/saves.ts';

/**
 * Which display the game is drawn as.
 *
 * Three of the four the original shipped: the game's own directory holds
 * `CGA_GRAF.OVL`, `EGA_GRAF.OVL`, `HGC_GRAF.OVL` and `JR_GRAF.OVL`, and the
 * last of those has no counterpart here because a PCjr cannot look or behave
 * differently from an EGA in this game -- see `engine/hardware.ts`. The list is
 * the renderer's, not the shell's: a mode *is* a driver, and a setting that
 * named modes the renderer had never heard of would be a second vocabulary to
 * keep in step.
 */
export type GraphicsMode = DisplayMode;

export interface Settings {
  graphics: GraphicsMode;
  sound: SoundChip;
}

const KEY = 'web-agi:settings';

/**
 * What a player gets before they choose anything.
 *
 * The PCjr rather than the speaker: the engine has always played four voices,
 * and agreeing *downwards* would take away half the notes of a game most people
 * remember with them.
 */
export const DEFAULT_SETTINGS: Settings = { graphics: 'ega', sound: 'pcjr' };

// Three, and a stored `pcjr` from before the PCjr was dropped falls back to
// the default like any other value this list does not hold. `pick` is what
// makes removing a mode safe rather than a reason to migrate storage.
const GRAPHICS: GraphicsMode[] = ['cga', 'ega', 'hercules'];
const SOUND: SoundChip[] = ['speaker', 'pcjr'];

/** Read the settings back, falling back to the defaults for anything odd. */
export function loadSettings(storage: KeyValueStore | null): Settings {
  const text = storage?.getItem(KEY);
  if (!text) return { ...DEFAULT_SETTINGS };

  try {
    const stored = JSON.parse(text) as Partial<Settings>;
    return {
      // Checked rather than trusted: this is a value a person can edit, and a
      // graphics mode that does not exist would be an engine that cannot draw.
      graphics: pick(GRAPHICS, stored.graphics, DEFAULT_SETTINGS.graphics),
      sound: pick(SOUND, stored.sound, DEFAULT_SETTINGS.sound),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Write the settings down. A browser that refuses is not worth a fuss. */
export function saveSettings(storage: KeyValueStore | null, settings: Settings): void {
  try {
    storage?.setItem(KEY, JSON.stringify(settings));
  } catch {
    // A preference that could not be kept costs the player one click next time.
  }
}

function pick<T extends string>(allowed: T[], value: unknown, fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}
