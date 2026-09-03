import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SoundPlayer } from '../src/audio/player.ts';
import { WebAudioOutput, type SoundChip, type SoundOutput } from '../src/audio/output.ts';
import { buildHandlers } from '../src/engine/commands/index.ts';
import { Cycle } from '../src/engine/cycle.ts';
import { Machine } from '../src/engine/machine.ts';
import { Vocabulary } from '../src/resources/words.ts';
import { enterRoom } from '../src/engine/room.ts';
import { FLAG, MAX_SOUND_VOLUME, SOUND_GENERATOR_VALUE, VAR } from '../src/engine/state.ts';
import { ResourceManager } from '../src/resources/manager.ts';
import { parseObjectFile } from '../src/resources/objects.ts';
import {
  CHANNEL_COUNT,
  frequencyOf,
  gainOf,
  NOISE_CHANNEL,
  parseSound,
  SILENT_ATTENUATION,
  Sound,
  TICKS_PER_SECOND,
} from '../src/resources/sound.ts';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../src/shell/settings.ts';
import type { KeyValueStore } from '../src/storage/saves.ts';
import { DiskSource } from './helpers/disk-source.ts';

const source = await DiskSource.open();
const resources = await ResourceManager.open(source);
await resources.preload();
const objects = parseObjectFile((await source.read('OBJECT'))!);
const vocabulary = Vocabulary.parse((await source.read('WORDS.TOK'))!);

const soundIds = resources.ids('sound');
const sounds = soundIds.map((id) => parseSound(resources.loadSync('sound', id)));

/** Records what it was asked to do, so the engine's half can be tested alone. */
class FakeOutput implements SoundOutput {
  played: Sound[] = [];
  from: number[] = [];
  stops = 0;
  volume = 1;
  chip: SoundChip = 'pcjr';

  play(sound: Sound, fromMs = 0): void {
    this.played.push(sound);
    this.from.push(fromMs);
  }
  setChip(chip: SoundChip): void {
    this.chip = chip;
  }
  stop(): void {
    this.stops++;
  }
  setVolume(level: number): void {
    this.volume = level;
  }
}

function machine(output = new FakeOutput()): { m: Machine; output: FakeOutput } {
  const m = new Machine({ resources, objects, vocabulary, sound: new SoundPlayer(output) });
  m.setHandlers(buildHandlers());
  return { m, output };
}

// --- The format ------------------------------------------------------------

test('every SOUND resource in the game decodes', () => {
  assert.ok(sounds.length > 0, 'the game has sounds');

  for (const [index, sound] of sounds.entries()) {
    assert.equal(sound.channels.length, CHANNEL_COUNT, `sound ${soundIds[index]} channel count`);
  }
});

test('every channel is accounted for byte by byte', () => {
  // The strong one. Channels are delimited by the *next* channel's offset, so
  // a note that is not five bytes desynchronises a channel and it stops
  // somewhere other than its terminator. Across all 112 channels in the game,
  // a wrong note size cannot come out even.
  for (const [index, id] of soundIds.entries()) {
    const bytes = resources.loadSync('sound', id);
    const sound = sounds[index]!;

    assert.equal(sound.bytesRead, bytes.length, `sound ${id} consumes its whole resource`);

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let channel = 0; channel < CHANNEL_COUNT; channel++) {
      const start = view.getUint16(channel * 2, true);
      const end = channel + 1 < CHANNEL_COUNT ? view.getUint16((channel + 1) * 2, true) : bytes.length;
      const notes = sound.channels[channel]!.notes.length;

      // Notes, then the two-byte terminator, exactly fills the channel.
      assert.equal(notes * 5 + 2, end - start, `sound ${id} channel ${channel} fills its span`);
    }
  }
});

test('the first channel always begins right after the offset table', () => {
  const bytes = resources.loadSync('sound', soundIds[0]!);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint16(0, true), CHANNEL_COUNT * 2);
});

test('a divisor of zero is a rest, not a division', () => {
  assert.equal(frequencyOf(0), null);
  assert.ok(frequencyOf(100)! > 0);

  // The game really does contain them; this is not a hypothetical guard.
  const rests = sounds.flatMap((sound) =>
    sound.channels.slice(0, NOISE_CHANNEL).flatMap((c) => c.notes.filter((n) => n.divisor === 0)),
  );
  assert.ok(rests.length > 0, 'the game uses rests');
});

test('attenuation 15 is silence, not merely quiet', () => {
  assert.equal(gainOf(SILENT_ATTENUATION), 0);
  assert.equal(gainOf(0), 1);
  assert.ok(gainOf(1) < gainOf(0) && gainOf(1) > gainOf(2));
});

