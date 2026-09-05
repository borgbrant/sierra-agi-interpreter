# Implementation plan: web-agi

Companion to [spec.md](spec.md). The spec says _what_ to build; this says in what
order, in which files, and how each step is proven to work.

> **M0-M17 are done and shipped.** The
> milestones are kept as they were written, for the reasoning behind the
> sequencing and for the format measurements in the next section. They are not a
> description of the code as built: several modules ended up named or split
> differently, and the file lists below say so where they differ. For the current
> shape of the system, read [spec.md](spec.md) and the source. Where the two
> disagree, the spec is the one to trust.

```text
M0  Workspace foundation                complete
M1  Resource layer                      complete
M2  Static rendering                    complete
M3  Reading LOGIC                       complete
M4  The machine runs                    complete
M5  Ego moves                           complete
M6  Playable                            complete
M7  Sound                               complete
M8  Save and restore                    complete
M9  The sound chip switch               complete
M10 The display driver seam             complete
M11 What the scripts see                complete
M12 CGA                                 complete
M13 Hercules                            complete
M14 The shell the player sees           complete
M15 The dither the original shipped     complete
M16 CGA, as the original drew it        complete
M17 The page, designed                  complete
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
_next_ one has a way to see what it is doing. Concretely: the disassembler
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

- `view.js`: drop `Buffer` so the VIEW decoder runs in a browser. _As built:_ the
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

_As built:_ `picture.ts` was not needed as a separate module — wrapping
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

_As built:_ `interpreter.ts` is `engine/machine.ts`, and waiting is a generator
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

_As built:_ as listed. `engine/menu.ts` also carries `KeyBindings`, the
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
scripts wait on; what changes is _when_ the flag is set.

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

_As built:_ a third module, `src/audio/output.ts`, holds the `SoundOutput`
interface and the WebAudio implementation, leaving `player.ts` with only what
the engine knows: which sound is running and who is waiting for it. That split
is what lets every rule below be tested headlessly against a recording output,
with WebAudio itself the only part that needs a browser. `SILENT_OUTPUT` in the
same file is what the engine runs against before a gesture has happened.

`sound.ts` is a decoder and belongs with the other format readers, next to
`words.ts` and `objects.ts`: it is about the _format_, so it is written the way
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
   _also_ release whatever was waiting, or a script that stops its own sound and
   then waits for it hangs — the one deadlock this milestone can introduce that
   M4's no-op could not.

_As built:_ the autoplay policy turned out to be the whole of the milestone's
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
line shows the game's own sound flag and a game that says _Sound:on_ while
playing nothing is worse than one that says what it is doing.

Audio is scheduled on the audio clock as planned, but _the flag_ is
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

_As built:_ as listed, with one substitution. The store is `localStorage`, not
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
captured; a second round trip into a _barely started_ engine catches what only
worked because the running game already had it, which is the case a player
actually meets after a reload; and comparing a fresh capture against the
restored one catches state that is captured and then not put back. Each was
checked by breaking the code on purpose -- dropping the inventory, the horizon,
the scan starts, the scenery, and moving ego two pixels -- and every one of the
five was caught.

### The mode that came out

The plan had four modes and the shell now offers three. The PCjr is gone, and
what the milestone measured is the argument for taking it out.

A PCjr differs from an EGA in three places, and building M11 emptied two of
them:

```text
its pixels          identical -- the 160x200 mode *is* the sixteen-colour
                    palette AGI was drawn for, so there is no driver to build
its monitor value   1, and no branch in the game distinguishes it: the 26 mono
                    tests ask for 2, and logic 0:89 is guarded by an
                    `equaln(20, 0)` a PCjr fails
its computer type   1, which binds the digit keys 1-0 at logic 51:307 to the
                    controllers every other machine reaches with F1-F10
```

So a graphics mode whose entire observable effect is a keyboard mapping -- and a
keyboard mapping that belongs to the _computer_ the game runs on rather than to
the monitor it is drawn on. A select offering four modes of which one can never
look different from another misdescribes what the engine can do, so the choice
is three modes that mean three things.

What that costs is one real behaviour, and it is recorded in
`engine/hardware.ts` rather than lost: a PCjr's chiclet keyboard had no function
keys, the game knew it, and it bound the number row instead. There is a test
that asserts no machine the shell can describe reaches that branch -- so the day
a _computer_ choice is added, that test is what fails and points at it.

A smaller consequence, worth having: `computerTypeFor` now takes only the sound
chip. The computer type was inferred from the pair of choices while a PCjr
display was one of them; with it gone there is exactly one thing left to infer
from, and a Tandy 1000 is the one machine other than a plain PC the shell can
describe. The stored settings needed no migration -- a `pcjr` left in a
browser from before falls back to the default the way any unrecognised value
does, which is what the checked `pick` in `shell/settings.ts` was for.

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
  of the 46 scripts, so this changes what is _heard_ and nothing else. That is
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

_As built:_ as listed, plus two moves the plan implies without saying. `SoundChip`
left the shell for `audio/output.ts`, because a type is best kept where it is
_used_ rather than where it is first offered; and remembering the choice became
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
already keeps: _timing does not change_. A sound switched from four voices to
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
   in today. _Open:_ which value means PCjr. The engine writes 1 for the
   speaker; the table gives 3 for Tandy, and that needs confirming against the
   interpreter rather than assumed, since nothing in this game forces an answer.
4. **Remembering the choice.** In the browser's storage beside the saves, so it
   survives a reload. A setting a player has to make again every time is a
   setting they will stop using.

### The default, which is a decision rather than a detail

Today the engine plays four voices while telling the game it is a PC speaker.
The two have to be made to agree, and agreeing _downwards_ would take away
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
about _not_ changing: a sound switched from four voices to one is checked to
release its waiting script neither a moment early nor a moment late, which is
the same rule the volume keeps and the only way a hardware choice could have
altered the game's pacing without anyone noticing.

The hand-over turned out to be one operation rather than two. M7 already had to
give a running sound to an audio context that arrived late; a chip change is the
same move -- re-issue what is playing at the offset it has reached -- so both go
through one private method, and the timing rule is enforced in one place.

_Still open:_ which value the sound-generator variable takes for a PCjr. The
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

Each mode is its own **display driver**: a layer the engine draws _through_
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
display"; it is _the EGA driver's_ display.

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
clause is the milestone: this is a change that is _supposed_ to be invisible,
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
driver whose buffer is _not_ already corrected reports something else, and the
canvas acts on it -- which is the property that keeps this milestone invisible
while leaving 720x348 room to be right.

### What the tests found

Nothing, which for this milestone is the result. The golden tests were not
touched and did not move, and exactly one of the 302 existing tests changed --
the one that handed a question a framebuffer, which is the signature that no
longer exists.

The tests added are about the shape of the seam rather than about pixels, since
pixels are what is _supposed_ to be unchanged:

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

## M11 — What the scripts are drawn on — complete

The half of the graphics work that has nothing to do with pixels, and the half
that is testable. The game asks what it is being displayed on and lays itself
out accordingly, and none of that needs a new palette to build or to see.

### Grounding: what the scripts actually ask

The numbers below were the plan's, written from a first pass over the scripts.
Three of the four turned out to be wrong, and they are left standing because
the corrections are the interesting part of the milestone:

```text
tests of the monitor-type variable   27, of which 26 are "is this mono?"
what those branches do               move text between rows 21/22 and 23/24,
                                     call configure.screen(1, 23, 0), and
                                     twice show view 151 instead of another
tests of the computer-type variable  11, all in the help screen (logic 55)
```

The monitor count held: 27 tests at 26 sites, and 26 of them ask `equaln(26, 2)`
and nothing else. The scripts distinguish **mono from everything else**, and the
twenty-seventh test is logic 0 asking for an IBM PC that is neither mono nor
EGA -- which is to say CGA, and is the only script-visible difference that mode
has.

What was wrong:

- **`configure.screen` is not the mono branch's.** Logic 51 calls it once, at
  start-up, unconditionally, with `(1, 23, 0)` -- exactly the numbers the engine
  had assumed. So making it real fixes nothing in this game and removes an
  assumption instead, which is a smaller thing than the plan thought and worth
  doing anyway.
- **The mono branches do not move the engine's rows.** They move the _game's_:
  it drops a line it would otherwise print, or prints it on another row, or
  narrows an input field from 38 characters to 28. The engine's layout is not
  involved, and could not be -- the scripts address rows directly.
- **The computer type is not only the help screen's.** Ten sites, in logics 0,
  51 and 55: logic 0 builds a different menu for it, logic 51 binds different
  keys, and only logic 55 shows a different page. The first two are the ones
  that can be seen without reading a help page, and they are what this milestone
  is tested against.
- **View 151 is the colour view, not the mono one.** Logic 38 loads 151 when the
  display is not mono and 146 when it is, at two sites. The pair was right and
  the direction was backwards.

### Files

```text
src/engine/layout.ts          the three rows a game may move, in one place
src/engine/hardware.ts        what the scripts are told, and what was measured
src/engine/commands/text.ts   configure.screen stops being a no-op
src/engine/commands/items.ts  toggle.monitor stops being a no-op
src/engine/machine.ts         setDisplayMode, and the two variables kept in step
src/engine/cycle.ts           the variables follow the choice at start-up
src/engine/present.ts         the status and input rows come from the game
src/engine/snapshot.ts        the layout is part of a saved game
src/render/text.ts            the rows stop being constants here
src/render/frame.ts           the picture's row travels in the frame
src/shell/controls.ts         every mode says what choosing it does
src/main.ts                   the choice reaches the scripts, not only the driver
```

No new driver, and one fewer mode than the plan had. The PCjr came out; see
below.

### Order of work

1. **`configure.screen`, for real**, and the text rows with it. This is where a
   defect hides: the status line, the prompt row and the picture's top row are
   constants in three modules, and a game that can move them will find every
   place that assumed it could not.
2. **The variables follow the choice**, so the scripts are told what the shell
   was told.
3. ~~**PCjr, which is EGA with a different answer.** The cheapest mode there is
   -- the PCjr's 160x200 mode uses the palette AGI already targets, so its
   pixels are EGA's. It is worth building first anyway, because it proves
   _switching drivers_ with no rendering work to hide a mistake behind.~~
   Dropped, and the mode with it. Its second sentence was already paid for by
   M10, which proved driver switching against a stub at Hercules' size; and its
   first turned out to be the whole of the mode rather than its cheapness. See
   _The mode that came out_.
4. **Remembering the choice**, with M9's.

**Done when:** choosing PCjr changes the help page the game offers; telling the
engine it is mono moves the input row and shows the game's mono view, while
still drawn in EGA colours; and the choice survives a reload.

### What it is done by instead

Two of the three clauses could not be met as written, and neither for want of
work. The **first** is gone with its mode: no PCjr is offered, so no help page
changes for one. The **middle** describes something the engine does not do --
it does not move the input row on a mono screen; the game moves its own rows,
and this game never asks `configure.screen` for a different input line at all.
Only the third stood.

What replaced them are four consequences that can be seen rather than one that
cannot:

```text
CGA      the Options menu gains "Graphics Mode <Ctrl-R>", and only for CGA
Tandy    `=` `-` and `+` are bound, and the volume they change works; on a PC
         speaker the game offers neither
