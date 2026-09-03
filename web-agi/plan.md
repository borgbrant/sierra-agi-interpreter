# Implementation plan: web-agi

Companion to [spec.md](spec.md). The spec says *what* to build; this says in what
order, in which files, and how each step is proven to work.

> **M0-M10 are done and shipped. M11-M13 are specified and not started.** The
> milestones are kept as they were written, for the reasoning behind the
> sequencing and for the format measurements in the next section. They are not a
> description of the code as built: several modules ended up named or split
> differently, and the file lists below say so where they differ. For the current
> shape of the system, read [spec.md](spec.md) and the source. Where the two
> disagree, the spec is the one to trust.

```text
M0  Workspace foundation      complete
M1  Resource layer            complete
M2  Static rendering          complete
M3  Reading LOGIC             complete
M4  The machine runs          complete
M5  Ego moves                 complete
M6  Playable                  complete
M7  Sound                     complete
M8  Save and restore          complete
M9  The sound chip switch     complete
M10 The display driver seam   complete
M11 What the scripts see      not started
M12 CGA                       not started
M13 Hercules                  not started
```

## Grounding: what was verified before planning

The spec was written from the AGI documentation. Before planning, its riskiest
claims were checked against the actual bundled game. These are measurements, not
assumptions, and the plan depends on them.

```text
game              Leisure Suit Larry 1, version 1.00
interpreter       AGI 2.440 (from AGIDATA.OVL; AGI is 38400 bytes, OVL 7680)
opcode count      170 action commands  <- measured from the game, see below
resources         46 LOGIC (ids 0-58), 151 VIEW, PIC and SOUND present
OBJECT            encrypted; 21 items, all named, 13 start rooms, maxAnimated 16
WORDS.TOK         6597 bytes; 26x2 letter index is BIG-endian
```

### LOGIC resource layout, confirmed against all 45 readable resources

```text
payload[0..1]     little-endian offset to the message section
payload[2..S]     bytecode, where S = 2 + that offset
section[0]        number of messages
section[1..2]     end position of the section
section[3..]      count x 2 offset table, NOT encrypted,
                  offsets relative to section+1, an offset of 0 means absent
strings           null-terminated, XOR "Avis Durgan"
```

The one detail no document made explicit: **the cipher key restarts at the start
of the strings region**, not at the start of the section or the resource. Tested
against four candidate anchors over 45 resources and 2040 message slots:

```text
100.00%   key restarts at strings region
 90.08%   key anchored at section+1
 89.77%   key anchored at section+3
 87.55%   key anchored at section+0
```

100.00% printable across every message in the game is conclusive. Anything less
than 100% would mean the anchor is wrong somewhere.

### Unverified at planning time — since settled

`WORDS.TOK`'s packed word list. The letter index parsed cleanly, but a quick walk
of the packed entries stalled after 39 words against a vocabulary numbered up to
at least 348. The packing (shared-prefix length, then characters with the
terminator in the high bit) needed real implementation, not a probe. **It was the
only input format not proven in advance, so the plan moved it early rather than
leaving it in the last milestone.**

That worked: `src/resources/words.ts` parses the whole file, and
`test/words.test.ts` accounts for every byte of it.

## Corrections folded back into the spec

All three have been applied to [spec.md](spec.md):

1. "Roughly 180 action opcodes" became **170**, and the spec now records the
   target game and interpreter version in its own section. Open question 1
   ("which interpreter version") is answered and removed.
2. The message section now documents the full layout, the key-restart anchor and
   that an offset of 0 means an absent message.
3. WORDS.TOK's letter index is recorded as big-endian.

The spec and this plan therefore agree; where they differ in future, the spec is
the one to trust.

## Sequencing principle

Every milestone ends in something visible on screen, and each one is built so the
*next* one has a way to see what it is doing. Concretely: the disassembler
(M3) exists before the interpreter (M4) so a misbehaving script can be read, and
the priority-screen overlay (M2) exists before movement (M5) so blocking bugs are
visible rather than inferred.

Work inside a milestone is ordered so the risky part comes first, while there is
still room to react.

---

## M0 — Workspace foundation — complete

No engine code. Gets the two packages talking and the game files reachable.

```text
package.json                  workspaces: ["agi-extract", "web-agi"]
web-agi/package.json          deps: agi-extract (workspace:*), vite, typescript
web-agi/tsconfig.json         strict: true, target ES2022, moduleResolution bundler
web-agi/vite.config.ts
web-agi/index.html
web-agi/src/main.ts           mounts the shell, prints "ready"
```

Two changes land in `agi-extract` here, both small and both keeping its 131 tests
green:

- `view.js`: drop `Buffer` so the VIEW decoder runs in a browser. *As built:* the
  replacement is a hand-rolled latin1 decode, not `TextDecoder('latin1')` — that
  label means windows-1252 and remaps 0x80-0x9F, which corrupts a description.
- `package.json`: confirm the `./pic`, `./view`, `./directory`, `./volume` and
  `./errors` subpath exports resolve from a workspace dependant.

**Game data.** `web-agi/public/game/` holds a copy of the resource files, plus a
`manifest.json` generated by `scripts/build-manifest.mjs` — HTTP offers no
directory listing, so the app must be told what exists. The manifest lists only
the files the engine reads: the four DIR files, the VOL files, OBJECT, WORDS.TOK.
The DOS executables and the CGA/Hercules overlays are not copied.

**Done when:** `npm run dev` serves a page, and `npm test` runs in both packages.

---

## M1 — Resource layer — complete