test('the noise channel is decoded as noise, and the others are not', () => {
  for (const sound of sounds) {
    for (const [index, channel] of sound.channels.entries()) {
      for (const note of channel.notes) {
        if (index === NOISE_CHANNEL) {
          assert.ok(note.noise, 'noise channel notes carry noise settings');
          assert.ok(note.noise!.rate >= 0 && note.noise!.rate <= 3);
        } else {
          assert.equal(note.noise, undefined);
        }
      }
    }
  }
});

test('durations are real time, at sixty ticks to the second', () => {
  const longest = Math.max(...sounds.map((s) => s.durationTicks));
  assert.ok(longest > TICKS_PER_SECOND, 'some sound lasts more than a second');

  const sound = sounds.find((s) => s.durationTicks > 0)!;
  assert.equal(sound.durationMs, (sound.durationTicks / TICKS_PER_SECOND) * 1000);
});

test('a truncated resource is refused rather than half-read', () => {
  assert.throws(() => parseSound(new Uint8Array(4)));
  // Offsets pointing outside the resource are a corrupt sound, not a silent one.
  const bogus = new Uint8Array([8, 0, 0, 0x40, 0, 0x40, 0, 0x40]);
  assert.throws(() => parseSound(bogus));
});

// --- Playing ---------------------------------------------------------------

test('a sound sets its flag when it ends, and not before', () => {
  const { m, output } = machine();
  m.playSound(soundIds[0]!, 40);

  assert.equal(output.played.length, 1);
  assert.equal(m.state.getFlag(40), false, 'the script waits while the sound plays');

  const duration = output.played[0]!.durationMs;
  m.tickSound(duration / 2);
  assert.equal(m.state.getFlag(40), false);

  m.tickSound(duration / 2);
  assert.equal(m.state.getFlag(40), true);
  assert.equal(m.sound.isPlaying, false);
});

test('stop.sound releases the script that was waiting', () => {
  // The deadlock real playback can introduce and the old no-op could not: a
  // script that stops its own sound and then waits for that sound's flag.
  const { m, output } = machine();
  m.playSound(soundIds[0]!, 41);
  m.stopSound();

  assert.equal(output.stops >= 1, true);
  assert.equal(m.state.getFlag(41), true);
  assert.equal(m.sound.isPlaying, false);
});

test('a sound cut off by the next one still releases its waiter', () => {
  const { m } = machine();
  m.playSound(soundIds[0]!, 42);
  m.playSound(soundIds[1]!, 43);

  assert.equal(m.state.getFlag(42), true, 'the displaced sound sets its flag');
  assert.equal(m.state.getFlag(43), false, 'the new one has not finished');
});

test('a missing sound resource does not hang the script', () => {
  const { m } = machine();
  const absent = 200;
  assert.equal(resources.isPresent('sound', absent), false);

  m.playSound(absent, 44);
  assert.equal(m.state.getFlag(44), true);
  assert.ok([...m.stubs.keys()].some((name) => name.startsWith('sound:')));
});

test('a sound started without a flag plays and asks for nothing', () => {
  const { m, output } = machine();
  m.playSound(soundIds[0]!, 0);
  m.tickSound(output.played[0]!.durationMs);
  assert.equal(m.sound.isPlaying, false);
});

test('switching sound off silences it without changing its timing', () => {
  const { m, output } = machine();
  m.state.setVar(VAR.SOUND_VOLUME, MAX_SOUND_VOLUME);
  m.state.setFlag(FLAG.SOUND_ON, false);
  m.playSound(soundIds[0]!, 45);
  assert.equal(output.volume, 0);

  const duration = output.played[0]!.durationMs;
  m.tickSound(duration - 1);
  assert.equal(m.state.getFlag(45), false, 'a silenced sound still takes as long');
  m.tickSound(1);
  assert.equal(m.state.getFlag(45), true);
});

test("the game's own volume control is followed", () => {
  // Logic 0 moves this variable with the volume keys, raising it only while it
  // is below 15, which is where the range comes from.
  const { m, output } = machine();
  m.state.setFlag(FLAG.SOUND_ON, true);

  m.state.setVar(VAR.SOUND_VOLUME, MAX_SOUND_VOLUME);
  m.playSound(soundIds[0]!, 0);
  assert.equal(output.volume, 1);

  m.state.setVar(VAR.SOUND_VOLUME, 0);
  m.tickSound(1);
  assert.equal(output.volume, 0);
});