mono     the opening credits on rows 23 and 24 are not printed at all
Ctrl-R   flips the answer between mono and the chosen display, and back
```

The **Tandy** is the one that needed a decision. The computer type is a separate
variable from the monitor and the shell has no control for it, so it is inferred
from the choice that bears on it: the PCjr's sound chip with ordinary graphics is
a Tandy 1000, and anything else is an IBM PC. A third select saying "Computer"
would have been more direct and worse -- it would let a player describe a machine
that never existed, and the game would then be told something untrue about the
hardware it is running on.

The game's own branches name that machine more precisely than the documentation
does: computer type 2 is the only one given volume keys, and the PCjr sound chip
is the only one in the list whose volume can be changed at all. A Tandy 1000,
identified by what the game does for it rather than by a table.

### What the tests found

One defect, and it was in the tests rather than the engine: an early version
asserted the command line was drawn on the input row after 120 cycles of the
opening, and it is not -- the opening has written its credits across rows 23 and
24, and the command line yields to text a script put there. That rule was M6's
and it is right; the test was reading a correct behaviour as a missing row.

The thirteen tests added are consequences rather than variables. Only two of
them read a reserved variable at all; the rest ask whether a menu item exists,
whether a key is bound, and whether a line of the opening was printed -- which
is what a player would notice, and what a wrong answer would actually break.

---

## M12 — CGA — complete

Four colours, and the sixteen the game draws in reached by dithering pairs of
pixels. Almost pure rendering: M11 found the one script-visible difference CGA
has -- logic 0 offers it a graphics-mode toggle and offers it to nothing else --
and that half is already built, so what is left here is the palette.

The mapping cannot be read out of the original driver -- `CGA_GRAF.OVL` is not
bundled, because the repository ships only the game's resource files. It is
derived instead, and checked the way the opcode table was checked: by rendering
the game's own pictures and looking at whether the result is coherent, rather
than by comparing against a table nobody here can consult.

```text
src/render/drivers/cga.ts   four colours, and the dither that reaches 16
src/render/text.ts          TextLayer.draw learns how a driver maps colours
```

**Done when:** every picture in the game renders in CGA through its own driver,
the dither holds together at the scale the canvas presents it, and EGA is
untouched.

### The dither is free, which is why AGI could offer this mode at all

An AGI pixel is twice as wide as it is tall, so the EGA driver spends its
320-pixel width _duplicating_ each of the picture's 160 pixels. CGA spends the
same two pixels on colour instead: a pair drawn from four colours, blending at
the size the canvas presents it. Nothing is given up to make room for it, and no
picture had to be redrawn -- which is the answer to why a 1987 game could ship
four adapters off one set of resources.

The arithmetic is where the milestone's whole difficulty lives. Two colours from
four is **ten** distinct blends, not sixteen: `(a,b)` and `(b,a)` are the same
colour whatever order they are drawn in. So six of AGI's sixteen must share an
appearance with another, and the only question is which six.

### Grounding: how little slack there is

Measured before deriving anything -- 43 pictures, 1,155,840 pixels, and the
277,937 places where two colours meet:

```text
every one of the 16 colours is drawn         so no collision is free
110 of the 120 colour pairs are drawn        so almost every collision costs
  adjacent somewhere in the game               a boundary the artist drew
the 10 pairs that never touch all involve    dark grey is the only colour
  colour 8, dark grey                          with any slack at all
```

### Which palette, and a result that contradicts the obvious guess

> M16 replaces the whole of this: `CGA_GRAF.OVL` selects the palette itself and
> translates through a table in `AGIDATA.OVL`. The scoring below was careful and
> it was answering a question the original had already answered in a file this
> repository has had since M0.

CGA's 320x200 mode offers two palettes in two intensities. All four were scored
against the colours this game actually draws, weighted by how many pixels of
each it draws:

```text
palette                             colour error   boundaries lost
1 low    black/cyan/magenta/grey          113.2M              4.3%
1 high   black/lcyan/lmagenta/white       117.4M             13.8%
0 high   black/lgreen/lred/yellow         129.7M             13.1%
0 low    black/green/red/brown            203.2M             19.7%
```

**Palette 1 at low intensity wins on both counts at once**, and the bright
cyan-and-magenta everybody remembers from Sierra CGA screenshots comes second by
a wide margin. The reason is worth keeping: with every non-black entry bright,
dark red lands nearer to _black_ than to anything else, so colour 4 collapses
into colour 0 -- the second most common boundary in the game, 29,800 pixels of
it. Low intensity has dark and mid tones among its blends, and half of AGI's
palette is its dark half.

### What a metric could not settle

Three mappings were built, and the two a metric recommends are the two that
look worst:

```text
mapping                    boundaries lost   what it does to the opening
nearest match, light
  green moved                        4.08%   all three objects survive
nearest match                        4.25%   light green and light cyan
                                             collapse: the green pennant
                                             disappears into the sky
fewest collisions (no blend          3.26%   yellow is forced off the bright
  used more than twice)                      blend onto light cyan's: the
                                             notepad the scene is *about*
                                             vanishes into the sky