```text
src/resources/source.ts       ResourceSource interface, BundledSource
src/resources/directory.ts    the four DIR files -> location tables
src/resources/manager.ts      ResourceManager: VOL cache, payload extraction
src/resources/errors.ts       re-export agi-extract's stable error codes
```

`ResourceManager` fetches each VOL once into an `ArrayBuffer` and slices payloads
out of it, validating the 5-byte header with `agi-extract`'s `parseVolHeader`.

Then, out of order relative to the spec's milestones, the **WORDS.TOK spike**:

```text
src/resources/words.ts        vocabulary: index, packed entries, word numbers
```

It is pulled forward from M6 because it is the last unverified format. The test
that settles it: parse the whole file, assert the word count is in the expected
hundreds, that entries come out in alphabetical order (the packing depends on
that ordering, so a decoding bug shows up as an ordering violation), and that
every byte of the file is consumed.

`OBJECT` lands here too, since it is already proven:

```text
src/resources/objects.ts      decrypt, item names, start rooms, maxAnimated
```

**Done when:** the page reports resource counts per type, item count and word
count, all read from the real files.

---

## M2 — Static rendering — complete

```text
src/render/screens.ts         160x168 visual + priority buffers
src/render/display.ts         320x200 framebuffer, ImageData, integer scaling
src/render/picture.ts         decodePicture (agi-extract) -> screens
src/render/sprite.ts          draw a cel: transparency + priority test
src/shell/canvas.ts           canvas element, resize, letterbox, no smoothing
src/shell/debug.ts            overlay: toggle to the priority screen
```

*As built:* `picture.ts` was not needed as a separate module — wrapping
`decodePicture` is four lines, so `Screens.fromPicture` in `screens.ts` does it.
`render/renderer.ts` and `engine/present.ts` were added to keep frame
composition out of both the engine and the DOM.

The display is a single `Uint8ClampedArray` written as `ImageData`. Nothing uses
canvas drawing primitives.

The priority-screen overlay is built now, not in M5. Blocking and occlusion bugs
are invisible without it, and building it two milestones early costs a toggle.

**Done when:** any PICTURE renders on the canvas, any VIEW cel draws over it with
correct transparency, and the overlay shows the priority screen.

---

## M3 — Reading LOGIC — complete

```text
src/logic/resource.ts         header split: bytecode vs message section
src/logic/messages.ts         decryption, offset table, absent messages
src/logic/opcodes.ts          the 2.440 table: 170 actions + the test commands
src/logic/reader.ts           instruction decoding
src/logic/disasm.ts           bytecode -> readable text
```

The opcode table is the one piece of pure data the plan cannot verify in advance;
everything downstream depends on it being right. It gets a validation test that
uses the whole game as its fixture:

```text
for every LOGIC resource:
  walk the bytecode from offset 2 to the message section
  assert every opcode is known to the 2.440 table
  assert the arguments never run past the bytecode
  assert the walk lands exactly on the message section, never inside or past it
  assert every if-jump target is an instruction boundary
```

That last pair is the strong one. If any argument count in the table is wrong,
decoding desynchronises and the walk ends at the wrong byte or a jump lands
mid-instruction. Across 46 resources, a wrong table cannot pass.

`said` and the `if` condition expression are decoded by hand, as the spec notes;
they are the two shapes the table cannot describe.

**Done when:** every LOGIC resource in the game disassembles, the validation test
passes for all of them, and the disassembly of a chosen room reads sensibly.

---

## M4 — The machine runs — complete

```text
src/engine/state.ts           256 vars, 256 flags, 12 strings, reserved names
src/engine/interpreter.ts     dispatch, call stack, unwinding
src/engine/commands/          handlers, grouped by area
  arithmetic.ts  flags.ts  objects.ts  graphics.ts  text.ts  inventory.ts  misc.ts
src/engine/cycle.ts           fixed-timestep loop
src/engine/room.ts            the new.room sequence
```

*As built:* `interpreter.ts` is `engine/machine.ts`, and waiting is a generator
rather than a re-entrant dispatch loop — `engine/interaction.ts` holds the things
a script can wait on. The command groups settled into five rather than seven:
`core.ts` (arithmetic, flags, control), `graphics.ts`, `objects.ts`, `text.ts`
and `items.ts` (inventory), collected by `commands/index.ts`.
`engine/message.ts` and `engine/animate.ts` were split out of the text and
object commands once both outgrew their handlers.

Commands are implemented in dependency order, not numeric order: the arithmetic
and flag commands first (they need nothing), then graphics, then object commands.
Anything not yet implemented throws with its opcode, its name and the script
position — a loud failure that names the next thing to build.

`state.ts` gives every reserved variable and flag a **named constant**, and the
tests refer to those names. A test that says "the current room number is written
to the room variable" survives someone discovering the number is wrong; a test
that says `vars[6]` does not.

The cycle is a fixed-timestep accumulator: `requestAnimationFrame` supplies
elapsed time, the loop runs whole cycles at the game's rate, and it caps catch-up
so a stalled tab cannot trigger a burst of hundreds of cycles.

Sound commands become no-ops that immediately set the flag scripts wait on. Not
doing this deadlocks any script that waits for a sound to finish.

**Done when:** the game's first room loads, its script runs a cycle without
throwing, and the room's picture is on screen. No ego yet.

---

## M5 — Ego moves — complete

```text
src/engine/viewtable.ts       the object table, entry 0 = ego
src/engine/motion.ts          direction, step size, edges, control lines
src/render/sprite.ts          extended: background save and restore
src/input/keyboard.ts         direction keys, key state
```

The ordering within a cycle is where this milestone goes wrong if rushed: restore
what every sprite covered, update positions, then draw them all again. Doing it
per-object rather than in two passes leaves trails.