test('a game starts at full volume rather than at zero', () => {
  // Nothing in the game sets the variable for the first time, so a start that
  // left it at zero would play the whole game silently.
  const { m } = machine();
  const cycle = new Cycle(m);
  cycle.start(1);
  assert.equal(m.state.getVar(VAR.SOUND_VOLUME), MAX_SOUND_VOLUME);
});

test('changing room stops the sound and releases its waiter', () => {
  const { m, output } = machine();
  m.playSound(soundIds[0]!, 46);
  enterRoom(m, 2);

  assert.ok(output.stops >= 1);
  assert.equal(m.state.getFlag(46), true);
});

test('the loop ages sound by real time, even while the game is parked', () => {
  const { m, output } = machine();
  const cycle = new Cycle(m);
  cycle.start(1);

  m.playSound(soundIds[0]!, 47);
  const duration = output.played[0]!.durationMs;

  // A window the game is waiting on stops cycles, but not sound: a script
  // waiting for a sound to end while a message is up must still be released.
  m.pending = { tick: () => false } as unknown as NonNullable<Machine['pending']>;
  cycle.advance(duration);

  assert.equal(m.state.getFlag(47), true);
});

test('the game asks for its theme when it starts', () => {
  // End to end through the real command path: the title screen starts the
  // game's own music, which is nearly a minute long. Nothing else in these
  // tests proves the opcode, the resource number and the resource manager line
  // up on a real script.
  const { m, output } = machine();
  const cycle = new Cycle(m);
  cycle.start(0);

  for (let i = 0; i < 400; i++) {
    if (!cycle.runOnce()) m.tickSound(50);
  }

  assert.equal(output.played.length, 1, 'the opening starts one sound');
  assert.ok(output.played[0]!.durationMs > 30_000, 'and it is the long theme');
  assert.equal(m.stubs.size, 0, 'without reaching anything unimplemented');
});

// --- The sound chip --------------------------------------------------------

test('a game is a PCjr until someone says otherwise', () => {
  // The engine played four voices while telling the game it was a PC speaker,
  // and the two had to be made to agree. Agreeing downwards would take away
  // half the notes, so the speaker is a choice made on purpose.
  const { m } = machine();
  const cycle = new Cycle(m);
  cycle.start(1);

  assert.equal(m.sound.chip, 'pcjr');
  assert.equal(m.state.getVar(VAR.SOUND_GENERATOR), SOUND_GENERATOR_VALUE.pcjr);
});

test('choosing a chip tells the scripts as well as the speakers', () => {
  const { m } = machine();
  const cycle = new Cycle(m);
  cycle.start(1);

  m.setSoundChip('speaker');
  assert.equal(m.sound.chip, 'speaker');
  assert.equal(m.state.getVar(VAR.SOUND_GENERATOR), SOUND_GENERATOR_VALUE.speaker);

  m.setSoundChip('pcjr');
  assert.equal(m.state.getVar(VAR.SOUND_GENERATOR), SOUND_GENERATOR_VALUE.pcjr);
});

test('changing chip mid-sound picks the same sound up where it had got to', () => {
  const { m, output } = machine();
  m.playSound(soundIds[0]!, 60);
  m.tickSound(1000);

  m.setSoundChip('speaker');

  assert.equal(output.chip, 'speaker');
  assert.equal(output.played.length, 2, 'the running sound is re-issued');
  assert.equal(output.from[1], 1000, 'from where it had got to');
});

test('changing chip does not move the end of the sound, or the flag', () => {
  // The rule volume already keeps. A player who switches hardware must not
  // change when a script stops waiting -- that is the game's pacing, and it is
  // not a sound setting.
  const { m, output } = machine();
  m.playSound(soundIds[0]!, 61);
  const duration = output.played[0]!.durationMs;

  m.tickSound(duration / 2);
  m.setSoundChip('speaker');
  m.tickSound(duration / 2 - 1);
  assert.equal(m.state.getFlag(61), false, 'not a moment early');

  m.tickSound(1);
  assert.equal(m.state.getFlag(61), true, 'nor a moment late');
});

test('choosing the chip already in use changes nothing', () => {
  const { m, output } = machine();
  m.playSound(soundIds[0]!, 0);
  m.setSoundChip('pcjr');

  assert.equal(output.played.length, 1, 'the sound is not restarted');
});

