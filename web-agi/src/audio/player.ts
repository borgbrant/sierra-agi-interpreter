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
import { SILENT_OUTPUT, type SoundOutput } from './output.ts';

interface Playing {
  /** The flag the script is waiting on, or 0 when it asked for none. */
  flag: number;
  remainingMs: number;
}

export class SoundPlayer {
  #output: SoundOutput;
  #playing: Playing | null = null;
  #level = 1;

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
    this.#playing = { flag, remainingMs: sound.durationMs };
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

  /** Forget what is playing and report whoever was waiting for it. */
  #finish(): number {
    const flag = this.#playing?.flag ?? 0;
    this.#playing = null;
    return flag;
  }
}