```

That is the finding to carry into M13. **A boundary count undervalues the
outline of a large region.** An object's edge is its perimeter -- a few hundred
pixels -- while the object is its area, so a metric summing edges will trade
away the one boundary that makes a shape a shape. The 489 pixels where yellow
meets light cyan _are_ the outline of the notepad, and a search that saw them as
489 pixels threw the notepad away to save 2,000 elsewhere.

So the table is nearest match with one entry moved, and the move was decided by
rendering the game's own pictures and looking at them -- which is exactly the
mitigation this plan wrote down for these four milestones, used in earnest for
the first time. Light green goes to its second-nearest blend, 3.9% of the
black-to-white range further off, and hands back the pennant.

Black and white turned out not to need pinning: nearest match already puts them
on the darkest and brightest blends. That is worth knowing because the
fewest-collisions search _did_ need it -- left free it put white on a mid
cyan-grey and light grey on the bright blend, inverting the two.

### The one loss that cannot be recovered

Three quarters of everything CGA gives up is a single group: light grey, yellow
and white on the brightest blend, 8,328 boundary pixels. Colour 7 is _exactly_
170,170,170, which is the brightest blend there is, and white has nowhere
brighter to go. No rearrangement helps -- a palette whose brightest colour is
light grey cannot show a highlight on light grey.

### Text is not dithered, and that took a rule of its own

A character cell is eight pixels wide and a glyph's stroke is one or two of
them, so a dithered stroke is a stroke with holes in it: the letter stops being
a letter. Text is drawn solid, ink and ground both, from a second and smaller
table -- and the line the driver draws is that **pictures are dithered and text
furniture is solid**, which puts `fill` and `rows` on the solid side with the
text and leaves `picture` and `cel` on the dithered side.

That second table needed one rule beyond nearest match, and the game supplied
the reason. Taken as pure nearest match, red, brown and dark grey all land on
black -- and the bundled game sets `set.text.attribute(6, 0)`, brown on black,
in five places. Black ink on a black ground is not an approximation of a
colour, it is a line of text that is not there. **Only colour 0 may become
black**, and with that rule every attribute pair the game sets stays legible,
the closest being brown on light grey.

One seam change fell out of this: `TextLayer.draw` now takes an optional
`ColourPair` saying how a driver maps sixteen colours to its own. Everywhere
else the driver has the two numbers in hand and maps them itself; the text plane
holds its colours per cell, out of the driver's reach. It is a pair rather than
two calls because the interesting case is the pair -- a driver with four colours
can map two different colours onto one, and there is a fallback that pushes the
ink somewhere visible when it would otherwise land on its own ground. The
bundled game never needs it; a game with cyan text on a light cyan ground would.

### What the tests found

Nothing in the engine, and that is the expected result for a milestone that
adds a driver rather than changing one. The 323 tests before it were untouched
and stayed green, EGA included.

The fourteen added do not try to say the mapping is _right_, because no test
can. They say what it is and what it costs, and they recompute the cost from
the game's own pictures rather than trusting a comment:

```text
sixteen colours reach ten appearances, which is all there are
the game draws every colour, so none is free to collide
the recorded collisions are the collisions the table has
each collision costs what it is recorded as costing
brown and dark grey are the one collision the game never notices
only black is drawn as black, or text goes missing
ink never lands on its own ground
the attribute pairs the bundled game sets are all legible
a CGA frame holds nothing but the four colours it has
the dither is a checkerboard, not a set of stripes
CGA leaves EGA alone
```

The third and fourth are the ones with teeth. Changing an entry in the table
now fails a test that names the boundary count it changed, so the next person to
adjust it has to say what they are trading and what for -- which is the only
defence a mode nobody can check against real hardware has.

---

## M13 — Hercules — complete

The mode that moves everything at once, and the reason the seam of M10 carries
size and font: 720x348, two colours, an 8x12 font of its own, and its own object
drawing in `HGC_OBJS.OVL`. Its layout arrived in M11, which is what makes this
milestone only about pixels.

Two things carried over from M12. The dither method, with harsher arithmetic --
720x348 against a 160x168 picture is four pixels wide by two tall, and two
colours over eight pixels is nine densities for sixteen colours. And the metric
lesson: a count will happily hide an object, so the mapping was judged by
rendering the game's pictures and looking at them. That is what caused the first
mapping here to be thrown away.

```text
src/render/drivers/hercules.ts   two colours, 720x348, its own cell
src/render/text.ts               CellMetrics learns about letter spacing
src/engine/present.ts            the command line becomes a box on a mono screen
src/shell/canvas.ts              a 720-wide buffer can reach a whole multiple
```

No new font, and that is the one thing this milestone could not do. `HGC_FONT`
is 3072 bytes -- 256 glyphs of twelve rows -- and it is an _interpreter_ file,
so it is not in a repository that ships only the game's resources. The shapes
the original drew are not recoverable at any price. What this draws is the
engine's own 8x8 IBM font in Hercules' cell.

### A photograph changed how this milestone could be done

The plan said nobody here could compare the result against a Hercules card. That
turned out to be wrong: a screenshot of the real thing arrived, and it moved two
things from _derived and judged by eye_ to _derived and checked_.

The first is the geometry, which is arithmetic once two facts are in hand --
Hercules is 720x348, and `HGC_FONT`'s 3072 bytes over 256 glyphs is a twelve-row
cell:

```text
the picture at 4x wide, 2x tall     640 x 336
unlit either side                   (720 - 640) / 2 = 40 pixels
the grid across the picture         40 columns of 16, not of 18
AGI's rows 1-24 are the picture     336 over 24 rows is a 14-row cell
```

The photographs settle all four, and two of them only after being read twice.
The picture is 640 of 720 wide -- 88.9% -- with unlit margins either side. It
reaches the **bottom** of the screen, with no dead band under it. And the status
bar is exactly as wide as the scene, with the game's bottom band starting at the
scene's left edge rather than the screen's -- so **the grid goes across the
picture's 640 pixels, not across all 720**, which makes the cell 16 wide rather
than 18 and lines the text up with the game instead of with the screen.

The row height falls out of that. If AGI's rows 1 to 24 are the picture's 336
rows, each row is 14 -- and row 24 then ends at the bottom of the screen, so the
three rows AGI keeps for its prompt are the screen's last three. That is where
the photographs put the game's bottom band: flush with the bottom edge, not
floating a few rows above it. Twenty-five 14-row cells is 350, two past a
348-row card, so the last two pixels of row 24 fall off.

Getting the cell wrong put the band two rows up and its text a cell and a half
left of the scene. Neither is a subtle error and neither was noticed from a
render; both were noticed by holding the render next to the photograph.

### The letter spacing was the font's all along

The photographs' text is conspicuously spaced, so the glyph was drawn at 8 bits
in the 16-pixel cell -- half-filling it and leaving eight pixels of air. Wrong:
the letters came out thin and narrow where the photographs show them thick and
wide, because a one-pixel stroke doubles to two and a half-width glyph does not.

The glyph fills the cell, and **the spacing comes from the font**. Only two of
the engine's 95 glyphs use their rightmost column -- `*` and the full-width `_`
-- so every other character carries a blank column of its own, which doubles to
two pixels of ground beside it. That is a property of every PC font in this
family rather than an accident of this one, which is why it is worth naming: a
`glyphWidth` field was added to the cell to hold the gap and then removed again,
because the font had been doing the job all along.

A `glyphHeight` field went the same way, and its measurement is the more useful
one. The glyph was drawn at twelve rows of the cell's fourteen, on the reasoning
that twelve is `HGC_FONT`'s height and the rest is leading -- and the strokes
came out uneven, which is most of what made the text look smeared:

```text
8 font rows into 12   drawn 2,1,2,1,2,1,2,1   four strokes thinned
8 font rows into 14   drawn 2,2,2,1,2,2,2,1   two, and one of them is the
                                              font's blank bottom row
8 font rows into 16   drawn 2,2,2,2,2,2,2,2   none, and it does not fit
```

So the glyph fills all fourteen. **A cell is filled rather than part-filled
because of the arithmetic of repeating rows, not because of leading** -- which
is worth knowing before reaching for a leading field again.

### The bottom band, and two defects it uncovered

The game's bottom band -- "Please answer a, b, c, or d:", the speed indicator,
its captions -- came out printed _on the scene_ rather than on a black bar. The
first diagnosis was that the geometry must be wrong: the picture could not
really reach those rows, or the band would have nowhere clear to sit. So the
picture was moved to AGI's rows 1 to 21, which fixed the symptom and left a dead
unlit band along the bottom that the photographs plainly do not have. Wrong
answer, and the photographs said so.

The right one is in the command, and a measurement of the game finds it. Every
one of its 34 `clear.lines` calls is on rows 21 to 24 and every one clears to
**black**:

```text
clear.lines  rows 21-21, 22-22, 22-24, 23-23, 23-24, 24-24   all to colour 0
             and not one call anywhere on rows 1 to 20
display      rows 22, 23 and 24, nineteen times between them
```

The two calls on **row 21** are the ones that decide it. Row 21 is the picture's
last row on every adapter, and both calls are the colour branch of a mono test:
on a colour screen the game clears row 21 and prints its caption there, on a
mono screen it uses row 24 instead. Clearing row 21 only makes sense if the
clear _paints_ -- the game wants a black bar across the bottom of the scene to
put its caption on.

And AGI paints. It has one framebuffer and no text plane; `clear.lines` writes
the colour over whatever was there. This engine emptied the cells instead, so
that a caption taken off the picture would reveal the scene -- and for seven
milestones the two were **indistinguishable**, because on a 320x200 screen
nothing is behind rows 22 to 24 and transparent and black look the same.
Hercules is where they came apart, and the defect it exposed was on EGA too:
those two row-21 captions have been floating on the scene there all along.

### The command line is a box because it has nowhere else to go

The picture reaches the bottom of the screen, so the three rows AGI keeps for
its prompt have scene behind them. The photographs show what the original did
instead: `ENTER COMMAND` centred over the scene with the line being typed
beneath in inverse video.

The game's own band shares those rows and gets there by painting them black
first. The interpreter's command line does not paint; it draws a box.

### What making the command paint then exposed

The round-trip test of M8 failed within the minute, and it was right to: **the
snapshot did not carry the text plane**. It had never needed to, for exactly the
reason above -- a cleared band and a plane nothing had been written on were the
same thing, so a restore that dropped the plane dropped nothing anyone could
see. With clears painting, a saved game and its restored twin diverge on the
first cleared row and never converge again.

So the plane is in the snapshot now, sparsely: a list of `[cell, character, ink,
ground]` for the cells that hold something, which is a fraction of the 1000-cell
plane in any real game. Optional on the way in, like the layout of M11, and for
the same reason -- a save written before it existed came from an engine whose
plane could not have survived a restore anyway.

One ordering defect on the way, and it is the same kind M8 found twice: the
restore wrote the plane back and then the "nothing of the old game is left on
screen" step cleared it again. The clear belongs to the game being replaced, so
it has to come first. The round-trip test found that one too.

### And the band would not go away

Painting it revealed the second half of the same problem: nothing ever unpainted
it. A band the game had put up survived every room the player walked into, which
no photograph shows -- they show it only where there is text on it.

AGI takes it away by not having a text plane at all. `show.pic` copies the
picture into the screen, over whatever was there: captions, band and all. So
`show.pic` clears the plane here, and that this is safe was checked rather than
assumed -- **no script in the game writes with `display` and then shows the
picture**, so nothing it meant to keep is thrown away.

That is the third time in this milestone that having one framebuffer, where this
engine has a picture and a plane over it, turned out to be the thing that
mattered. It is worth stating as a rule for whatever comes next: every command
that writes to AGI's screen writes to _one_ buffer, and every place this engine
keeps two is a place where the difference can hide.

That box is the _interpreter's_ and not the game's, and this was checked rather
than assumed -- no message in any of the 46 LOGIC resources contains the words
"enter command", so no script could be printing it.

Three photographs pin its shape down to the cell, and one of them was the
surprise: **the game's own questions use the same box.** `get.num`'s "How old
are you?" is drawn exactly like the command line -- the prompt on one line, a
blank line, then the answer in an inverse field -- while a plain message window
next to it is still just text in a box. So the shape is a function, shared by
both, and a script's own placement is ignored on a mono display: the box has a
fixed place, and the row a script asked for was chosen for a screen of 25 rows.

```text
row 12    the title or the prompt, centred
row 13    blank, which is what keeps the two from reading as one paragraph
row 14    the field, inverse video, the whole inner width
```

Row 12 is not a measurement dressed up as one: it is `floor(ROWS / 2)`, half way
down AGI's own 25-row grid. That it lands where the photographs put it is the
useful part -- centring in the grid rather than in the screen is what makes the
two agree, because the grid is shorter than a mono screen.

And the field carries no `]`. That marker is what AGI keeps in string 0 and what
this game writes there, and it belongs to the input _row_; the box announces
itself with a title instead, and all three photographs show the field holding
nothing but what was typed.

Because the box covers the scene, the scene has to hold still. So it is an
`Interaction` and not a layer of the frame: it opens on the keystroke that would
have gone onto an input row, the cycle parks on it, and the game carries on when
the line is handed over. Escape abandons it, and so does backspacing away the
last character -- it opened because a key was pressed, so un-pressing that key
should undo it rather than leave the player shut in.

Where it lives is the interesting part. M10's rule is that nothing above the
display seam may ask which driver is running, and this is engine furniture that
has to differ by adapter. The resolution is that it does not ask: it reads the
**monitor variable**, which is the same fact the scripts read and the same one
M11 wired up. So `present.ts` draws the box whenever the display is monochrome,
and does not know that the only mono display is Hercules. A consequence falls
out for free -- the game's own Ctrl-R, `toggle.monitor`, moves the command line
into a box and back, because the engine's furniture now follows the same fact
the game's own layout does.

### The dither, in three attempts

> M15 replaced this with the interpreter's own table, 128 bytes of
> `AGIDATA.OVL`. The three attempts below are kept for what they cost to find
> out -- and because the fourth was not a better derivation either, it was
> opening the file.

Four pixels wide by two tall is eight pixels, and two colours give **nine**
densities for sixteen colours -- worse than the count suggests, because six of
AGI's colours sit between luminance 51 and 104 and crowd onto two of the nine.

Three mappings were built. Each one was rendered as a swatch of all sixteen side
by side and as real scenes, and each was thrown out by looking at it:

```text
a pattern per colour,     nine densities. Green, brown, dark grey and light
  8 pixels                blue came out as one grey, told apart only by which
                          pixel of eight was lit, which the eye does not read