Blocking is tested directly against the control-line values rather than through
gameplay: place an object next to each of the four control colours and assert
which moves are refused.

**Done when:** ego walks around the first room with the arrow keys, is occluded
by scenery at the right depth, and is stopped by obstacles.

---

## M6 — Playable — complete

```text
src/render/font.ts            embedded 8x8 font
src/render/text.ts            character cells, windows, word wrap
src/engine/menu.ts            the menu bar the game defines
src/engine/inventory.ts       item list and close-ups
src/input/prompt.ts           the input line editor
src/input/parser.ts           text -> word numbers, using words.ts from M1
```

*As built:* as listed. `engine/menu.ts` also carries `KeyBindings`, the
script-bound shortcuts the game's own menus advertise, which the plan had not
anticipated needing a home.

The parser is mostly done by M1's vocabulary work; what remains is
longest-match-first tokenisation across multi-word entries, dropping ignorable
words, and distinguishing "not in the vocabulary at all" from "known word, not
understood here".

Text windows suspend the cycle. The loop models that as a state, never by
blocking, or input stops being processed while a window is open.

**Done when:** the game's opening is playable: text appears, the prompt accepts
commands, `said` tests fire, inventory opens, menus work.

---

## M7 — Sound — complete

The first milestone with a v1 non-goal in it. Nothing about it changes the
engine's control flow, because M4 already made every sound command set the flag
scripts wait on; what changes is *when* the flag is set.

### Grounding: SOUND measured against the bundled game

Same discipline as the other formats — the layout below was read out of the
game's own resources before planning, not taken from documentation:

```text
sound resources   28 present, of 34 SNDDIR slots
resource[0..7]    4 x 16-bit little-endian offsets, one per channel
                  offset[0] is 8 in all 28, and the four are ascending
channels          3 tone + 1 noise, in that order
notes             5 bytes each, run terminated by 0xFFFF
```

Every one of the 112 channels in the game terminates with `0xFFFF` and ends
exactly on the next channel's offset — no slack, no channel running into its
neighbour. That is what makes the 5-byte note the right unit rather than a guess.

```text
note[0..1]   duration, 16-bit little-endian, in 1/60 s ticks
note[2..3]   frequency divisor: (b2 & 0x3f) << 4 | (b3 & 0x0f)
note[4]      attenuation in the low nibble, 0 loudest, 15 silent
```

```text
3838 notes across the game
durations    1 to 2067 ticks; no note has duration 0
divisors     0 to 1017 -- a divisor of 0 occurs and means a rest, not a
             division by zero, which is the one place a naive reader crashes
attenuation  every value 0-15 except 14 appears; 15 is used as silence
noise channel  low three bits of b3 are 4, 5 and 6: bit 2 set is white noise,
               the remaining two bits select the shift rate
longest sound  58 seconds, so playback cannot be a fire-and-forget schedule
```

Tone frequency is `111860 / divisor` Hz — the PCjr's SN76496 clock over the
divisor. Attenuation is 2 dB per step, so gain is `10 ** (-att / 10)` with 15
forced to zero rather than approximated.

### Files

```text
src/resources/sound.ts        SOUND resource -> 4 channels of notes
src/audio/context.ts          the AudioContext, created and resumed on a gesture
src/audio/player.ts           schedule a parsed sound; stop; report completion
src/engine/commands/core.ts   sound / stop.sound / load.sound become real
```

*As built:* a third module, `src/audio/output.ts`, holds the `SoundOutput`
interface and the WebAudio implementation, leaving `player.ts` with only what
the engine knows: which sound is running and who is waiting for it. That split
is what lets every rule below be tested headlessly against a recording output,
with WebAudio itself the only part that needs a browser. `SILENT_OUTPUT` in the
same file is what the engine runs against before a gesture has happened.

`sound.ts` is a decoder and belongs with the other format readers, next to
`words.ts` and `objects.ts`: it is about the *format*, so it is written the way
the spec says such things are written — as something that could move into a
shared core package later.

### Order of work

The risky part first, as everywhere else. Here that is neither the format nor
WebAudio but the browser's autoplay policy: an `AudioContext` created before a
user gesture starts suspended, and a game that begins its first cycle at load
would otherwise play its opening sound into a dead context and set the flag
anyway. So `context.ts` comes first, the context is created lazily and resumed on
the first keypress, and a suspended context degrades to the M4 behaviour —
silence, flag set on schedule — rather than to a stall.

Then the decoder, then the player:

1. **`context.ts`.** One shared context, resumed on the first key or click. Volume
   follows `VAR.SOUND_VOLUME` and `FLAG.SOUND_ON`, which the cycle already
   maintains and the status line already displays.
2. **`sound.ts`.** Parse the four channels; a rest for divisor 0; the noise
   channel decoded but kept separate from the tone channels, because its
   frequency field means something different.
3. **`player.ts`.** Three `OscillatorNode`s of type `square`, one per tone
   channel, plus a looping noise `AudioBufferSourceNode`, each through its own
   `GainNode`. Notes are written as scheduled parameter changes on the audio
   clock, not played one at a time from the game cycle — a 58-second sound must
   not depend on cycles arriving on time, and the two clocks drift.
4. **The commands.** `sound(n, flag)` starts playback and remembers the flag;
   the flag is set when the last note ends. `stop.sound` stops playback and must
   *also* release whatever was waiting, or a script that stops its own sound and
   then waits for it hangs — the one deadlock this milestone can introduce that
   M4's no-op could not.

