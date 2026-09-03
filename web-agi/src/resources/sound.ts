/**
 * SOUND resources: the notes the PCjr's sound chip was fed.
 *
 * The layout was read out of the bundled game rather than taken from
 * documentation, and it holds for all 28 of its sounds: four 16-bit offsets,
 * one per channel, then runs of 5-byte notes each ending at a 0xFFFF
 * terminator. Every one of the game's 112 channels terminates and ends exactly
 * on the next channel's offset, which is what confirms the note is five bytes
 * and not something else that happens to divide.
 *
 * ```text
 * byte 0-7     four 16-bit little-endian offsets, one per channel
 * note[0..1]   duration, 16-bit little-endian, in 1/60 s ticks
 * note[2..3]   frequency divisor: (b2 & 0x3f) << 4 | (b3 & 0x0f)
 * note[4]      attenuation in the low nibble: 0 loudest, 15 silent
 * ```
 */
import { ResourceError, ERROR_CODES } from './errors.ts';

/** Three tone channels, then one noise channel. */
export const CHANNEL_COUNT = 4;

/** The channel driven by the noise generator rather than by a tone. */
export const NOISE_CHANNEL = 3;

/** Bytes per note. */
const NOTE_SIZE = 5;

/** Ends a channel's run of notes. */
const TERMINATOR = 0xffff;

/** Notes are timed in sixtieths of a second. */
export const TICKS_PER_SECOND = 60;

/**
 * The SN76496's input clock, in Hz, after its internal divide by 32.
 *
 * A tone channel's frequency is this over the note's divisor.
 */
export const CLOCK_HZ = 111860;

/** Attenuation is 2 dB per step, and 15 is not "very quiet" but off. */
export const SILENT_ATTENUATION = 15;

export interface Note {
  /** How long the note lasts, in sixtieths of a second. */
  durationTicks: number;
  /**
   * Frequency divisor for a tone channel.
   *
   * Zero occurs in the game and means a rest: it is not a frequency of
   * infinity, and dividing by it is the one way a straightforward reader of
   * this format goes wrong.
   */
  divisor: number;
  /** 0 is loudest, 15 is silence. */
  attenuation: number;
  /** Only meaningful on the noise channel. */
  noise?: NoiseSettings;
}

export interface NoiseSettings {
  /** White noise when set, the chip's periodic buzz when clear. */
  white: boolean;
  /**
   * Shift rate, 0-3.
   *
   * 0-2 divide the clock by 512, 1024 and 2048; 3 means "follow tone channel
   * 2", which the bundled game never asks for.
   */
  rate: number;
}

export interface Channel {
  notes: Note[];
  /** Total length of the channel, in sixtieths of a second. */
  durationTicks: number;
}

export class Sound {
  readonly channels: readonly Channel[];

  /** Bytes consumed, which is the whole resource for a well-formed sound. */
  readonly bytesRead: number;

  constructor(channels: Channel[], bytesRead: number) {
    this.channels = channels;
    this.bytesRead = bytesRead;
  }

  /** The longest channel decides when the sound is over. */
  get durationTicks(): number {
    return Math.max(0, ...this.channels.map((channel) => channel.durationTicks));
  }

  get durationMs(): number {
    return (this.durationTicks / TICKS_PER_SECOND) * 1000;
  }

  /** Whether anything would actually be heard. */
  get isSilent(): boolean {
    return this.channels.every((channel) =>
      channel.notes.every((note) => note.attenuation === SILENT_ATTENUATION),
    );
  }
}

/** Hertz for a tone divisor, or null for a rest. */
export function frequencyOf(divisor: number): number | null {
  return divisor === 0 ? null : CLOCK_HZ / divisor;
}

/**
 * Linear gain for an attenuation step.
 *
 * Two decibels per step, with 15 forced to silence rather than approximated as
 * the -30 dB the formula would give it.
 */
export function gainOf(attenuation: number): number {
  if (attenuation >= SILENT_ATTENUATION) return 0;
  return 10 ** (-attenuation / 10);
}

/**
 * Decode a SOUND resource.
 *
 * @param bytes the resource payload, with the VOL header already stripped
 */
export function parseSound(bytes: Uint8Array): Sound {
  const header = CHANNEL_COUNT * 2;
  if (bytes.length < header) {
    throw new ResourceError(
      ERROR_CODES.PAYLOAD_OUT_OF_RANGE,
      `a SOUND resource needs at least ${header} bytes of channel offsets, got ${bytes.length}`,
    );
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offsets: number[] = [];
  for (let channel = 0; channel < CHANNEL_COUNT; channel++) {
    offsets.push(view.getUint16(channel * 2, true));
  }

  const channels: Channel[] = [];
  let consumed = header;

  for (let channel = 0; channel < CHANNEL_COUNT; channel++) {
    const start = offsets[channel]!;
    // A channel runs to where the next one begins; the last runs to the end.
    const end = channel + 1 < CHANNEL_COUNT ? offsets[channel + 1]! : bytes.length;

    if (start < header || end > bytes.length || end < start) {
      throw new ResourceError(
        ERROR_CODES.PAYLOAD_OUT_OF_RANGE,
        `SOUND channel ${channel} spans ${start}..${end}, outside a ${bytes.length}-byte resource`,
      );
    }

    channels.push(readChannel(view, start, end, channel === NOISE_CHANNEL));
    consumed = Math.max(consumed, end);
  }

  return new Sound(channels, consumed);
}

/** Read one channel's notes, up to its terminator or its end. */
function readChannel(view: DataView, start: number, end: number, noise: boolean): Channel {
  const notes: Note[] = [];
  let durationTicks = 0;
  let at = start;

  while (at + 2 <= end) {
    if (view.getUint16(at, true) === TERMINATOR) break;
    // A truncated note is the end of the channel, not a decoding error: the
    // resource is what the game shipped, and half a note carries no sound.
    if (at + NOTE_SIZE > end) break;

    const durationTicksOfNote = view.getUint16(at, true);
    const b2 = view.getUint8(at + 2);
    const b3 = view.getUint8(at + 3);
    const attenuation = view.getUint8(at + 4) & 0x0f;

    const note: Note = {
      durationTicks: durationTicksOfNote,
      divisor: ((b2 & 0x3f) << 4) | (b3 & 0x0f),
      attenuation,
    };

    // On the noise channel the frequency field is not a frequency: the low
    // three bits pick the generator's mode and rate instead.
    if (noise) note.noise = { white: (b3 & 0x04) !== 0, rate: b3 & 0x03 };

    notes.push(note);
    durationTicks += durationTicksOfNote;
    at += NOTE_SIZE;
  }

  return { notes, durationTicks };
}