one shared ordered        sixty-four accurate greys, all sixteen distinct --
  matrix, 8x8             and one weave for the whole screen, because there
                          the texture comes from the density. Every surface at
                          the same brightness looked like the same material
a pattern per colour,     thirty-three densities *and* a weave per colour.
  32 pixels               What ships
```

The third is the one the photographs argue for, and the arithmetic that makes it
possible is that the pattern repeats over a **block of two AGI pixels each way**
rather than over one. Eight pixels across by four down is 32, which is 33
densities -- and every pixel still shows only its own colour's value, so nothing
is blended with a neighbour. A dither that averaged across two AGI pixels would
have bought the levels by giving up the boundary between two colours, and on a
two-colour display that boundary is the thing there is least of to spare.

Density is luminance over 32, pushed up by one where two colours would share a
level. Three needed it, all within four units of luminance of each other, and
pushing rather than rounding keeps the order so a brighter colour is never drawn
darker. All sixteen end up distinct, which is what M12 taught this project to
want.

Texture is one of three ways of filling to that density, handed out in turn down
the order of luminance so that any two colours at neighbouring levels fill
differently:

```text
dispersed   an even sprinkle          two 4x4 ordered matrices interleaved
diagonal    hatching at 45 degrees    whole diagonals light together
clustered   a coarse dot grid         whole 2x2 blocks light together
```

The third of those was **vertical lines** first -- whole columns lighting
together -- and it was rendered and thrown out within the third attempt. At a
half it is a one-pixel picket fence across the whole surface, which reads as a
curtain rather than as a material; the house's clapboard wall came out as a
wall of stripes. Clustering the same count into 2x2 blocks gives the dot grid
the photographs actually show. That is four mappings looked at, for one that
ships.

### The phosphor

Amber, `#FFB000`. It belonged to the monitor rather than to the card and green
was equally common, but every photograph of this game on a Hercules is amber. It
was white until the photographs arrived, which is one row gone from the list of
things this mode does not get right.

### What M12's lesson turned into

> And what M15 took back out: the original's table reaches ten levels, not
> sixteen, and four of them are shared by two or three colours. The rule
> survives for CGA, where it was learned.

M12 ended with a rule: a colour identical to its background is an object that
has vanished, and that is worse than a colour merely being wrong. Two colours is
where that rule pays for itself. **All sixteen levels are distinct**, so nothing
in any picture can disappear into anything else -- and there is a test that
counts lit pixels over an eight-by-eight block for each of the sixteen and
asserts sixteen different answers.

That is a stronger guarantee than CGA's, which loses six distinctions outright.
The mode with the fewest colours ends up losing the fewest objects, because
sixty-four levels of one colour separate better than ten blends of four.

### Two things the seam had not carried

M10 designed the display interface against this mode, and it held -- with one
field missing. `CellMetrics` carried the cell's size and the font, and not the
**gap between them**: Hercules' text is letter-spaced, its cell is 18 pixels and
its glyph 16, and an interface that could only stretch a glyph to fill its cell
had nowhere to put that. One optional field, `glyphWidth`, and the default is
the old behaviour.

The other is in the shell rather than the seam. The canvas presents the largest
whole multiple of a driver's buffer that fits, and with the cap at 1280 a
720-wide buffer could only reach 1x -- Hercules would have been shown at half
the size of every other mode on the same screen. The cap is 1440 now, which
lets it reach 2x and changes nothing for the others: 1440 over 320 is 4.5, and
the whole multiple is still 4.

### What the tests found

Nothing in the engine. The 338 before it stayed green, EGA and CGA included.

The eighteen added split in a way the earlier graphics milestones could not:
several of them assert _arithmetic that a photograph corroborates_, which is a
kind of test M12 had no access to.

```text
the status row and the picture are the whole screen, exactly
the picture is 640 of 720 pixels wide, centred
the character grid is 40 columns of 18 pixels, and cannot reach the bottom
the glyph is narrower than its cell, which is what spaces the letters
all sixteen colours get a level of their own
a brighter colour is never drawn darker
no two colours fill the same way at neighbouring levels
a region of one colour comes out at the grey it asked for
no two colours look the same over a region
the box only appears once the player starts typing
the box is a title, a blank line and an inverse field, and carries no `]`
the game's own questions take the same shape on a mono display
Enter hands the line over and lets the game run again
Escape abandons the line, and so does backspacing it away
toggle.monitor moves the command line, and moves it back
Hercules is the driver for the mode, and EGA is untouched
```

Two of those carry the dither's weight. _A region of one colour comes out at the
grey it asked for_ works because each of the three fill orders is a permutation
of 0 to 31, so a level means a count of lit pixels and nothing else -- a dither
either is an accurate grey or it is not. And _no two colours look the same over a
region_ compares the whole 32-pixel pattern as drawn rather than only its count,
because two colours at the same level would be a defect while two with the same
level _and_ weave would be an object that has disappeared.

Three more hold the input box to what the photographs show, and one holds the
colour displays to what they did before: _on a colour display a question is one
line, prompt and answer together_. The box is a mono answer to a mono problem
and must not leak into the mode that is known to be right.

### This is a simulation, and here is where it is not the original

Hercules is the least faithful of the three modes, and every one of the reasons
is a file this repository does not have. The graphics overlay, the object
overlay and the font are _interpreter_ files; the repository ships only the
game's resources, deliberately (see the spec's note on bundling). So the mode is
derived from arithmetic, a photograph and judgement, and these are the places
that shows. Each is closeable, and the last column says with what.

```text
what differs                            why                    what would close it
the letter shapes         HGC_FONT is not bundled: 3072    the font file. Reading
  -- and this one is      bytes of interpreter data, not   95 glyph bitmaps off
  the most visible of     a game resource. What is drawn   compressed video
  the four                is the engine's own 8x8 CGA and  frames is not a
                          EGA font stretched into the      substitute, and
                          cell, and it reads as exactly    drawing one from
                          that                             scratch would be an
                                                           invention, not a
                                                           reproduction
which weave each          each of the sixteen has a        HGC_GRAF.OVL. Which
surface carries           weave of its own, as the         colour got which weave
                          photographs show -- but the      is not inferable from
                          three families and who gets      three screenshots
                          which are derived, not read
how sprites are drawn     the original shipped             HGC_OBJS.OVL. What it
                          HGC_OBJS.OVL beside              did differently is not
                          IBM_OBJS.OVL, so cels were       inferable from the
                          drawn differently here; this     resources
                          dithers them like the picture
the last two pixels        25 rows of 14 is 350 and the    nothing in the
                           card is 348, so the bottom of   resource files decides
                           row 24 falls off the screen     whether the original
                                                           lost them too
```

The list is shorter than it was. Photographs of the real thing settled the
phosphor, the shape and the place of the prompt box, that surfaces carry a weave
of their own, and -- twice over -- the picture's height. What is left divides
cleanly: one row wants a font file, one wants the graphics overlay, one wants
the object overlay, and the last wants a fact that may not be recorded
anywhere.

None of the four makes the game unplayable, and the guarantee that matters is
intact: all sixteen colours stay distinguishable, so nothing in any picture
disappears into anything else. What is missing is period detail, and it is
missing because the files that hold it are not here. **It can be improved
further** -- each row above says with what -- and none of it needs the engine
rearranged to do it: a better table is a better table, behind the same seam.

**Done when:** Hercules draws the game at its own size on a canvas that follows
it, in its own font, and switching to it and back repaints without reloading the
room.

Two of those three stood. The canvas follows the driver and a mode can be
switched mid-room -- M10 built both, and a driver that keeps nothing between
frames is what makes the second free. The font could not be done at all, for the
reason given above, and the milestone says so rather than claiming an 8x8 font
in a twelve-row cell is Hercules'.

### The risk these four carry

Not correctness that a test can catch, but _plausibility_. Nobody here can
compare the result against a Hercules card, and a CGA palette that is merely
wrong-looking passes every test a test can be. Two mitigations, and they are the
ones the project has used since M2: render the game's own pictures in each mode
and look at them, and keep the EGA golden tests green so that a mode nobody can
check cannot quietly disturb the one mode that is known to be right.

