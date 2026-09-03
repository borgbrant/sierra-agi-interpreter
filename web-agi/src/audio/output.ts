/**
 * Where sound actually comes out.
 *
 * The engine never talks to WebAudio directly. It holds a {@link SoundOutput},
 * which is an interface for two reasons: the cycle has to behave identically
 * when there is no audio at all -- a suspended context, a headless test -- and
 * the scheduling below is the part that can only be exercised in a browser.
 */
import {
  CHANNEL_COUNT,
  frequencyOf,
  gainOf,
  NOISE_CHANNEL,
  SILENT_ATTENUATION,
  Sound,
  TICKS_PER_SECOND,
} from '../resources/sound.ts';

/**
 * Which sound hardware the game is being played on.
 *
 * Not a preference about how loud things should be: the two machines play
 * *different amounts of the music*. A PCjr or a Tandy has three tone voices and
 * a noise channel and plays a SOUND resource whole. A PC speaker has one voice
 * and no volume at all -- it plays the first tone channel, at one level,
 * because a speaker is on or off.
 */
export type SoundChip = 'speaker' | 'pcjr';

/**
 * The voices each chip has.
 *
 * The speaker's one voice is the first tone channel, which is where the melody
 * of the bundled game's music sits: it carries 1864 of the 3838 notes, and is
 * the longest channel in twenty of the twenty-eight sounds. In the other eight
 * a piece now ends when that one voice runs out.
 */
const CHANNELS_PLAYED: Record<SoundChip, number> = {
  pcjr: CHANNEL_COUNT,
  speaker: 1,
};

export interface SoundOutput {
  /**
   * Start a sound, replacing whatever was playing.
   *
   * @param fromMs where in the sound to start, for one that has been running
   *               silently while the browser withheld an audio context
   */
  play(sound: Sound, fromMs?: number): void;
  /** Silence immediately. */
  stop(): void;
  /**
   * How loud, from 0 (silent) to 1.
   *
   * Only loudness: timing never depends on it, so a game played silently runs
   * at exactly the speed of one played loud.
   */
  setVolume(level: number): void;

  /**
   * Which hardware to sound like from now on.
   *
   * Like the volume, this changes what is audible and never when anything
   * happens: a sound switched from four voices to one still ends at the same
   * moment, and the script waiting on it is released at the same moment. The
   * player re-issues whatever is playing at the point it has reached, which is
   * the same hand-over a late audio context gets.
   */
  setChip(chip: SoundChip): void;
}

/** Does nothing, audibly. Used until the audio context can be created. */
export const SILENT_OUTPUT: SoundOutput = {
  play: () => {},
  stop: () => {},
  setVolume: () => {},
  setChip: () => {},
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
  #chip: SoundChip = 'pcjr';
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

  setChip(chip: SoundChip): void {
    this.#chip = chip;
  }

  play(sound: Sound, fromMs = 0): void {
    this.stop();

    const context = this.#context;
    const start = context.currentTime;
    const skip = Math.max(0, fromMs) / 1000;

    const voices = CHANNELS_PLAYED[this.#chip];

    sound.channels.forEach((channel, index) => {
      // A speaker has one voice, and it is the first tone channel. The others
      // are not played quietly; they are not played.
      if (index >= voices) return;
      if (channel.notes.length === 0) return;
      if (channel.durationTicks / TICKS_PER_SECOND <= skip) return;

      const gain = context.createGain();
      gain.gain.value = 0;
      gain.connect(this.#master);

      const source =
        index === NOISE_CHANNEL ? this.#createNoise(channel.notes) : this.#createTone();
      source.connect(gain);

      // Times are the sound's own, shifted so that `skip` lands on `start`.
      // A note that has already been and gone is skipped, and the one playing
      // when the audio arrived starts now, part-way through.
      let elapsed = 0;
      for (const note of channel.notes) {
        const seconds = note.durationTicks / TICKS_PER_SECOND;
        const at = Math.max(start, start + elapsed - skip);
        elapsed += seconds;
        if (elapsed <= skip) continue;

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
          gain.gain.setValueAtTime(this.#gainOf(note.attenuation), at);
        }
      }

      // Whatever the last note left the gain at, the channel ends silent.
      const end = start + Math.max(0, elapsed - skip);
      gain.gain.setValueAtTime(0, end);
      source.start(start);
      source.stop(end);
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

  /**
   * How loud one note is on this chip.
   *
   * A speaker has no volume control: every note that is not silence plays at
   * the one level it has. Attenuation 15 stays what it always was -- a rest --
   * because that is the format's way of writing a gap, not a quiet note.
   */
  #gainOf(attenuation: number): number {
    if (this.#chip === 'pcjr') return gainOf(attenuation);
    return attenuation >= SILENT_ATTENUATION ? 0 : 1;
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