test('a speaker plays one voice, and a PCjr plays four', () => {
  const sound = sounds.find((s) => s.channels.every((c) => c.notes.length > 0))!;

  const pcjr = fakeContext();
  const four = new WebAudioOutput(pcjr.context as unknown as AudioContext);
  four.setChip('pcjr');
  four.play(sound);

  const beeper = fakeContext();
  const one = new WebAudioOutput(beeper.context as unknown as AudioContext);
  one.setChip('speaker');
  one.play(sound);

  assert.equal(pcjr.started.length, 4, 'three tone channels and the noise');
  assert.equal(beeper.started.length, 1, 'the first tone channel, and nothing else');
});

test('a speaker has no volume, only silence', () => {
  // Attenuation shapes the first channel through fourteen of its sixteen steps,
  // and a speaker can only be on or off. 15 stays what it always was: a rest.
  const sound = sounds.find((s) =>
    s.channels[0]!.notes.some((note) => note.attenuation > 0 && note.attenuation < 15),
  )!;

  const beeper = fakeContext();
  const output = new WebAudioOutput(beeper.context as unknown as AudioContext);
  output.setChip('speaker');
  output.play(sound);

  const gains = beeper.events.filter((e) => e.param === 'gain').map((e) => e.value);
  assert.ok(gains.length > 0);
  assert.deepEqual([...new Set(gains)].sort(), [0, 1], 'on or off, nothing between');

  // And the same sound on a PCjr uses the steps in between.
  const pcjr = fakeContext();
  const rich = new WebAudioOutput(pcjr.context as unknown as AudioContext);
  rich.play(sound);
  const shaded = pcjr.events
    .filter((e) => e.param === 'gain')
    .some((e) => e.value > 0 && e.value < 1);
  assert.equal(shaded, true);
});

test('a speaker falls silent when the piece is not on its one voice', () => {
  // Not a defect: a beeper has one voice, and if there is nothing left on it
  // there is nothing to hear. What must not change with it is the timing, and
  // that is the player's clock rather than the output's business.
  const sound = sounds[0]!;
  const beeper = fakeContext();
  const output = new WebAudioOutput(beeper.context as unknown as AudioContext);
  output.setChip('speaker');
  output.play(sound, (sound.channels[0]!.durationTicks / 60) * 1000 + 1);

  assert.equal(beeper.started.length, 0, 'nothing to play');
});

// --- Remembering the choice -------------------------------------------------

/** localStorage, as a Map, so the settings can be tested without a browser. */
class FakeStorage implements KeyValueStore {
  readonly items = new Map<string, string>();
  full = false;

  get length(): number {
    return this.items.size;
  }
  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.full) throw new Error('QuotaExceededError');
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

test('the machine is a PCjr until a player says otherwise', () => {
  assert.equal(loadSettings(new FakeStorage()).sound, 'pcjr');
  assert.equal(DEFAULT_SETTINGS.sound, 'pcjr');
});

test('a chosen chip is still chosen next time', () => {
  const storage = new FakeStorage();
  saveSettings(storage, { ...DEFAULT_SETTINGS, sound: 'speaker' });

  assert.equal(loadSettings(storage).sound, 'speaker');
});

test('a setting that makes no sense falls back rather than breaking the engine', () => {
  // These are values a person can edit, and a sound chip that does not exist
  // would be an engine with nowhere to send its notes.
  const storage = new FakeStorage();
  storage.setItem('web-agi:settings', '{"sound":"gramophone","graphics":"vga"}');

  assert.deepEqual(loadSettings(storage), DEFAULT_SETTINGS);

  storage.setItem('web-agi:settings', 'not json');
  assert.deepEqual(loadSettings(storage), DEFAULT_SETTINGS);
});

test('a browser that will not remember settings is not an error', () => {
  // The opposite rule to saved games, and on purpose: one is a preference, the
  // other is somebody's evening.
  const storage = new FakeStorage();
  storage.full = true;

  assert.doesNotThrow(() => saveSettings(storage, DEFAULT_SETTINGS));
  assert.deepEqual(loadSettings(null), DEFAULT_SETTINGS);
});

// --- Scheduling ------------------------------------------------------------

/**
 * Just enough of WebAudio to run the scheduler against.
 *
 * Not a simulation of audio: it records the parameter changes that were
 * scheduled, which is the part of {@link WebAudioOutput} that can be wrong
 * without a browser ever saying so.
 */