M12 used both, and the first of them earned its place: looking at the pictures
is what caught two mappings that a metric preferred and that each hid a whole
object. A third mitigation came out of that -- **record what the mapping costs,
measured, next to the mapping**, and have a test recompute it. It does not say
the mapping is right. It makes changing it a decision with a number attached
rather than a matter of taste.

M13 got a fourth the plan did not expect to be available: a photograph of the
real thing. It moved the geometry from derived to confirmed, and it settled the
command-line question outright. It did not settle the dither -- what it shows
there is a per-surface weave finer than a four-by-two cell can carry -- and that
is where the swatch-and-look mitigation did the work instead.

---

## M14 — The shell the player sees — complete

Thirteen milestones went into the engine and none into the page around it. It
shows: the shell is a development instrument with a game in the middle of it,
and everything it says out loud is addressed to whoever is building the
interpreter rather than to whoever is playing the game.

This is the first milestone with no format to measure and no hardware to
imitate. What it has instead is a list of things that are demonstrably wrong.

### Grounding: what the page does today

```text
the status line under the canvas    twice a second, and reads
                                    "room 11 (entered 2x), cycle 1481, ego
                                    50,120 pri 8 - 3 commands not yet
                                    implemented"
the log below it, on load           resource counts, then eight lines of key
                                    hints that mix the game's keys with the
                                    engine's
the controls row                    Graphics, Sound chip, Sound on/off, Export
                                    saves, Import saves -- five controls in one
                                    undifferentiated row, two of which are file
                                    operations and three of which are settings
F5 / F7                             advertised as the game's own Save and
                                    Restore, which they are
F7                                  *also* bound by the shell to the priority
                                    screen, which it also is
F8 / F9                             the state dump and the disassembler, always
                                    live
```

**F7 is the defect worth naming.** `shell/debug.ts` listens on the window for
F7 and toggles the priority screen; `input/keyboard.ts` routes the same key to
the game, which has bound it to Restore. Neither stops the other, so one press
does both: the picture switches to the priority screen _and_ the restore dialog
opens over it. The log advertises both bindings, two lines apart.

That is not a milestone-sized problem on its own. It is the symptom worth
starting from, because the cause is that the shell's keys and the game's keys
were never separated, and the same is true of the shell's _words_.

### The line to draw

Not "hide the debug tools" -- an earlier open question settled that they ship,
because the whole of `shell/debug.ts` plus the disassembler is about 1 KB
gzipped and a second code path would cost more than it saves. The line is
between **what a player needs to know** and **what a developer needs to see**,
and today they are the same surface at the same time.

```text
the player needs      which keys are the game's, that sound needs a keypress
                      first, what the display and sound switches do, and how
                      to save a game to a file
the developer needs   where the game is, what it reached that is not built,
                      the priority screen, the state, the disassembly
```

Both stay. The developer's moves behind one gesture, and off the keys the game
has taken.

### Files

```text
src/shell/shell.ts      the page: the two surfaces separated
src/shell/controls.ts   settings grouped apart from actions
src/shell/debug.ts      one gesture in, and keys the game has not bound
src/main.ts             what the page says on load, and what it says twice a
                        second
```

### Order of work

1. **The keys.** The shell's own keys move off anything the game has bound, and
   the collision is settled by asking the game rather than by choosing again:
   `machine.keyBindings` knows every key the scripts claimed, so the shell can
   refuse to take one. That is a rule rather than a new list of keys, and it
   holds for the next game too.
2. **The status line stops being telemetry.** One line that says what the
   _shell_ just did -- a setting changed, sound switched on, a game saved -- and
   the engine's readout only while the developer surface is open.
3. **The controls, grouped.** Settings apart from actions, and each control
   still saying what choosing it does rather than only what it is called.
4. **What the page says on load.** The game's own keys, and the two facts a
   player cannot guess: sound starts off and needs a keypress, and whether this
   browser will let the game save. The resource summary moves to the developer
   surface, where it was always addressed.

### What this is not

No touch or mobile controls: the spec puts those outside v1 and nothing here
changes that. No theming, no settings the game does not have, and no second
build. The page stays one page.

**Done when:** a player who has never opened the repository can start the game,
tell which keys belong to it, change the display and the sound, save to a file
and load it back, and never see a cycle count or a resource table -- while every
one of the developer surfaces is still one gesture away, and no shell key
shadows a key the game has bound.

**Done.** The shell now has two surfaces. The player sees the canvas, grouped
settings, save-file actions, a short list of the game's own keys, and a status
line that says what the shell just did. The resource table, cycle/room/ego
telemetry, priority screen, state dump and disassembly live behind the
Developer panel.

The F7 collision is gone. The shell no longer binds unmodified function keys;
developer shortcuts are `Alt+Shift+P/S/D`, active only while the Developer panel
is open, and every shortcut is checked against `machine.keyBindings` before the
shell claims it. If a game binds the same key, the shell refuses it and the game
keeps the key.

Four tests in `test/shell.test.ts` hold that rule: F7/F8/F9 are not shell
shortcuts, the developer shortcuts require the modifier pair, a game-owned key
is refused, and the three unclaimed shortcuts map to the three debug actions.
The whole suite is at 372 tests.

---

## M15 — The dither the original shipped — complete

M13 shipped a pattern table it derived from luminance. This milestone was meant
to replace it with one measured off the captures in `screenshots-from-original/`.
It did that, twice, and both answers were wrong. The table was 128 bytes of
`AGIDATA.OVL` the whole time.

```text
src/render/hgcdither.ts            the table, where it lives, and how
                                   HGC_GRAF.OVL indexes it
src/render/drivers/hercules.ts     draws through it; takes another one
src/render/drivers/index.ts        one more optional interpreter file
src/main.ts                        reads AGIDATA.OVL beside HGC_FONT
scripts/build-manifest.mjs         copies it when a copy of the game has it
scripts/rectify-screenshot.mjs     a capture becomes the mode's own grid
scripts/check-hgc-dither.mjs       dumps the table and checks it by brightness
test/helpers/hgc-reference.ts      what the captures say, recorded
test/hercules.test.ts              the table pinned to the file, and to them
```

### The two wrong answers

Worth recording in full, because each looked like the careful thing to do at the
time and the second was shipped.

**The first** compared the captures against the PICTURE resources. A room draws
over its picture -- `add.to.pic` plants objects, scripts overdraw -- so those
pixels are not the colour the PICTURE holds underneath them, and what a room
adds is furniture and shading, which is exactly where the interesting colours
are. Brown had 92 device pixels of evidence that way, all in thin bands where
bleed dominates, and came back solid black. Two more mistakes compounded it: a
trim step that dropped whatever a fit could not explain and then refitted, which
reinforces whatever the first pass found; and a period chosen on a pooled figure,
which is dominated by whatever covers the most screen. The conclusion was that
**the original had no dither at all** -- one bit per colour, explaining 99.47% of
held-out device pixels against 99.53% for an 8x4 table.

**The second** fixed the ground truth: compose the room with the engine, then
attribute. Brown's evidence went from 92 pixels to 2656 and its 45 degree
diagonal appeared, crisp and position-locked. That was a real finding, and the
table built on it was still wrong -- thirteen colours solid, brown dithered, dark
grey guessed -- because it was still built by **thresholding** the captures.

That is the mistake worth naming. Half of the real table's patterns alternate on
a one-pixel pitch, and a capture smooths those into a flat half-tone long before
anything thresholds it. Light grey is `55 aa 55 aa`, a checkerboard; its regions
read as a uniform grey of about 90 out of 255, and Otsu's threshold puts all of
it on the lit side. Cyan is `aa 00 aa 00`; its regions read as about 38, and the
same threshold puts all of it on the dark side. Brown survived only because its
lit pixels are four apart rather than adjacent.

A threshold is the wrong instrument for measuring a dither, and nothing about
the measurement's internal consistency could have said so. What said so was
being asked to look in the original files.

### The table, and how its layout was read

`agi-extract/data` has the interpreter beside the game: `HGC_GRAF.OVL` is 1536
bytes of 8086, and its picture blit is short enough to read by hand. It takes
two pixels at a time:

```text
lodsw                      ax = two pixels of the visual screen
and  ax, 0f0fh             a colour in each byte
cmp  al, ah                the same colour?
shl  al, 1  (x3)           al = colour * 8
mov  bx, dx                dx = (row and 3) * 2
add  bl, al                bx = colour * 8 + (row and 3) * 2
mov  al, ss:[bx+1beah]     the byte for this device row
stosb
mov  al, ss:[bx+1bebh]     and the byte for the row below
mov  es:[di+50h], al       50h = 80 bytes = one 640-pixel row
```

Every number in the layout falls out of that: eight bytes per colour, four row
phases of two bytes, and a byte spanning two AGI pixels of four device pixels
each -- so a colour's eight bytes are the eight device rows of an 8x8 cell. The
branch for two _different_ colours confirms the horizontal halves, keeping
`and al,0f0h` for the left pixel and `and ah,0fh` for the right.

And `1beah` is a file offset. Searching every file in the directory for 128
bytes that start with eight zeros and end with eight `ff`s finds exactly one
place: `AGIDATA.OVL` at `0x1bea`.