*As built:* the autoplay policy turned out to be the whole of the milestone's
difficulty, and the plan saw only its first half. Creating the context on a
gesture is not enough, because the game starts its 58-second theme on cycle 1:
by the time a player presses anything the theme has been running silently. So
the player hands whatever is playing to a new output at the offset it has
reached, and the scheduler can start a sound part-way through.

The second half went through two answers. The first was a gate -- nothing runs
until the page is touched -- which made the theme audible from its first note
but held the game up behind a keypress. The second, and the one that shipped, is
that **the game starts with its sound off**: it runs immediately, the player
switches sound on when they want it, and that switch is itself the gesture that
lets audio exist. What they then hear is the theme from where it has got to,
through the same hand-over. Off rather than merely silent, because the status
line shows the game's own sound flag and a game that says *Sound:on* while
playing nothing is worse than one that says what it is doing.

Audio is scheduled on the audio clock as planned, but *the flag* is
timed off the engine's own elapsed milliseconds, in `SoundPlayer.tick`, called
from `Cycle.advance` before anything else. Two reasons, both found while
building it: the flag has to arrive on the same schedule when there is no audio
at all, which is the state every headless test and every pre-gesture browser is
in; and it has to arrive while the game is parked on a window, which is exactly
when no cycle is running. Every way a sound can end reports its flag — finishing,
being displaced by the next sound, being stopped, a room change, a restart and a
missing resource — because each of those is a script left waiting otherwise.

### What the game turned out to want

Two things the plan did not anticipate, both read out of the game rather than
guessed:

- **The volume variable is live.** Logic 0 contains `if (lessn(23, 15) &&
  controller(39)) increment(23)` and a matching `decrement`, so the game's own
  volume keys move `VAR.SOUND_VOLUME` and the game itself supplies the 0-15
  range. It is honoured rather than treated as decoration — and, because
  nothing in the game ever sets it a first time, `Cycle.start` has to initialise
  it to 15 or the whole game plays silently.
- **Neither volume nor the sound flag may touch timing.** Turning the sound off
  mid-sound leaves its length alone, so a script waiting on it is released at
  the same moment either way. A game whose pacing changes with a volume key is
  a different game.

The game reaches `sound` 38 times, `stop.sound` 7 and `load.sound` 32.

Scheduling ahead of the clock means playback outlives a stalled tab, so the
player is stopped on `new.room` and on `quit` alongside the rest of the
per-room teardown.

**Done when:** the game's opening sound plays, the status line's sound state
turns it off and on, `stop.sound` silences it without hanging the script that
started it, and all 28 SOUND resources parse with every channel accounted for
byte by byte.

**Done.** 23 tests in `test/sound.test.ts`, and the whole suite at 256. The
byte-by-byte one is the strong one: for all 112 channels in the game, notes x 5
plus the two-byte terminator equals the span to the next channel's offset, which
a wrong note size cannot satisfy. The end-to-end one runs the real opening for
400 cycles through the real command path and finds the game asking for its
58-second theme, with nothing unimplemented reached on the way. The WebAudio
scheduler is tested against a recording stand-in for `AudioContext`, which is
what stops the one module a browser is needed for from being the one module
nothing checks; only `context.ts`, which exists to obey the autoplay policy,
has no test.

---

## M8 — Save and restore — complete

The spec's claim that this is cheap is now testable: interpreter state was kept
as data rather than in closures precisely so that this milestone is a
serialisation problem and not a refactor. It is mostly true, and the two places
it is not are what this milestone is really about.

### What has to be captured

```text
GameState        256 variables, 256 flags, 12 strings, the room number
Inventory        the current room of every item (not the file's start rooms)
ViewTable        every active object: view/loop/cel, position, direction, step
                 and cycle timing, motion state, priority, and its flags
Machine          horizon, block rectangle, playerControl, inputAccepted,
                 statusLineVisible, textMode, text colours, currentPicture,
                 loadedPictures, lastLine
MenuBar          which items the game has greyed out
scan starts      per-logic, see below
```

Two things are not obvious from the list:

- **`scanStart` is state, not code.** `set.scan.start` moves where a script is
  re-entered next cycle, and it is how AGI scripts wait without blocking. It
  lives on `CompiledLogic` next to the decoded instructions, which makes it easy
  to mistake for a property of the resource. Restore a game without it and a
  script that was mid-wait restarts its question from the top. The original
  interpreter saves these for exactly this reason.
- **Nothing derived is saved.** Decoded views, the picture in `background`, the
  saved sprite areas and the text layer are all reconstructed by replaying the
  room load, the same way `new.room` already builds them. Saving them would
  double the format's size and give it a second way to be wrong.

### Files

```text
src/engine/snapshot.ts      capture(machine) -> Snapshot; apply(machine, s)
src/storage/saves.ts        slots in IndexedDB; export and import a file
src/engine/savegame.ts      the save and restore dialogs, as Interactions
src/engine/commands/items.ts  save.game / restore.game stop being stubs
```

*As built:* as listed, with one substitution. The store is `localStorage`, not
IndexedDB, and the reason is shape rather than size: `localStorage` is
synchronous and so is the cycle. A script calls `save.game` mid-cycle and wants
an answer; against an asynchronous store every dialog becomes a state machine
waiting on a promise, for a database that holds eleven kilobytes per save. The
export and import ended up as two buttons in the shell rather than keys, because
every key worth having is one the game has already bound.

`snapshot.ts` is the whole milestone; the other three are how a player reaches
it. A `Snapshot` is a plain JSON-serialisable value carrying a format version
and a game fingerprint — the resource counts and OBJECT's item count, which is
already computed by `summariseGame`. Restoring a snapshot into a different game,
or one written by an older format version, is refused with a message rather than
attempted.

### Order of work

