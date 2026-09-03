/**
 * Where sound actually comes out.
 *
 * The engine never talks to WebAudio directly. It holds a {@link SoundOutput},
 * which is an interface for two reasons: the cycle has to behave identically
 * when there is no audio at all -- a suspended context, a headless test -- and
 * the scheduling below is the part that can only be exercised in a browser.
 */
import {
  frequencyOf,
  gainOf,
  NOISE_CHANNEL,
  Sound,
  TICKS_PER_SECOND,
} from '../resources/sound.ts';

export interface SoundOutput {
  /** Start a sound, replacing whatever was playing. */
  play(sound: Sound): void;
  /** Silence immediately. */
  stop(): void;
  /**
   * How loud, from 0 (silent) to 1.
   *
   * Only loudness: timing never depends on it, so a game played silently runs
   * at exactly the speed of one played loud.
   */
  setVolume(level: number): void;
}

/** Does nothing, audibly. Used until the audio context can be created. */
export const SILENT_OUTPUT: SoundOutput = {
  play: () => {},
  stop: () => {},
  setVolume: () => {},
};

/** How loud the whole game is, before the game's own attenuations. */
const MASTER_GAIN = 0.15;

/** Length of the noise buffer, in seconds. Long enough not to sound periodic. */
const NOISE_BUFFER_SECONDS = 2;

/**
 * How fast the noise buffer runs, per shift rate.
 *
 * The chip's three rates divide its clock by 512, 1024 and 2048, so each is
 * half the one before; playing the sample buffer at 1, 1/2 and 1/4 speed keeps
 * that relationship and lands the fastest rate on a bright hiss. Rate 3 means
 * "use tone channel 2's frequency", which the bundled game never asks for; it
 * falls back to the slowest.
 */
const NOISE_PLAYBACK_RATES = [1, 0.5, 0.25, 0.25];

/**
 * Plays SOUND resources through WebAudio.
 *
 * Notes are written as scheduled parameter changes on the audio clock rather
 * than played one at a time from the game cycle. The game's longest sound is
 * nearly a minute, cycles arrive when the browser feels like it, and the two
 * clocks drift; scheduling ahead means the melody is right even when the frame
 * rate is not.
 */
export class WebAudioOutput implements SoundOutput {
  #context: AudioContext;
  #master: GainNode;
  #level = 1;
  #noiseBuffer: AudioBuffer | null = null;
  #playing: AudioScheduledSourceNode[] = [];

  constructor(context: AudioContext) {
    this.#context = context;
    this.#master = context.createGain();
    this.#master.gain.value = MASTER_GAIN;
    this.#master.connect(context.destination);
  }

  setVolume(level: number): void {
    this.#level = Math.max(0, Math.min(1, level));
    this.#master.gain.value = MASTER_GAIN * this.#level;
  }

  play(sound: Sound): void {
    this.stop();

    const context = this.#context;
    const start = context.currentTime;

    sound.channels.forEach((channel, index) => {
      if (channel.notes.length === 0) return;

      const gain = context.createGain();
      gain.gain.value = 0;
      gain.connect(this.#master);

      const source =
        index === NOISE_CHANNEL ? this.#createNoise(channel.notes) : this.#createTone();
      source.connect(gain);

      let at = start;
      for (const note of channel.notes) {
        const seconds = note.durationTicks / TICKS_PER_SECOND;
        const frequency = frequencyOf(note.divisor);

        if (index === NOISE_CHANNEL) {
          // The noise generator has no pitch to set per note; only whether it
          // is audible and how fast it runs, which is fixed when it is built.
          gain.gain.setValueAtTime(gainOf(note.attenuation), at);
        } else if (frequency === null) {
          // Divisor zero is a rest, not a frequency.
          gain.gain.setValueAtTime(0, at);
        } else {
          (source as OscillatorNode).frequency.setValueAtTime(frequency, at);
          gain.gain.setValueAtTime(gainOf(note.attenuation), at);
        }

        at += seconds;
      }

      // Whatever the last note left the gain at, the channel ends silent.
      gain.gain.setValueAtTime(0, at);
      source.start(start);
      source.stop(at);
      this.#playing.push(source);
    });
  }

  stop(): void {
    for (const source of this.#playing) {
      try {
        source.stop();
      } catch {
        // Stopping a node that has already ended is not an error worth having.
      }
      source.disconnect();
    }
    this.#playing = [];
  }

  /** A square wave, which is what the chip produced. */
  #createTone(): OscillatorNode {
    const oscillator = this.#context.createOscillator();
    oscillator.type = 'square';
    return oscillator;
  }

  /**
   * The noise channel, as a looping buffer of random samples.
   *
   * An approximation: the original is a shift register whose periodic mode has
   * an audible pitch to it. What matters for the game is that the crashes and
   * footsteps are noise at roughly the right rate, so the rate is taken from
   * the notes and the shift register is not simulated.
   */
  #createNoise(notes: { noise?: { rate: number } }[]): AudioBufferSourceNode {
    const context = this.#context;
    if (!this.#noiseBuffer) {
      const length = Math.floor(context.sampleRate * NOISE_BUFFER_SECONDS);
      const buffer = context.createBuffer(1, length, context.sampleRate);
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) samples[i] = Math.random() * 2 - 1;
      this.#noiseBuffer = buffer;
    }

    const source = context.createBufferSource();
    source.buffer = this.#noiseBuffer;
    source.loop = true;

    // Every note in a run shares the generator, so the first one that says
    // anything about the rate sets it.
    const rate = notes.find((note) => note.noise)?.noise?.rate ?? 0;
    source.playbackRate.value = NOISE_PLAYBACK_RATES[rate] ?? 1;

    return source;
  }
}