```text
 0 black          00 00 00 00 00 00 00 00    0/64
 1 blue           88 00 00 00 22 00 00 00    4/64
 2 green          80 10 02 20 01 08 40 04    8/64
 3 cyan           aa 00 aa 00 aa 00 aa 00   16/64
 4 red            22 88 22 88 22 88 22 88   16/64
 5 magenta        88 00 88 00 88 00 88 00    8/64
 6 brown          11 22 44 88 11 22 44 88   16/64   the diagonal M15 measured
 7 light grey     55 aa 55 aa 55 aa 55 aa   32/64   the checkerboard it missed
 8 dark grey      22 00 88 00 22 00 88 00    8/64
 9 light blue     d7 ff 7d ff d7 ff 7d ff   56/64
10 light green    dd 55 77 aa dd 55 77 aa   40/64
11 light cyan     7f ef fd df fe f7 bf fb   56/64
12 light red      aa ff aa ff aa ff aa ff   48/64
13 light magenta  77 bb dd ee 77 bb dd ee   48/64
14 yellow         77 ff ff ff dd ff ff ff   60/64
15 white          ff ff ff ff ff ff ff ff   64/64
```

Brown is `11 22 44 88` -- the same 45 degree diagonal at the same density the
second attempt measured off the captures, which is what says the layout is read
right and not merely plausibly.

### Checking it, the way the captures can be checked

Not by bits. By brightness: the mean luminance of each colour's regions against
the table's densities, over the screen the room composes, on AGI pixels whose
four neighbours share their colour.

```text
luma = 6.1 + 137.1 x density,   R2 = 0.9494

 0 black        25284 px    0/64      0.3    predicted    6.1
 1 blue           937 px    4/64     10.7                14.7
 3 cyan          2586 px   16/64     38.6                40.4
 4 red           3430 px   16/64     40.2                40.4
 6 brown          332 px   16/64     44.2                40.4
 7 light grey    2270 px   32/64     80.4                74.6
12 light red     3949 px   48/64    119.4               108.9
 9 light blue     687 px   56/64    136.7               126.0
11 light cyan    4204 px   56/64    135.4               126.0
15 white          214 px   64/64    114.7               143.2
```

Monotone throughout, with the residual bending the way a display gamma bends.
The colours with too few pixels to enter the fit land there too: green at 8/64
is 22.1 over 34 pixels, magenta at 8/64 is 20.4 over eight, light green at 40/64
is 98.8 over 41, yellow at 60/64 is 143.9 over nine. Fifteen of the sixteen are
corroborated; dark grey appears in none of the three rooms.

White is the one that misses, by 28. Its 214 pixels are thin highlights with
outlines and sprites against them, and the footprint sampled carries some of
that. It is left in the fit rather than trimmed out of it, which is why the
recorded R² is 0.95 and not 0.99, and a test asserts that it still misses.

### Where the table lives, and why it is a file

In `AGIDATA.OVL`, read at start-up like `HGC_FONT` -- and copied into
`public/game` by the same optional-interpreter-file rule, which existed already
for the font and needed one more entry. Absent, the driver falls back to the
bytes LSL1's copy holds, which is what a game shipped without the overlay gets.
A test decodes the bundled file and asserts the shipped constant equals it,
which is the strongest test in this file: the constant is a copy, and that is
what says so.

### What the tests hold now

```text
the shipped table is the bytes in the game's own AGIDATA.OVL
a cell is eight device rows of eight device pixels
every colour has a pattern, and only black and white are solid
the sixteen colours reach ten distinct densities
brown is the 45 degree diagonal the captures show plainly
light grey is a checkerboard, which is what a threshold cannot see
a region of one colour comes out at the density the table asks for
the driver draws through the table it was given
no two colours a level apart share a weave
the captures calibrate the way the recovery recorded
the captures' brightness is a straight line in the table's densities
every colour the captures reach is as bright as the table says
and they are in the table's order, brightest to darkest
```

The last four skip when the captures are absent, which is the normal case for a
clone. The suite went from 372 to 386.

### What this is not

Not `HGC_OBJS.OVL`: sprites are drawn through the picture's table, the object
overlay has not been read, and the hatched objects that once looked like
evidence of a separate one turned out to be brown in the room's composed screen.
Not the status bar, whose lit band is twelve device rows of a fourteen-row cell
in the original and fourteen here -- measured while calibrating the captures,
left for whoever touches the text path. Not the phosphor, which was already
amber.

And not a claim that everything about this mode is now the original's. Two of
its files are, the geometry is arithmetic, and the rest is still derived.

**Done.** The dither is the interpreter's own table, read from the file the
interpreter kept it in, pinned to that file by a test, and corroborated by three
captures whose brightness is a straight line in its densities.

### The lesson, which is about instruments

Two milestones measured this table and both got a self-consistent wrong answer.
The reason was never arithmetic: it was that a threshold cannot see a
one-pixel dither, and every check performed downstream of that threshold agreed
with every other. Held-out scoring, per-colour breakdowns, position-locking
tests -- all of them were measuring what the instrument had already destroyed.

What broke it was a question from outside the loop: _have you looked in the
original files?_ The answer had been sitting in `agi-extract/data` since M0.

---

## M16 — CGA, as the original drew it — complete

M15 found the Hercules dither table in `AGIDATA.OVL` after two milestones had
derived and then measured their way to two wrong answers. The obvious next
question was whether CGA's mapping was in there too. It is, three times over,
and one of the three was not expected.

```text
src/render/cgatables.ts            the three tables, and what CGA_GRAF.OVL
                                   does with them
src/render/drivers/cga.ts          the palette, the pairs, the fills, and the
                                   row phase that had to go
src/render/drivers/cgamono.ts      640x200 in two colours
src/render/drivers/index.ts        one more optional file, and which mode has a
                                   mono variant
src/render/renderer.ts             setMonochrome: the game changing the card
src/engine/present.ts              where that fact crosses the seam
src/engine/hardware.ts             hasInputRow, which the command box now reads
src/main.ts                        AGIDATA.OVL's CGA tables read at load,
                                   beside the Hercules table M15 already read
scripts/check-cga-tables.mjs       the tables dumped with the argument for how
                                   they are read
test/cga.test.ts                   29 tests, up from 14
```

### What is in the files

`CGA_GRAF.OVL` is 1024 bytes and its jump table has seven entries: set the mode,
blit the screen, fill, clear, a masked pixel write, and an in-place colour
translation. Reading them took writing a small 8086 disassembler, which was
worth it -- three of the four things this milestone turned on are invisible
without seeing instruction boundaries.

The blit packs *pairs* of pixels into each byte it stores:

```text
lodsw                two pixels of AGI's one-byte-per-pixel screen
and  ax, 0f0fh       a nibble from each
shl  al, 1  (x4)
or   al, ah          one byte: the left pixel's nibble, then the right's
stosb
add  dx, 2000h       CGA's two interleaved banks, 80 bytes to a row
```

Eighty bytes a row is 320 pixels at four to a byte or 640 at eight, so **a
nibble is one AGI pixel in either mode** -- two CGA pixels of two bits, or four
of one bit. That is why one table shape serves both modes, and it is the fact
the whole reading rests on.

```text
0x1b78   16 x 3 bytes   the fill patterns: byte 0 for two colours, 1 and 2 for
                        four
0x1ba8   00 22 11 33 44 66 88 55 aa 77 99 bb ee cc dd ff
0x1bb8   00 00 cc 11 aa 22 99 dd 00 33 55 77 ee ee ff ff
```

### Which table is which mode's, and how that is known

Not by preference: the flag that chooses the table chooses the video mode.

```text
flag != 0   int 10h ah=0Bh bx=0001h   background register to colour 1
            int 10h ah=0Bh bx=0100h   palette 0     -> 320x200, four colours
            and the blit reads 0x1bc8, a copy of 0x1bb8 made at init
flag == 0   out 3d8h, 1ah             bit 4: high resolution
            out 3d9h, 27h             low nibble 7: light grey
            and the blit reads 0x1ba8 -> 640x200, two colours
```

Three checks, and `scripts/check-cga-tables.mjs` prints all of them:

```text
a permutation      0x1ba8 uses all sixteen nibble values exactly once --
                   sixteen patterns, densities 0/4 to 4/4. Only a one-bit
                   dither is shaped like that
the exact hits     read as four-colour pairs, 0x1bb8 draws red as exactly red
                   and blue as exactly blue. 0x1ba8 gets none of the sixteen
                   right and draws red as green beside the background
the tie            the fill table's two-colour column equals 0x1ba8 entry for
                   entry -- 48 bytes apart in the file, with no reason to
                   agree unless both have been read right. decodeCgaTables
                   refuses a file where they disagree
```

### The palette M12 ranked last

The original selects palette 0 at low intensity and sets the background register
to colour 1, so the four colours are blue, green, red and brown, and **nothing
in the game is black on a CGA**. M12 scored all four hardware palettes and put
this one fourth of four, at 203.2M colour error against the winner's 113.2M and
19.7% of boundaries lost against 4.3%.

That is worth sitting with rather than explaining away. The metric was not
broken; it was answering a different question. It minimised distance from an EGA
reference, and Sierra were not doing that -- they were keeping sixteen colours
*distinguishable* on four, where a wrong hue costs less than a shape that
disappears. A dark-heavy palette does that better than a bright one, and blue in
the background slot buys a fourth dark tone that black does not.

### What it costs, re-measured

```text
                        M12's derived table      the original's
boundary pixels lost    11,335  (4.1%)           30,549  (11.0%)
collision groups        5                        3
the expensive one       7 = 14 = 15, 8,328 px    0 = 1 = 8, 27,619 px
appearances drawing     10 of 10 blends          12 of 16 ordered pairs,
                                                 and all 10 blends
appearances filling     -- (fills were solid)    15
```

Nine tenths of the original's loss is one group: black, blue and dark grey are
all the background, and black meets blue in 27,614 places -- night skies,
shadows, and every dark thing drawn against another dark thing. The engine now
loses those, because the card did.

### The third table, and the thing it says