1. **`snapshot.ts` first, tested through the engine, not the DOM.** The test that
   settles it is a round trip against the golden machinery M4-M5 already have:
   run N cycles, capture, run M more, apply the capture, run those M cycles again
   and assert the screen hash matches what it was the first time. A field left
   out of the capture shows up as a diverging hash, which is the only way to find
   the ones nobody thought of.
2. **Restore has to unwind.** `restore.game` replaces the state from inside a
   running cycle, so the rest of that cycle must be abandoned exactly as
   `new.room` abandons it. `Unwind` already models this with a `kind`, so restore
   becomes a fourth kind rather than a new mechanism; the cycle then reloads the
   room from the restored room number.
3. **`storage/saves.ts`.** Named slots in IndexedDB, keyed by the game
   fingerprint. Storage can fail or be unavailable — a private window, a full
   quota — and it fails at the moment the player is trying not to lose progress,
   so it is reported in the shell like any other load failure, never swallowed.
4. **`savegame.ts`.** The dialogs are `Interaction`s, the same suspend-the-cycle
   mechanism the inventory screen and text windows use. The slot name is typed
   through the existing prompt editor. The game's own menus and key bindings
   already advertise Save and Restore, so no new input path is needed — the
   stubbed commands simply start doing something.
5. **Export and import.** A snapshot is JSON; downloading and re-uploading one is
   a few lines on top of step 3, and it is what makes a save survive the browser
   clearing site data.

### The risk this milestone carries

It is the same one M4 carried, in a new place: a snapshot that restores without
error and is subtly incomplete. There is no exception to catch, and the symptom
appears minutes later as a script behaving oddly. The round-trip hash test in
step 1 is the mitigation, and it only works if it is written before the dialogs
make manual testing feel like proof.

**Done when:** a game can be saved, the page reloaded, the save restored, and
play continues from the same picture, the same inventory and the same script
state; and the round-trip test passes over a cycle sequence that includes a
window, a scripted walk and a room change.

**Done.** 21 tests in `test/save.test.ts`, and the whole suite at 290. Three of
them carry the milestone, and they fail for different reasons: the round trip
(save, play on, restore, replay, same screen) catches state the snapshot never
captured; a second round trip into a *barely started* engine catches what only
worked because the running game already had it, which is the case a player
actually meets after a reload; and comparing a fresh capture against the
restored one catches state that is captured and then not put back. Each was
checked by breaking the code on purpose -- dropping the inventory, the horizon,
the scan starts, the scenery, and moving ego two pixels -- and every one of the
five was caught.

### What the tests found

Two real defects, both invisible by reading:

- **A restore silenced the sound after loading the flags.** Stopping a sound
  sets the flag its script was waiting on -- the rule that keeps `stop.sound`
  from stranding a script -- so the game being replaced was writing a flag into
  the state that had just replaced it. Found as a single flag differing after a
  restore into a fresh engine. The old game now ends before the new one is read.
- **A slot with no view kept the one the running game left in it.** `reset`
  releases a view table slot without emptying it, so restoring a save taken
  before an object existed left that object on screen.

### What a save cannot bring back

`add.to.pic` scenery is not in the picture file, and the picture is all a
snapshot stores of the background. The engine therefore remembers the cels a
script painted into the picture and replays them on restore, which is what keeps
the customers in Lefty's bar. That is a deliberate addition rather than a
faithful reproduction: the original redraws the picture and loses them.

---

## M9 — The sound chip switch — complete

The shell already offers the choice between a PC speaker and a PCjr and admits
it does nothing. This is the work behind it.

### Grounding: what the choice actually costs

Measured from the bundled game before planning, as everything else here was:

```text
tests of variable 22        0   -- the game never asks what it is playing on
sounds                     28   -- every one of them has notes on tone channel 0
notes per channel    1864 / 1230 / 712 / 32   (tone 1, 2, 3, then noise)
channel 0 is longest    20 of 28 sounds
attenuations on channel 0   0-13 and 15
```

Three things follow, and they are the whole shape of the milestone:

- **Nothing in the game branches on it.** Var 22 is read in no condition in any
  of the 46 scripts, so this changes what is *heard* and nothing else. That is
  what makes it a milestone of its own rather than half of the graphics one,
  where the game branches in twenty-seven places.
- **A beeper is one voice, not a quieter four.** The PC speaker plays tone
  channel 0; the other two tone channels and the noise channel are not played at
  all. That is roughly half the notes in the game, and in the eight sounds where
  channel 0 is not the longest the piece now ends when that one voice runs out.
- **A beeper has no volume.** Attenuation shapes channel 0 in fourteen of its
  sixteen steps, and a speaker can only be on or off. Attenuation 15 stays what
  it always was -- a rest -- and everything else plays at one level.

### Files

```text
src/audio/output.ts     one-voice scheduling; switching while a sound plays
src/audio/player.ts     the chip as state, so a later output inherits it
src/shell/controls.ts   the select stops saying "not built yet"
src/main.ts             the choice reaches the player, and is remembered
src/engine/cycle.ts     the reserved variable follows the choice
```

*As built:* as listed, plus two moves the plan implies without saying. `SoundChip`
left the shell for `audio/output.ts`, because a type is best kept where it is
*used* rather than where it is first offered; and remembering the choice became
`shell/settings.ts` rather than another module under `storage/`, because a
setting is about the machine the game is played on while a save is about the
game. That difference has a rule attached: a save that cannot be written stops
the player and says so, and a setting that cannot be written is quietly lost,
because one is a preference and the other is somebody's evening.

