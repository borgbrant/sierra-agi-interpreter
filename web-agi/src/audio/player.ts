/**
 * What the engine knows about sound: one sound at a time, and when it is over.
 *
 * The distinction this class draws is the whole of M7's risk. *Audio* is timed
 * on the audio clock, inside {@link SoundOutput}, because a melody must not
 * follow the frame rate. *The flag a script waits on* is timed here, off the
 * engine's own elapsed milliseconds, because that is the clock the game runs
 * on and because it still works when there is no audio at all.
 *
 * Before M7 the sound commands were no-ops that set their flag immediately.
 * That never deadlocked, which is why it was the right placeholder; the risk
 * on the way out of it is a script that waits for a flag nobody will ever set.
 * Every path that ends a sound therefore reports its flag, including the ones
 * that end it early.
 */
import type { Sound } from '../resources/sound.ts';
import { SILENT_OUTPUT, type SoundChip, type SoundOutput } from './output.ts';

interface Playing {
  sound: Sound;
  /** The flag the script is waiting on, or 0 when it asked for none. */
  flag: number;
  remainingMs: number;
}

export class SoundPlayer {
  #output: SoundOutput;
  #playing: Playing | null = null;
  #level = 1;

  /**
   * The machine's sound hardware.
   *
   * A PCjr by default. The engine has always played four voices while telling
   * the game it was a PC speaker, and the two had to be made to agree: agreeing
   * downwards would take away half the notes of a game most people remember
   * with them, so the speaker is a choice made on purpose.
   */
  #chip: SoundChip = 'pcjr';

  constructor(output: SoundOutput = SILENT_OUTPUT) {
    this.#output = output;
  }

  /** Whether a sound is running. */
  get isPlaying(): boolean {
    return this.#playing !== null;
  }

  /** Milliseconds left of the current sound, for the state dump. */
  get remainingMs(): number {
    return this.#playing?.remainingMs ?? 0;
  }

  /**
   * Give the player somewhere to play.
   *
   * Called once the browser has let an AudioContext exist, which is not until
   * the player has pressed a key. Anything that was already playing keeps its
   * timing and simply stays silent, because its flag is already promised.
   */
  setOutput(output: SoundOutput): void {
    this.#output = output;
    output.setVolume(this.#level);
    output.setChip(this.#chip);

    // Whatever is playing has been playing silently, and is handed over where
    // it has got to. The game's theme starts on the first cycle, long before a
    // browser will let a page make a noise, so without this the opening is
    // silent for its whole minute and the first thing ever heard is the sound
    // after it.
    this.#reissue();
  }

  /** How loud, 0 to 1. Timing is deliberately unaffected. */
  setVolume(level: number): void {
    if (level === this.#level) return;
    this.#level = level;
    this.#output.setVolume(level);
    // Not stopping playback: a game whose sound is turned down mid-sound must
    // still take as long over it, or the scripts waiting on it run early and
    // the game's pacing changes with a volume key.
  }

  /** How loud it is now, for the state dump. */
  get volume(): number {
    return this.#level;
  }

  /** Which hardware the game is being played on. */
  get chip(): SoundChip {
    return this.#chip;
  }

  /**
   * Change hardware, including under a sound that is already playing.
   *
   * Timing is untouched, exactly as it is for the volume: what is playing keeps
   * the length it had, so the flag its script is waiting on arrives when it was
   * always going to. Only the voices change, and they change now rather than at
   * the next sound -- a switch made during the theme should be audible in the
   * theme.
   */
  setChip(chip: SoundChip): void {
    if (chip === this.#chip) return;
    this.#chip = chip;
    this.#output.setChip(chip);
    this.#reissue();
  }

  /**
   * Start a sound.
   *
   * A sound already playing is replaced, and its flag is set on the way out --
   * the script that started it is waiting, and nothing else will release it.
   *
   * @returns the flag of the sound this one displaced, or 0
   */
  play(sound: Sound, flag: number): number {
    const displaced = this.#finish();
    this.#output.play(sound);
    this.#playing = { sound, flag, remainingMs: sound.durationMs };
    return displaced;
  }

  /**
   * Stop early, as `stop.sound` does.
   *
   * @returns the flag to set, or 0 if nothing was waiting
   */
  stop(): number {
    this.#output.stop();
    return this.#finish();
  }

  /**
   * Advance the sound by real elapsed time.
   *
   * @returns the flag to set now that the sound has ended, or 0
   */
  tick(elapsedMs: number): number {
    const playing = this.#playing;
    if (!playing) return 0;

    playing.remainingMs -= elapsedMs;
    if (playing.remainingMs > 0) return 0;

    this.#playing = null;
    return playing.flag;
  }

  /**
   * Hand whatever is playing to the output, at the point it has reached.
   *
   * The one operation behind both of the ways sound can change underneath a
   * running game: an audio context that arrives late, and a chip that changes.
   * Neither may move the clock, so the offset comes from the time already spent
   * rather than from anything the output knows.
   */
  #reissue(): void {
    const playing = this.#playing;
    if (playing) {
      this.#output.play(playing.sound, playing.sound.durationMs - playing.remainingMs);
    }
  }

  /** Forget what is playing and report whoever was waiting for it. */
  #finish(): number {
    const flag = this.#playing?.flag ?? 0;
    this.#playing = null;
    return flag;
  }
}