Fills read `0x1b78`, and in four colours they use *two* nibbles where the
picture uses one -- so a filled region alternates two patterns across its width
and reaches fifteen distinct appearances against the picture's twelve. Green is
the clearest case: the picture draws it 3,0 and a fill lays 1,0 then 1,1, which
is three quarters green.

So the original's own fills and pictures disagree about what a colour looks like.
That is not a defect to reconcile: it is the picture blit being the inner loop
and the fill routine not, and both are shipped here as they are.

### The command box moved, and this is why

M13 made the command line a box whenever the *scripts* were told the display was
monochrome, on the reasoning that Hercules was the only monochrome display and
that keying it to the variable meant nothing had to ask which driver was
running. M16's CGA in 640x200 is monochrome with all twenty-five rows, and the
original drew its command line on a row there -- so the old rule would have put
a box on a screen with a perfectly good row to use.

It is keyed on the screen's geometry now, in `hasInputRow`: the picture's 168
rows in 8-row cells cover the grid's rows 1 to 21, and in Hercules' 14-row cells
they cover 1 to 24. That is a better rule than the one it replaces for a reason
beyond this milestone -- it is *why* Hercules needs a box, rather than a
correlate of it. It also changes Hercules slightly: `toggle.monitor` no longer
moves the box, which matches the original, whose Hercules card had one mode.

### The one design decision, and how it went

The plan said the renderer should be *told* about mono rather than a driver
reading game state, and that the alternative -- a flag inside the CGA driver --
was worth trying second. The first was right and cost four lines: `present` is
the single funnel every frame goes through and it has both objects, so it passes
`machine.monochrome` to `renderer.setMonochrome` before rendering.

Reading it there rather than pushing it from `toggle.monitor` has a property
that was not the reason for it and is worth keeping: a restored save arrives in
the right mode, because the monitor variable is part of the snapshot and the
renderer catches up on the next frame.

The mono driver reports `mode: 'cga'`, so nothing above the seam knows there are
two. A fourth `DisplayMode` would have put a display in the shell's select that
no player ever picked.

### What the tests hold now

```text
the shipped tables are the bytes in the game's own AGIDATA.OVL
a wrong AGIDATA.OVL is refused rather than half read
the four colours are the palette the original selected
sixteen colours reach twelve appearances, of the sixteen ordered pairs
the fill table reaches more appearances than the picture table
the dither is stripes, not a checkerboard
a fill is dithered, and with the fill table rather than the picture one
the recorded collisions are the collisions the table has
each collision costs what it is recorded as costing
a cell of the two-colour mode is four pixels of one bit
the two-colour table is a permutation, so no two colours look alike
the two-colour picture table and the fill column are the same table
the two-colour mode draws every colour at its own density
the two-colour mode has no row phase either
the two-colour mode keeps a row for the command line
two colours put ink and ground on opposite sides, always
the two-colour mode presents at the size the four-colour one does
only CGA has a mode to switch to when the game asks for mono
the renderer answers a mono display by changing the card, on CGA
mono survives a mode switch away and back
```

The suite went from 388 to 403. One existing test changed rather than being
added to: `toggle.monitor moves the command line, and moves it back` is now
`the box belongs to the screen, not to what the scripts were told`, and it
asserts the opposite of what it used to on both modes.

### What this is not

Not `CGA_OBJS.OVL` or `IBM_OBJS.OVL`, still unread. Not the text colour: the
overlay has no text path at all -- its six routines are a mode set, a blit, a
fill, a clear, a pixel write and a colour translation -- so `CGA_SOLID` stays
derived, and now that is a fact rather than an open question, because someone
looked. Not the composite-monitor artefact colours a real CGA on a television
produced, which no table in any file describes.

And there is no photographic check for any of it. None of the seven captures in
`screenshots-from-original/` is a CGA screen, so unlike M15 there is nothing to
hold the result against -- which is exactly why the tables being *read* rather
than derived carries the weight here. The reading is checked by its own
consistency, printed by `check-cga-tables.mjs`, and by two colours coming back
exactly right.

**Done.** Both CGA modes draw through the interpreter's own tables, read from
the bundled file and pinned to it by a test; the palette is the one the mode
setup selects; the dither is stripes; fills use the fill table; the cost is
re-measured and recorded; and `Ctrl-R` puts the card into 640x200 in two
colours, as it did in 1987.

---

## M17 — The page, designed — complete

M14 separated the player's surface from the developer's and stopped the shell
stealing the game's keys. It did not touch how any of it *looks*, and nothing
since has either: the page is the one written in M0 to prove the canvas mounted,
with three milestones' worth of controls appended to it.

This is the second milestone with no format to measure and no hardware to
imitate, and like M14 what it has instead is a list of things that are
demonstrably wrong. What it turned out to have as well was a number: Hercules
at 2x is 696 pixels tall, and that one measurement decided the layout.

### Grounding: what the page was

```text
the stylesheet          one template literal in shell/shell.ts, 24 hex
                        literals, `color-scheme: dark` and no light palette
the layout              a centred flex column: title, canvas, one control
                        row, status, four centred help paragraphs, errors,
                        developer panel. No breakpoint anywhere, and
                        `width: min(960px, 100%)` doing all the adapting
                        there is
the controls            two selects and one button in a bordered row, in two
                        labelled groups, plus two file buttons
the help                four sentences of prose, centred, naming eight keys
                        inside them
on load                 an empty page with `loading game files...` in it
the title               `Leisure Suit Larry 1 / web-agi` in 12px uppercase
                        gold, which is the developer's name for the thing
                        rather than the player's
index.html              a viewport meta, no favicon, no theme-color
```

### The two defects worth naming

**The canvas is sized from the width and the window has a height.** `fit()`
reads `window.innerWidth` and nothing else, so the scale it picks is whatever
the width allows:

```text
window 1440x900, EGA    scale 4 -> a 1280x800 canvas, and roughly 190px of
                        title, controls, status and help under it. The page
                        scrolls, and the command line the player types into
                        is the part that goes off the bottom
```

That is the M14-shaped defect for this milestone: not fatal, but the symptom of
the cause, which is that the page was never laid out against a viewport at all.

**Switching display mode changes how big the game is.** Whole-number scaling is
right and stays, but it is applied to each driver's raw buffer with no reference
to the others:

```text
window 1440 wide    EGA 320x200   scale 4   ->  1280 x 800 presented
                    CGA 320x200   scale 4   ->  1280 x 800
                    Hercules 720x348  scale 1  ->   720 x 348
```

So a player comparing the modes -- which is the entire point of M10 to M16 --
gets a picture a third of the width when they pick the one that draws the most
pixels. `MAX_WIDTH` was raised to 1440 in M13 to let Hercules reach 2x, which
helps a 2560-wide screen and not a laptop.

### What "modern" is allowed to mean

The risk in a milestone like this is that it becomes decoration, so the line is
drawn before the work rather than after:

```text
in        colour and spacing as tokens, defined once; a light palette beside
          the dark one, chosen by prefers-color-scheme; a type scale rather
          than five ad-hoc font sizes; the keys shown as <kbd> keys; focus
          visible for whoever is on a keyboard; a real loading state; a
          favicon and a theme-color
out       any framework, any build step, any second stylesheet file, any
          animation the game does not have, and any control the game does
          not have -- a theme switch included: the OS setting is the setting
```

The page is still one HTML file, one `<style>` and the same DOM-building code.
Whatever this milestone costs, it costs in bytes of CSS.

### Responsive, and the non-goal it does not touch

The spec's non-goal is touch *controls*, and it stands. Nothing here adds an
on-screen d-pad, a tap-to-move, or a soft keyboard trigger; the game is played
on a keyboard.

What the milestone owes a narrow screen is that it not be broken, and that it
say so:

```text
>= 1100     canvas and controls side by side if that fits the height better
            than stacked; developer panel closed and out of the flow
640-1100    one column, canvas first, controls in one wrapped row
< 640       one column, canvas at whatever whole multiple fits, controls
            stacked full-width, and one line saying the game needs a
            keyboard -- said once, not as a dismissible banner
```

The keyboard line is the honest version of responsiveness here. A phone can
load the page and watch the opening; it cannot type `look at the sign`, and a
layout that hides that fact is worse than one that admits it.

### The focus problem, which is real and has a cost

Every control in `shell/controls.ts` calls `blur()` on itself after it is used,
because a focused `<select>` eats the arrow keys that walk ego. That is correct
for the mouse and hostile to a keyboard: tab to a control, change it, and focus
is thrown back to the body with no visible trace of where it was.

The rule this milestone works to is that the *game* keeps the keys and focus
stops being invisible: `:focus-visible` rings on everything reachable, and the
blur stays. A keyboard user tabbing forward starts from the body each time,
which is a real cost and is recorded here rather than designed around, because
the alternative -- keeping focus in the control -- breaks the game.

### Files

```text
index.html              favicon, theme-color, and a title the player would
                        recognise
src/shell/shell.ts      the tokens, the type scale, the two palettes, the
                        breakpoints, and the layout they describe
src/shell/controls.ts   the controls as a group that reads at a glance, and
                        focus rings on all of them
src/shell/canvas.ts     fit() against both dimensions, and one presentation
                        size the three modes are comparable in
src/main.ts             the help as keys rather than prose, the loading
                        state, and the narrow-screen line
test/shell.test.ts      what can be held without a browser: the fit
                        calculation, and that the modes come out comparable
```

### Order of work

1. **The canvas first**, because it is the defect and because it decides how
   much room the rest of the page has. `fit()` takes the space it is given in
   both dimensions and returns the largest whole multiple that fits inside it;
   the presentation target becomes one box the three drivers are scaled into,
   so Hercules and EGA come out within a step of each other instead of a
   factor of three apart. This is arithmetic, so it is tested, headless.
2. **The tokens.** The 24 literals become one `:root` block plus a
   `prefers-color-scheme` override, and every rule is rewritten in terms of
   them. Nothing moves on screen in this step -- it is the change that makes
   the next two cheap.
