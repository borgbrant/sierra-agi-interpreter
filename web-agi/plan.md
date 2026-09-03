# Implementation plan: web-agi

Companion to [spec.md](spec.md). The spec says *what* to build; this says in what
order, in which files, and how each step is proven to work.

> **M0-M6 are done and shipped; M7 and M8 are not started.** The finished
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
M7  Sound                     not started
M8  Save and restore          not started
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

## M7 — Sound — not started

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

Scheduling ahead of the clock means playback outlives a stalled tab, so the
player is stopped on `new.room` and on `quit` alongside the rest of the
per-room teardown.

**Done when:** the game's opening sound plays, the status line's sound state
turns it off and on, `stop.sound` silences it without hanging the script that
started it, and all 28 SOUND resources parse with every channel accounted for
byte by byte.

---

## M8 — Save and restore — not started

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
arrive now as M7 and M8 rather than as a rewrite. That was the bet, and M8 is
where it gets checked.

## Open questions still open

Two of the spec's four are answered above. These remain:

- Whether LSL1 needs a game-specific loader for interpreter quirks. Expected to
  surface at M4-M6; not worth investigating before then.
- ~~Whether the debug overlay ships in the production build.~~ Answered: it
  ships. The whole of `shell/debug.ts` plus the disassembler is about 1 KB
  gzipped, which is not worth a build flag and a second code path.