`Machine.setSoundChip` is the single entry point, and exists so that the two
things that have to agree cannot be changed apart: what is played, and what the
scripts are told they are being played on.

### Order of work

The risky part first, as everywhere: not the one-voice scheduling, which is a
filter over a loop that already exists, but **switching chips while a sound is
playing**. M7 left the machinery for it -- `play(sound, fromMs)` exists because
a context can arrive mid-theme -- and the rule it has to keep is the one volume
already keeps: *timing does not change*. A sound switched from four voices to
one must still end at the same moment, and the script waiting on it must be
released at the same moment, or a menu setting quietly changes the game's pacing.

1. **The chip as state on the player.** `SoundPlayer` owns the clock and knows
   what is playing; the chip belongs beside the volume, and a new output
   inherits it the same way.
2. **One voice in the output.** In speaker mode the scheduler builds one
   oscillator from channel 0 and ignores the rest, and gain becomes on-or-off
   rather than a curve.
3. **The reserved variable.** `VAR.SOUND_GENERATOR` follows the choice, even
   though this game never reads it, because the next one might -- and because an
   engine that says "PC speaker" while playing four voices is the state we are
   in today. *Open:* which value means PCjr. The engine writes 1 for the
   speaker; the table gives 3 for Tandy, and that needs confirming against the
   interpreter rather than assumed, since nothing in this game forces an answer.
4. **Remembering the choice.** In the browser's storage beside the saves, so it
   survives a reload. A setting a player has to make again every time is a
   setting they will stop using.

### The default, which is a decision rather than a detail

Today the engine plays four voices while telling the game it is a PC speaker.
The two have to be made to agree, and agreeing *downwards* would take away
half the notes of a game most people remember with them. So the default is the
PCjr, and the speaker is the choice a player makes on purpose -- recorded here
because it is the point where fidelity and what people want part company, and a
later reader deserves to know it was chosen rather than overlooked.

**Done when:** switching to the speaker mid-theme leaves one voice playing and
does not move the end of the sound or the flag the script is waiting on;
switching back restores the other three; the choice survives a reload; and the
tests assert the channel count in each mode against the recording output that
M7's tests already use.

**Done.** 12 tests, and the whole suite at 302. The one that matters is the one
about *not* changing: a sound switched from four voices to one is checked to
release its waiting script neither a moment early nor a moment late, which is
the same rule the volume keeps and the only way a hardware choice could have
altered the game's pacing without anyone noticing.

The hand-over turned out to be one operation rather than two. M7 already had to
give a running sound to an audio context that arrived late; a chip change is the
same move -- re-issue what is playing at the offset it has reached -- so both go
through one private method, and the timing rule is enforced in one place.

*Still open:* which value the sound-generator variable takes for a PCjr. The
engine writes 3, from the interpreter's table for a Tandy. Nothing in the
bundled game reads the variable at all, so nothing here can confirm it and
nothing here depends on it.

---

## M10 — The display driver seam — complete

The graphics modes were one milestone until they were written down, and then
they were plainly four. This one is the only one of them a test can prove, and
the only one that changes nothing on screen.

### Grounding: what the original shipped

The four modes are not a guess about which adapters mattered in 1987. The game's
own directory names them, one driver per adapter:

```text
EGA_GRAF.OVL   1024 bytes      HGC_GRAF.OVL   1536 bytes
CGA_GRAF.OVL   1024 bytes      HGC_FONT       3072 bytes
JR_GRAF.OVL     512 bytes      HGC_OBJS.OVL   1024 bytes
                               IBM_OBJS.OVL    512 bytes
```

Two things in that list are already an answer. Hercules brings **its own font**,
so text is not merely drawn in one colour; and the `*_OBJS` pair says the object
drawing differs too, not only the palette.

### The seam

Each mode is its own **display driver**: a layer the engine draws *through*
rather than one it knows about, which is how the original was built and swapped
at startup. What crosses downwards is not pixels but what the engine has -- the
two 160x168 screens, the grid of character cells with their colours, and any
window over them. What a driver decides for itself:

```text
its canvas size and pixel aspect      how a character cell becomes pixels
its palette, and how 16 map to fewer  its font
```

That last pair is why the seam has to carry more than colours. **Hercules is
720x348**, not 320x200, and its font is not the engine's: `HGC_FONT` is 3072
bytes, which is 256 glyphs of 12 bytes -- an 8x12 cell against the 8x8 the
engine draws now. A layer that could only choose a palette would have nowhere to
put either fact.

The work is in finding the seam, because today there is none. Everything that
draws -- the picture, the sprites, the text layer, the windows, the interactions
-- writes into a single 320x200 buffer of palette indices in
`render/display.ts`, by way of `engine/present.ts`. That buffer is not "the
display"; it is *the EGA driver's* display.

### Files

Five rather than four: the thing that crosses the seam turned out to need a
name and a file of its own, and once it had one the interactions were the work
rather than the renderer.

```text
src/render/frame.ts              what crosses the seam: layers, in cells and
                                 picture pixels, in the order they are drawn
src/render/drivers/driver.ts     what a display driver is, and what it is given
src/render/drivers/ega.ts        today's rendering, behind the seam
src/render/drivers/index.ts      the one place a mode name becomes a driver
src/engine/present.ts            builds a frame; draws nothing itself
src/shell/canvas.ts              the canvas sized by the driver, not by 320x200
```

Not in that list, and where the change was actually felt:

```text
src/engine/interaction.ts   Interaction.draw takes a frame, not a framebuffer
src/engine/inventory.ts     an item's close-up asks for a cel, not a rectangle
src/engine/menu.ts          the menu bar asks for cells
src/engine/savegame.ts      the save and restore screens with it
src/render/text.ts          the cell blitter takes the driver's cell and font
src/render/display.ts       a framebuffer with a size and a palette, not the
                            display; 320x200 is only its default
```