3. **The layout.** The breakpoints above, with the canvas as the element the
   others give room to rather than the reverse.
4. **The words.** Keys as `<kbd>`, the four help sentences as a short key
   list, a loading state that says which of the three phases it is in, and the
   narrow-screen keyboard line.

### What this is not

No touch controls, no theming beyond the OS setting, no second build, no
framework, and no new control -- M14's four settings and two file actions are
exactly the four settings and two file actions this milestone ends with. The
engine, the drivers and the tables are not opened: if a change to `render/`
turns out to be needed, the milestone is wrong about its own boundary and the
change waits.

**Done when:** the page is usable and unbroken from 360px to 2560px wide; the
canvas is never taller than the window at any mode or window size and the three
display modes present within one scale step of each other; the page follows the
viewer's light or dark setting from one set of tokens; every interactive element
shows focus; the game's keys are readable at a glance without reading a
sentence; a narrow screen says a keyboard is needed; and not one control has
been added, removed or rewired.

### The defect under the defect: the canvas was sizing its own container

Step 1 was written as arithmetic -- take the stage's box, return the largest
whole multiple -- and it *was* arithmetic. What it uncovered was not.

With `fit()` reading the stage instead of the window, Hercules came out at 1x on
a 1440-wide screen with room for 2x. The stage was a `1fr` grid row, but the
canvas was in its flow, so the row was sized by its content:

```text
the canvas is sized from the stage's height
the stage's height is the row's content, which is the canvas
```

Two fixed points satisfy that, and the page settles on whichever it reaches
first. Hercules found the small one: 348 tall, so a 348-tall row, so 1x for
ever. EGA never showed it -- at 320x200 the loop happens to converge on the
same answer the window would have given -- which is why fourteen milestones of
looking at an EGA page never found it.

The fix is that the canvas is not in the flow. `position: absolute; inset: 0;
margin: auto` centres it and leaves the row's height entirely to the grid, and
the loop cannot form because one direction of it is gone. The comment on that
rule in `shell.ts` says so, because it looks like a centring trick and it is
load-bearing.

**And a second one on the way there.** The stage row read 604 pixels tall in a
900-pixel window, which is the *content* height again -- because
`min-height: 100dvh` was the only height on the grid and the browser being
measured in did not implement `dvh`. A dropped declaration is normally
cosmetic; here it removed the definite height the whole layout depends on. It is
now `min-height: 100vh` followed by `min-height: 100dvh`, in that order, so a
browser that knows the newer unit overrides the older one and a browser that
does not still has a height.

### 696, which is what actually laid out the page

Hercules' framebuffer is 348 tall and its next whole multiple is 696. So on a
1440x900 laptop the entire page around the stage has to fit in 204 pixels, or
the mode that draws the most pixels is presented at half the size of the other
two.

That is a budget, and it is what the chrome was designed against. The page went
from five rows to three, and the two that went are the two it can do without: a
status line reads perfectly well beside the title, and a developer panel that
pushes the game down whenever it is opened was wrong anyway -- opening a
debugger should not resize the thing being debugged.

```text
what is left                     the header (title, status, Developer),
                                 the controls and the key caps on one row,
                                 and one advisory line
measured, chrome at 12px gaps    209   -- 5 pixels over the budget
measured, at 8px gaps and with
  the advisory line at one line  195   -- clears it
```

Both numbers are the browser's, read off the stage the page gave itself; the
second is what shipped, and at 195 the budget clears on any viewport 891 pixels
tall or more. At a 1440x900 viewport: stage 1440x705, canvas 1440x696, Hercules
at 2x.

Five pixels decided the last two rules in that stylesheet, which is worth being
plain about rather than dressing up. It is also why they carry a comment: an
8-pixel gap that looks like taste is holding a mode at twice the size.

### What the modes measure at

`fitPresentation` against a stage of the page's full width, with the 195-pixel
chrome subtracted from the viewport:

```text
viewport     stage        EGA            Hercules        shortest/tallest
360x780      360x585      320x200 @1     360x174 @0.50   87%
768x1024     768x829      640x400 @2     720x348 @1      87%
1024x768     1024x573     640x400 @2     720x348 @1      87%
1280x800     1280x605     960x600 @3     720x348 @1      58%   <- the band
1366x768     1366x573     640x400 @2     720x348 @1      87%
1440x900     1440x705     960x600 @3     1440x696 @2     86%
1920x1080    1920x885     1280x800 @4    1440x696 @2     87%
2560x1440    2560x1245    1920x1200 @6   2160x1044 @3    87%
```

Against the 33% the milestone started from. The band that remains is a stage
600 to 695 pixels tall: EGA has reached 3x and Hercules cannot reach 2x, which
is 58% -- the row above, and a 1280x800 screen is a real screen rather than a
contrived one.

There is no way to close it that this milestone was willing to take. 1.5x would
put Hercules' dither on an alternating one-and-two-pixel grid, and that dither
is the whole of what the mode is for -- M15 spent a milestone getting it out of
the interpreter's own file. Shrinking EGA to match would be worse again: making
a mode that is right look wrong so that a mode that is limited looks less
limited. So the band is recorded rather than fixed, which is the same answer
M16 gave about its 11% of lost boundaries.

### What the plan got wrong

It proposed the canvas and the controls side by side above 1100 pixels. The
arithmetic says no, and says it clearly: a 260-pixel rail on a 1440-wide screen
leaves 1140 for the stage, EGA stays at 3x because it was height-bound anyway,
and Hercules drops from 2x to 1x because 1140 is less than 1440.

So the layout is one column at every width. That is not a compromise -- it is
what the numbers asked for, and the same numbers are why the stage is the only
part of the page with no horizontal padding.

### What is in the files

```text
index.html              the game's own title, a description, two theme-colour
                        meta tags for the two palettes, and a favicon as an
                        inline SVG data URI so the page asks for no second file
src/shell/shell.ts      37 tokens, two palettes, the three-row grid, the
                        stage rule above, the developer overlay, focus rings,
                        kbd caps, the loading placeholder and its one
                        animation (which prefers-reduced-motion turns off)
src/shell/canvas.ts     fitPresentation, exported and pure; the stage measured
                        rather than the window; a ResizeObserver, because the
                        controls wrapping is not a window resize
src/shell/controls.ts   the label above the control rather than in front of it
src/main.ts             four loading phases, and the help as keys
test/shell.test.ts      five tests on the arithmetic
```

### What the tests hold now

```text
no mode is ever taller or wider than the box it is given
enlarging is by whole multiples, in every mode, at every size
a buffer wider than the stage is shrunk rather than allowed to overflow
the modes are within 20% of each other's height at three window sizes
an unlaid-out stage asks for nothing rather than for a 1x1 canvas
```

403 tests to 408. The four M14 keyboard tests are untouched, which is the point
of them: this milestone rewrote every line of the shell's CSS and moved the
developer panel into the header, and the rule about whose keys are whose did not
notice.

### What it cost

```text
                  before      after
index.html        0.34 kB     1.69 kB     (gzip 0.24 -> 0.79)
the bundle        115.50 kB   125.36 kB   (gzip 38.66 -> 41.57)
```

About 3.5 kB gzipped for the whole milestone, most of it the stylesheet and the
favicon. No framework, no second file, no build flag.

### What this is not, still

No touch controls: a phone gets a page that works, a canvas at the largest
multiple that fits, and one line saying the game is typed at. No theme switch:
`prefers-color-scheme` chooses, and the shell's controls are still the four
settings and two file actions M14 shipped. Nothing under `render/` was opened.

And the focus rule stands as written: every control still hands focus back to
the body so the game keeps the keyboard, and what the milestone added is that
you can now see where focus was while it was there. A keyboard user still tabs
from the body each time. That is a cost, it is recorded, and the alternative
breaks walking.

**Done.** The page is one grid of three rows with the canvas out of the flow and
the stage measured rather than assumed; the canvas is never taller than the
window in any mode; the three display modes present within 14% of each other's
height wherever Hercules can reach a whole multiple, and the band where it
cannot is measured and recorded; the palette follows the viewer's setting from
one set of tokens; the game's keys are key caps; loading says which of four
things it is doing; and the developer panel opens over the game instead of
moving it.

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
defects M8 found were both about _order and emptiness_ — a flag written after
the state that replaced it, a slot released without being emptied — and neither
is the kind of thing keeping state in closures would have made easier.

## Open questions still open

Two of the spec's four are answered above. These remain:

- ~~Whether LSL1 needs a game-specific loader for interpreter quirks.~~
  Answered: no. What it needed instead were four rules the documentation does
  not state — a control line is a gap in the depths rather than a depth, a
  moving object draws over a stopped one at the same priority, a script
  spinning on `have.key` is waiting rather than looping, and `ignore.objs`
  makes an object intangible as well as unblockable — and all four belong to
  the engine, not to this game.

  The fourth arrived last and after M16, reported as "you cannot move at all
  after coming out of the restroom", and it is the clearest case any of them
  made. The room outside draws a door as an object with `ignore.objs` at
  105,123 and then puts ego, 7 wide, at 100,123: the spans overlap and the base
  rows are equal in every direction ego can step, so a one-directional reading
  of the flag stops the player dead until they type their way out. Sierra
  shipped that room, which is the whole of the argument. What made the wrong
  reading look right was Lefty's jukebox, and the jukebox turns out to be
  defended by conditional-obstacle lines in the picture: ego stops at x=23
  against the control line, not against the object, and does so either way.
- ~~Whether the debug overlay ships in the production build.~~ Answered: it
  ships. The whole of `shell/debug.ts` plus the disassembler is about 1 KB
  gzipped, which is not worth a build flag and a second code path.