function fakeContext() {
  const events: { param: string; value: number; at: number }[] = [];
  const started: number[] = [];
  const stopped: number[] = [];

  const param = (name: string) => ({
    value: 0,
    setValueAtTime(value: number, at: number) {
      events.push({ param: name, value, at });
    },
  });

  const node = () => ({
    connect() {},
    disconnect() {},
    start(at: number) {
      started.push(at);
    },
    stop(at?: number) {
      stopped.push(at ?? 0);
    },
  });

  const context = {
    currentTime: 0,
    sampleRate: 44100,
    destination: {},
    createGain: () => ({ ...node(), gain: param('gain') }),
    createOscillator: () => ({ ...node(), type: '', frequency: param('frequency') }),
    createBufferSource: () => ({ ...node(), buffer: null, loop: false, playbackRate: { value: 1 } }),
    createBuffer: (_channels: number, length: number) => ({
      getChannelData: () => new Float32Array(length),
    }),
  };

  return { context, events, started, stopped };
}

test('a sound is scheduled note by note on the audio clock', () => {
  const { context, events, started, stopped } = fakeContext();
  const output = new WebAudioOutput(context as unknown as AudioContext);
  const sound = sounds[0]!;

  output.play(sound);

  const voiced = sound.channels.filter((channel) => channel.notes.length > 0).length;
  assert.equal(started.length, voiced, 'one source per channel that has notes');

  // Every channel ends silent, at the moment its own notes run out -- not at
  // the length of the longest channel, and not left ringing.
  for (const [index, channel] of sound.channels.entries()) {
    if (channel.notes.length === 0) continue;
    const end = channel.durationTicks / TICKS_PER_SECOND;
    assert.ok(
      stopped.some((at) => Math.abs(at - end) < 1e-6),
      `channel ${index} stops when its notes do`,
    );
  }

  const frequencies = events.filter((e) => e.param === 'frequency');
  assert.ok(frequencies.length > 0, 'tone channels are given frequencies');
  assert.ok(
    frequencies.every((e) => e.value > 0 && Number.isFinite(e.value)),
    'and never a frequency from a divisor of zero',
  );

  // Scheduled times only ever move forward, which is what a melody in the
  // right order looks like from here.
  const gains = events.filter((e) => e.param === 'gain');
  assert.ok(gains.length >= sound.channels.reduce((n, c) => n + c.notes.length, 0));
  assert.ok(gains.every((e) => e.at >= 0));
});

test('volume scales the whole output rather than the notes', () => {
  const { context, events } = fakeContext();
  const output = new WebAudioOutput(context as unknown as AudioContext);

  output.setVolume(0);
  output.play(sounds[0]!);
  // The master gain is set directly, not scheduled, so the notes' own gains
  // are unchanged by it -- a sound turned down is the same sound.
  assert.ok(events.some((e) => e.param === 'gain' && e.value > 0));
});

test('a sound already running is handed to the audio when it arrives', () => {
  // The game's theme starts on the first cycle, and no browser will let a page
  // make a noise before the player has touched it. Without the hand-over the
  // whole opening plays silently and the first thing ever heard is what comes
  // after it.
  const player = new SoundPlayer();
  const sound = sounds[0]!;

  player.play(sound, 5);
  player.tick(1000);

  const late = new FakeOutput();
  player.setOutput(late);

  assert.equal(late.played.length, 1, 'the running sound is started on the new output');
  assert.equal(late.from[0], 1000, 'from where it had got to');
});

test('nothing is handed over when nothing is playing', () => {
  const player = new SoundPlayer();
  const late = new FakeOutput();

  player.setOutput(late);

  assert.equal(late.played.length, 0);
});

test('picking a sound up part-way schedules only what is left of it', () => {
  const { context, events, stopped } = fakeContext();
  const output = new WebAudioOutput(context as unknown as AudioContext);
  const sound = sounds[0]!;

  output.play(sound);
  const whole = events.length;
  events.length = 0;
  stopped.length = 0;

  const skipMs = sound.durationMs / 2;
  output.play(sound, skipMs);

  assert.ok(events.length < whole, 'the notes already gone are not scheduled again');
  assert.ok(events.length > 0, 'and the rest still is');
  assert.ok(
    stopped.every((at) => at <= sound.durationMs / 1000 - skipMs / 1000 + 1e-6),
    'the sound ends when it would have ended, not a full length later',
  );
});

test('the player is silent, and in time, with no output at all', () => {
  // The state the game starts in, before the browser allows an AudioContext.
  const player = new SoundPlayer();
  const sound = sounds[0]!;

  assert.equal(player.play(sound, 5), 0);
  assert.equal(player.tick(sound.durationMs - 1), 0);
  assert.equal(player.tick(1), 5, 'the flag arrives on the same schedule');
});