### Order of work

1. **The interface, written against the hardest mode.** Hercules is the one that
   moves size, font and cell shape at once, so the interface is designed to
   carry those even though nothing implements them yet -- an interface shaped
   around EGA would have to be rewritten at M13.
2. **EGA behind it**, doing exactly what the engine does today.
3. **The canvas from the driver**: backing size and pixel aspect asked for
   rather than assumed.

Nothing above the seam may ask which driver is running. The one fact that
travels back up is the reserved monitor variable, and that is the scripts'
business rather than the renderer's -- which is M11.

**Done when:** every pixel the game draws goes through one EGA driver, the
canvas takes its size from it, and the golden tests are untouched. That last
clause is the milestone: this is a change that is *supposed* to be invisible,
and the tests are what say it was.

### What the seam turned out to be

The plan said what crosses down: two screens, cells with colours, a window. It
was one entry short, and the missing one is the interesting one. `show.obj`
draws a **lone VIEW cel** for an item's close-up -- the only place outside the
picture where the engine wants a sprite -- and the original shipped
`HGC_OBJS.OVL` beside `IBM_OBJS.OVL` for exactly that. So a cel is the fourth
thing a frame can hold, positioned in the picture's own rows and centred by the
driver.

A frame is an **ordered list**, not a set of layers by kind. AGI's order is not
a hierarchy: a window sits over the text plane, but a script that writes on the
input row expects its text over the command line, and the interaction the game
is waiting for is over all of it. Keeping the caller's order is what let
`present.ts` stay the one place that decides the order, which is what it was
before.

The seam moved more code than expected, and in one direction: **the
interactions**. A message window, a question, the inventory page, the menu bar,
the save and restore screens all drew pixels, and all of them now describe
cells. That is the half of the milestone that a palette-only interface would
have left undone, and it is why Hercules can have a message box in its own font
without any of those five files knowing.

Two smaller findings, both about assumptions that had gone unnamed:

- The **character grid is 40x25 always**, and it was being derived from
  320 / 8. Those are different facts: the scripts address forty columns whatever
  the adapter, and eight pixels is EGA's answer to what a column is. Hercules
  has forty columns on a 720-pixel screen, so its cell is eighteen wide with an
  eight-wide glyph in it -- which is why the cell blitter now scales a glyph to
  its cell rather than assuming they are the same size.
- **A window's padding is a cell**, not eight pixels. It read as eight because
  EGA's cell is eight; on a twelve-row cell the same rule gives a box that still
  looks like a box.

EGA asks to be presented with **square pixels**, which looks wrong until it is
said out loud: the correction has already happened. The picture is 160 across
and the buffer is 320, so the doubling is what makes an AGI pixel square. A
driver whose buffer is *not* already corrected reports something else, and the
canvas acts on it -- which is the property that keeps this milestone invisible
while leaving 720x348 room to be right.

### What the tests found

Nothing, which for this milestone is the result. The golden tests were not
touched and did not move, and exactly one of the 302 existing tests changed --
the one that handed a question a framebuffer, which is the signature that no
longer exists.

The tests added are about the shape of the seam rather than about pixels, since
pixels are what is *supposed* to be unchanged:

```text
a real frame is described in cells and screens, never in pixels
the frame the engine describes is the frame the driver draws
a driver keeps nothing between frames, so switching repaints in full
the same frame draws at another size, with another cell
a two-colour palette survives being handed a fifteen
```

The fourth is the one that earns its keep. It renders a real frame through a
stub driver at Hercules' 720x348 with a twelve-row cell, and it is what says the
interface was designed against the hardest mode rather than around EGA. The
fifth is a defect it found on the way: the framebuffer masked colour indices
with `& 0x0f`, which is sixteen colours assumed rather than asked for, and a
two-colour driver handed a fifteen would have read past the end of its palette.

---

## M11 — What the scripts are drawn on — not started

The half of the graphics work that has nothing to do with pixels, and the half
that is testable. The game asks what it is being displayed on and lays itself
out accordingly, and none of that needs a new palette to build or to see.

### Grounding: what the scripts actually ask

```text
tests of the monitor-type variable   27, of which 26 are "is this mono?"
what those branches do               move text between rows 21/22 and 23/24,
                                     call configure.screen(1, 23, 0), and
                                     twice show view 151 instead of another
tests of the computer-type variable  11, all in the help screen (logic 55)
```

So the scripts distinguish **mono from everything else**, and nothing more: CGA,
PCjr and EGA all take the same path. The computer type is a separate question,
and the game reads it only to choose which help page to show -- keyboard,
joystick or mouse.

`configure.screen` is the command the mono branch calls to move the picture area
and the input row, and this engine implements it as a no-op. Until it is real,
Hercules cannot be anything but wrong, and the rows the engine draws text on are
constants rather than something the game may move.

### Files

```text
src/engine/commands/text.ts   configure.screen stops being a no-op
src/render/text.ts            the rows become state rather than constants
src/engine/cycle.ts           the monitor and computer variables follow the choice
(no new driver)               EGA's pixels are the PCjr's pixels, so M10's
                              EgaDriver already answers for it; what M11 adds
                              is the answer the scripts get
src/shell/controls.ts         the select stops saying "not built yet" for PCjr
src/shell/settings.ts         the choice survives a reload (M9 built this;
                              the graphics mode is already kept in it)
```

### Order of work

1. **`configure.screen`, for real**, and the text rows with it. This is where a
   defect hides: the status line, the prompt row and the picture's top row are
   constants in three modules, and a game that can move them will find every
   place that assumed it could not.
2. **The variables follow the choice**, so the scripts are told what the shell
   was told.
3. **PCjr, which is EGA with a different answer.** The cheapest mode there is --
   the PCjr's 160x200 mode uses the palette AGI already targets, so its pixels
   are EGA's. It is worth building first anyway, because it proves *switching
   drivers* with no rendering work to hide a mistake behind.
4. **Remembering the choice**, with M9's.

**Done when:** choosing PCjr changes the help page the game offers; telling the
engine it is mono moves the input row and shows the game's mono view, while
still drawn in EGA colours; and the choice survives a reload.

---

## M12 — CGA — not started

Four colours, and the sixteen the game draws in reached by dithering pairs of
pixels. Pure rendering: the scripts cannot tell CGA from EGA, as M11 measured.

The mapping cannot be read out of the original driver -- `CGA_GRAF.OVL` is not
bundled, because the repository ships only the game's resource files. It is
derived instead, and checked the way the opcode table was checked: by rendering
the game's own pictures and looking at whether the result is coherent, rather
than by comparing against a table nobody here can consult.

```text
src/render/drivers/cga.ts   four colours, and the dither that reaches 16
```

**Done when:** every picture in the game renders in CGA through its own driver,
the dither holds together at the scale the canvas presents it, and EGA is
untouched.

---

## M13 — Hercules — not started

The mode that moves everything at once, and the reason the seam of M10 carries
size and font: 720x348, two colours, an 8x12 font of its own, and its own object
drawing in `HGC_OBJS.OVL`. Its layout arrived in M11, which is what makes this
milestone only about pixels.

```text
src/render/drivers/hercules.ts   two colours, 720x348, its own cell
src/render/font.ts               the Hercules font beside the IBM one
```

The font is the part with a fact attached: 3072 bytes, 256 glyphs of 12 bytes.
The palette has none -- two colours and a dither, derived and judged by eye.

**Done when:** Hercules draws the game at its own size on a canvas that follows
it, in its own font, and switching to it and back repaints without reloading the
room.

### The risk these four carry

Not correctness that a test can catch, but *plausibility*. Nobody here can
compare the result against a Hercules card, and a CGA palette that is merely
wrong-looking passes every test a test can be. Two mitigations, and they are the
ones the project has used since M2: render the game's own pictures in each mode
and look at them, and keep the EGA golden tests green so that a mode nobody can
check cannot quietly disturb the one mode that is known to be right.

---

## Testing strategy

Three layers, in the order they catch things:

```text
format tests    decoders against the real game files: every LOGIC decodes,
                every VIEW decodes, WORDS.TOK round-trips, OBJECT parses
unit tests      opcode decoding, message decryption, parser matching,
                blocking rules, reserved variable semantics
golden tests    load the game, run N cycles from a fixed start, hash the
                visual screen, compare to a recorded value
```

Golden tests only become possible at M4 and only become meaningful at M5. The
first one to record is "room 1, 60 cycles, no input" — it catches almost any
regression in picture drawing, sprite compositing or cycle ordering, and it costs
one hash to store.

Rendering stays headless: the engine composes into a pixel buffer, and only the
final blit needs a canvas. No browser is needed to test the engine.

## Risk register

```text
risk                              likelihood  mitigation
opcode table wrong for 2.440      medium      M3 whole-game validation test
WORDS.TOK packing misread         medium      spike pulled forward into M1
reserved var/flag semantics wrong high        named constants; behaviour-named
                                              tests; disassembler to read intent
sprite restore ordering           medium      two-pass restore/draw; golden test
timing fidelity                   low         fixed timestep; tune against
                                              observed behaviour, not guesswork
game-specific quirks in LSL1      unknown     surfaces at M4-M6; the disassembler
                                              is what makes it diagnosable
autoplay policy blocks audio      high        M7 builds the context first; a
                                              suspended context degrades to
                                              silence, never to a stall
incomplete save snapshot          high        M8 round-trip hash test, written
                                              before the dialogs exist
```

The highest risk is not any single format — those are now measured — but the
reserved variables and flags. They are where a game runs without error and still
behaves wrongly, and no test of the file formats will catch it. That is the
argument for the disassembler existing before the interpreter.

## What is deliberately not in this plan

Player-supplied game files and AGI v3 stay where the spec put them: later
phases. Both are confined to the resource layer by design, so neither needs a
milestone until there is a second game to run.

Sound and save/restore were in this list while M0-M6 were the whole plan. The
two concessions v1 made to them — sound commands setting their flags, and
interpreter state kept as data rather than in closures — are what let them
arrive as M7 and M8 rather than as a rewrite. That was the bet, and it paid:
sound changed no control flow, and saving turned out to be one module of
copying fields plus a second that rebuilds what the fields imply. The two
defects M8 found were both about *order and emptiness* — a flag written after
the state that replaced it, a slot released without being emptied — and neither
is the kind of thing keeping state in closures would have made easier.

## Open questions still open

Two of the spec's four are answered above. These remain:

- ~~Whether LSL1 needs a game-specific loader for interpreter quirks.~~
  Answered: no. What it needed instead were three rules the documentation does
  not state — a control line is a gap in the depths rather than a depth, a
  moving object draws over a stopped one at the same priority, and a script
  spinning on `have.key` is waiting rather than looping — and all three belong
  to the engine, not to this game.
- ~~Whether the debug overlay ships in the production build.~~ Answered: it
  ships. The whole of `shell/debug.ts` plus the disassembler is about 1 KB
  gzipped, which is not worth a build flag and a second code path.
