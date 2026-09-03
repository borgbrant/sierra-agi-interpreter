# Spec: web-agi — a Sierra AGI engine in the browser

## Overview

Build a client-side web application that plays Sierra AGI v2 games. The engine
runs entirely in the browser: it loads the game's resource files, interprets the
game's LOGIC bytecode, and renders the result to a `<canvas>`.

This is an interpreter, not a viewer. `agi-extract` decodes AGI resources into
files; `web-agi` decodes them into a running game — it adds the LOGIC virtual
machine, the object/sprite system, the input parser and the game loop that
`agi-extract` deliberately has no need for.

No server is involved at run time. There is no backend, no API, and no
server-side rendering.

## Decisions

These were settled before writing this spec and the design assumes them:

```text
stack        TypeScript + Vite, no UI framework
game data    bundled with the app at build time
v1 scope     playable core; no sound, no save/restore   (M0-M6, shipped)
v2 scope     sound (M7, shipped), then save and restore (M8)
code sharing npm workspaces, web-agi imports agi-extract
```

### Target game

The bundled game determines which interpreter the engine must imitate, so it is
part of the design rather than a detail of deployment:

```text
game          Leisure Suit Larry 1, version 1.00
interpreter   AGI 2.440
opcode table  170 action commands
```

Read from the game files themselves (`AGIDATA.OVL` carries the version string,
and the interpreter file sizes key the version table in the AGI documentation).
The command count is the game's own, not the documentation's: see *Bytecode*.
The engine is still written against AGI v2 in general — the version decides which
opcode table is loaded, not how the engine is structured.

**On bundling game data.** The game files are copyrighted, and bundling puts
them in the repository and ships them on deploy. That is a deliberate choice
recorded here, not an oversight. To keep the option open, all resource loading
goes through a `ResourceSource` interface (see _Resource layer_), so serving a
different game, or letting a player supply their own files, becomes a second
implementation of one small interface rather than a rewrite.

## Goals

- Play an AGI v2 game from its original, unmodified resource files.
- Render the visual screen, sprites, text and menus faithfully at 320x200.
- Interpret LOGIC bytecode, including the `said` parser tests.
- Accept keyboard input: walking, the text prompt, and menus.
- Reuse `agi-extract`'s PICTURE and VIEW decoders rather than reimplementing them.
- Run at a stable, correct cycle rate independent of display refresh rate.

## Non-goals

- No AGI v3 support; the resource layer is where it would be added.
- No LOGIC decompiler or authoring tools. The engine executes bytecode; it does
  not produce source.
- No mobile/touch controls in v1.
- No SCI games, ever. Different engine entirely.

## Repository layout

The repository becomes an npm workspace with two packages:

```text
agi-extract/            (existing) CLI and resource decoders
web-agi/                (new) the browser engine
  index.html
  vite.config.ts
  public/
    game/               bundled game resources, copied verbatim
  src/
    main.ts             entry point: build the app shell, start the engine
    shell/              DOM around the canvas: mount, errors, debug keys
    resources/          loading and decoding AGI resource files
    logic/              LOGIC bytecode: reader, opcode table, disassembler
    engine/             the machine, its state, the game cycle, objects,
                        rooms, motion, menus, inventory
    render/             screens, sprites, text, canvas output
    input/              keyboard, the command line, the parser
    audio/              the AudioContext and the SOUND player (M7)
    storage/            saved games (M8)
  test/                 unit tests, mirroring src/
package.json            workspace root
```

## Reuse from agi-extract

`agi-extract` already implements, and has tests for, the parts of the format
this engine would otherwise duplicate:

```text
reuse as-is     pic.js      PICTURE interpreter -> visual + priority screens
                view.js     VIEW decoder: cels, loops, mirroring, transparency
                directory.js  3-byte DIR entry parsing
                volume.js   VOL header validation (parseVolHeader)

port            files.js    GameFiles/VolumeFile are built on node:fs
                            -> web-agi supplies its own byte-range reader

not needed      png.js      the browser draws to canvas, not PNG
                cli.js, extract.js  file-writing concerns
```

Two portability details to resolve when wiring this up:

- `view.js` decodes the description text with Node's `Buffer`. The engine needs
  that path to work without `Buffer`, so this becomes a small change in
  `agi-extract` (use `TextDecoder` with `latin1`) rather than a fork.
- `volume.js` reads through a `FileHandle`. The engine reads from an
  `ArrayBuffer` already in memory, so only `parseVolHeader` is shared; the
  seek-and-read wrapper is reimplemented against the byte source.

Anything the engine adds that is genuinely about the _format_ rather than about
_playing_ — the LOGIC resource reader, WORDS.TOK, OBJECT — is written so it could
later move into a shared core package. It is not moved in v1.

## Resource layer

### Source interface

Everything above this line is unaware of where bytes come from:

```ts
interface ResourceSource {
  /** Case-insensitive, like the DOS originals. Returns null when absent. */
  read(name: string): Promise<Uint8Array | null>;
}
```

v1 ships one implementation, `BundledSource`, which fetches from `public/game/`
using a manifest generated at build time (a directory listing is not available
over HTTP). A `DirectorySource` backed by the File System Access API, or a
`ZipSource`, would be later additions requiring no engine changes.

### Files read

```text
LOGDIR, PICDIR, VIEWDIR, SNDDIR   resource directories
VOL.0 ... VOL.n                   resource payloads
OBJECT                            inventory items, encrypted
WORDS.TOK                         vocabulary, packed and encrypted
```

SNDDIR is read from the start even though nothing played its resources before
M7; the resource layer treats all four types alike.

### Resource manager

Loads the four directory files once, then serves resources on demand:

```ts
class ResourceManager {
  load(type: ResourceType, id: number): Promise<Uint8Array>; // payload, no VOL header
  isPresent(type: ResourceType, id: number): boolean;
}
```

VOL files are fetched whole and cached as `ArrayBuffer`s; AGI VOL files are
small enough that range requests are not worth the complexity. Resource payloads
are extracted with the same directory-entry and VOL-header logic `agi-extract`
uses, including its validation.

### OBJECT

Holds the inventory items and the maximum number of animated objects. Most games
encrypt it: bytes are XORed cyclically against a fixed 11-character key
(`Avis Durgan`; AGDS games use `Alex Simkin`). Some early games do not encrypt at
all, so the loader must detect which it is holding rather than assume.

Provides item names and each item's starting room, which `has`, `obj.in.room`
and the inventory screen depend on.

### WORDS.TOK

The vocabulary the parser matches against. It is both packed and encrypted, and
its words are stored in alphabetical order because the packing depends on that
ordering. It opens with a 26 x 2-byte index giving where the words for each
initial letter begin. That index is **big-endian**, against AGI's usual
little-endian convention — read little-endian it produces offsets outside the
file, which is a quick way to confirm the reader is right.

Each word carries a word number. Several words may share one number, which is how
the game expresses synonyms: `said` tests compare word numbers, never spellings.

## Interpreter state

The machine the LOGIC code runs on:

```text
256 variables      8-bit, numbered 0-255; 0-26 reserved by the interpreter
256 flags          1-bit, numbered 0-255; 0-15 reserved by the interpreter
12 strings         40 characters each
inventory items    from OBJECT
screen objects     the view table, entry 0 being ego
```

Numbering is independent per type: variable 5, flag 5, string 5 and object 5 are
unrelated.

The reserved variables and flags are the interface between the engine and the
game's scripts — the engine writes things like the current room, ego's position
and edge contacts, and the scripts read them. Getting this set right is what
makes a game behave rather than merely run; each reserved slot is implemented
against the specification's table, with the tests naming the behaviour rather
than the number.

## LOGIC resources

### Resource format

After the 5-byte VOL header is stripped, a LOGIC payload begins with a 2-byte
little-endian offset to the message section. Bytecode occupies everything from
just after that offset field up to where the messages begin.

```text
byte 0-1   offset to the message section
byte 2..   bytecode
...        message section
```

### Messages

Printable text lives at the end of the resource, encrypted with the same
cyclic-XOR scheme as OBJECT. Messages are addressed by number from the bytecode,
not inlined.

```text
section[0]      number of messages
section[1..2]   end position of the section
section[3..]    count x 2 offset table, 16-bit, NOT encrypted;
                offsets are relative to section + 1, and an offset of 0
                means the message does not exist
then            null-terminated strings, encrypted
```

Two details decide whether the text comes out readable, and neither is stated
outright in the format documentation:

- An offset of `0` marks an absent message rather than one at position zero.
  Message numbering is sparse; slots are skipped.
- **The cipher key restarts at the start of the strings region**, not at the
  start of the section or of the resource. Confirmed by decrypting every message
  in the bundled game under each candidate anchor: the restarting anchor yields
  100% printable characters across all 45 readable resources and 2040 message
  slots, while every other anchor falls to roughly 90%.

### Bytecode

Two instruction spaces:

```text
test commands     used only inside if-conditions
action commands   everything else, opcodes from 0x00 upward
```

The bundled game's interpreter, 2.440, uses **170 action commands**, opcodes
0x00-0xA9. The count is version-specific: later Sierra interpreters added
commands. The opcode table therefore holds every command any version knows, in
opcode order, together with a per-version count of how many of them that version
recognises; the engine records which interpreter version a game targets and
refuses an opcode above that version's ceiling rather than assuming one table
fits all.

Argument counts are shared across versions, not per-version. The documentation
notes that at least one command's argument count differs between interpreters,
but no such command appears in the bundled game, and the whole-game decode below
would not pass if one did. Should a second game need it, the per-command entry is
where a version-specific count would go.

The documentation's version table gives 169 for 2.440, but the game itself uses
opcode 0xA9 (`close.window`). Rejecting it fails one resource; accepting it makes
all 46 decode exactly to their message section with every jump landing on an
instruction boundary. Desync corrupts a walk rather than tidying it, so the game
is the authority here. Nothing above 0xA9 appears anywhere in it.

The opcode table itself is derived rather than transcribed: the documentation's
opcode column is damaged in runs, but its rows are a complete ordered listing, so
an entry's opcode is its position. Positions 0x00-0x29 still carry their printed
opcode and agree exactly, and `return`, `new.room`, `print` and `quit` land where
AGI is independently known to put them. The whole-game walk then settles it.

Most commands take one to seven arguments, each a fixed single byte whose meaning
(variable number, flag number, message number, literal…) comes from the table.
Two constructs are irregular and need their own decoding:

- **`said`** takes a variable-length list of 16-bit word numbers.
- **`if`** blocks contain a condition expression with `or` and `not` operators
  and a 16-bit jump displacement to the else/end target.

A disassembler is built alongside the interpreter, from the same table. It is not
a gameplay feature; it exists so that when a game misbehaves the failing script
can be read, and it is reachable at run time through the debug overlay's `F9`.

## The LOGIC interpreter

Executes one resource's bytecode against the shared state. Commands are dispatched
through a table of handlers keyed by opcode, so an unimplemented command fails
loudly with its number and the script position rather than silently corrupting
state.

Control flow within a script is a program counter over the bytecode. Scripts call
other scripts; a call runs to completion and returns, so the engine keeps a call
stack and guards against runaway recursion.

Scripts also wait by spinning. A help or puzzle screen writes itself into the
character cells and then loops on `if (!have.key()) goto self`, which the
original satisfies by reading the keyboard from inside the loop -- something an
engine driven by browser events cannot do, and which hangs the tab rather than
merely misbehaving. So the machine counts backward jumps taken with no command
in between: past what any real loop needs, a script going round on tests alone
is waiting for something no test inside the loop can change. If it asked whether
a key is waiting, the cycle parks until one is; if it asked anything else,
nothing mid-cycle can satisfy it and the loop is reported as a defect. A cycle
also has an instruction budget, so a runaway that is neither becomes an error
with a script position rather than a frozen page.

Three commands end a cycle rather than returning normally, and the interpreter
must unwind out of every nested call when they run:

```text
new.room        change room; abandons the rest of the cycle
return          end this script
quit            stop the engine
```

## The game cycle

One iteration of the interpreter's loop, in order:

```text
1. wait out the cycle delay
2. clear the keyboard buffer
3. poll keyboard input
4. update the reserved variables and flags from input and engine state
5. recalculate the direction of motion of every controlled, updating object
6. execute LOGIC 0, which calls whatever other scripts the game needs
7. check whether new.room was issued, and if so restart with the new room
```

The cycle rate is set by the game through a reserved variable, so the loop is
driven by a fixed-timestep accumulator, not by `requestAnimationFrame` alone:
rendering may run at display rate, but game cycles must not. A slow frame must
never make the game run fast, and the loop caps how many cycles it will catch up
in one frame rather than spiralling.

### Room changes

`new.room` is not a jump. It unloads the current room's resources, resets the
non-persistent parts of the state, loads the new room's LOGIC, and starts a fresh
cycle. The sequence is precise and a common source of subtle bugs, so it is
implemented as one documented function with its own tests.

## Graphics

### Screens

The engine keeps the same two 160x168 screens `agi-extract` already produces:

```text
visual screen     what the player sees, one EGA colour index per pixel
priority screen   depth and control information, never displayed
```

An AGI pixel is twice as wide as it is tall, so the picture is presented at
320x168.

### Priority and control

Priority values 4-15 are drawing priorities: a sprite is drawn only where its
priority is at least that of the background, which is what puts ego behind a tree.
The screen is divided into roughly eleven horizontal priority bands, and an
object's priority normally follows the band its base is standing in.

Values 0-3 are not depth but control information the game reacts to:

```text
0  unconditional obstacle
1  conditional obstacle
2  alarm line, triggers an event when crossed
3  water, or a surface an object is confined to
```

Movement checks read these, which is why the priority screen must be rendered as
carefully as the visible one even though nobody sees it.

Because the control values share the buffer with the depths, a control line
erases the depth of the pixels it covers. It is therefore read as a gap rather
than as a depth: a sprite compositing against a control-line pixel takes the
first real priority below it, which is the ground the line was drawn along.
Reading the line itself as a depth lets sprites through it, and a line crossing
scenery then shows up as a one-pixel trail of sprite-coloured leaks.

### Display layout

The full 320x200 display is a 40x25 grid of 8x8 characters:

```text
row 0        status line
rows 1-21    picture area, 168 pixels tall
rows 22-24   prompt and input line
```

Text uses the standard 8x8 IBM PC font. The engine embeds a font bitmap as a
build asset; it is not read from the game files.

## Objects and sprites

The view table holds the animated objects. Object 0 is ego, the character the
player controls; the rest are controlled entirely by scripts.

Each entry tracks its view, loop and cel, its position, direction, step and cycle
timing, its priority, and a set of flags covering how it moves, whether it
animates, whether it observes obstacles, and whether it is drawn at all.

Per cycle, for each updating object: advance cel cycling, apply motion, resolve
blocking against control lines and the screen edges, then draw. Drawing composites
the current cel onto the visual screen through the priority test, honouring the
cel's transparent colour, with mirroring resolved exactly as `agi-extract` does.

The engine restores what a sprite covered before the next cycle draws it, rather
than redrawing the whole picture, matching the original's model of a static
background with objects composited over it.

Objects are drawn back to front by priority. Where two share a priority, the
tie-break is that a *moving* object is drawn over a stopped one: the original
keeps two sprite lists and blits the `stop.update`ed, scenery-like objects
before the ones that move. It matters wherever a game pins furniture to the same
priority band as the floor beside it -- an object whose drawn silhouette is
wider than the footprint its control lines defend would otherwise swallow a
character standing next to it.

## Text, windows and menus

- **Status line**: score and sound state, drawn on row 0 when enabled.
- **Message windows**: word-wrapped boxes drawn over the picture, dismissed by a
  keypress or after a timeout. Drawn as the original draws them: the box in its
  background colour, a single red line ruled a little way *inside* the edge
  rather than around it, and the text padded a character cell in from that line.
- **Inventory screen**: the item list, and item close-ups drawn from a VIEW.
- **Menus**: the pull-down menu bar the game defines through LOGIC commands.

All of these suspend the game cycle while open, which the loop must model
explicitly rather than by blocking.

## Input and the parser

Keyboard handling covers three modes: walking (arrow keys set ego's direction),
the text prompt (a line editor over the input line), and menu navigation.

The input line is drawn as a marker, the typed text, then a cursor. The two
characters come from different places and are easy to confuse: the marker is
string 0, the one string the interpreter reserves -- this game writes `]` into
it -- while the cursor is set by `set.cursor.char`, which this game sets to `_`.
Using one for the other gives an input line reading `__`.

When the player submits a line, the parser:

```text
1. lowercases and strips punctuation
2. matches the longest possible vocabulary entry at each position,
   because entries may be multi-word phrases
3. discards words the vocabulary marks as ignorable
4. produces the list of word numbers the said tests compare against
5. sets the reserved flags that tell the scripts input is waiting
```

An unrecognised word must be reported as such, which means the parser has to
distinguish "not in the vocabulary" from "recognised but not understood here".

## Sound (M7)

Sound was not part of the playable core and was deliberately deferred, but the
core was written so that adding it changed no control flow: every sound command
already set the flag scripts wait on, and M7 changed only *when* that flag is
set.

### SOUND resources

The bundled game has 28 of them. The layout was read out of the game rather than
taken from documentation, and it holds for all 28:

```text
byte 0-7     four 16-bit little-endian offsets, one per channel
             the first is always 8, and the four are ascending
channels     3 tone channels, then 1 noise channel
notes        5 bytes each, the run ending at a 0xFFFF terminator
```

Every one of the 112 channels in the game terminates and ends exactly on the
next channel's offset, which is what confirms the 5-byte note.

```text
note[0..1]   duration, 16-bit little-endian, in 1/60 s ticks
note[2..3]   frequency divisor: (b2 & 0x3f) << 4 | (b3 & 0x0f)
note[4]      attenuation in the low nibble: 0 loudest, 15 silent
```

A tone channel's frequency is `111860 / divisor` Hz — the PCjr's SN76496 clock
divided down. **A divisor of 0 occurs in the game and means a rest**, not a
division by zero; it is the one value that makes a straightforward reader
misbehave. Attenuation is 2 dB per step, so gain is `10 ** (-att / 10)`, with 15
forced to silence rather than approximated.

On the noise channel the frequency field means something else: the low three bits
of `b3` select the noise type and shift rate, with bit 2 set choosing white noise
over periodic.

### Playback

WebAudio maps onto this directly: three `square` oscillators, one per tone
channel, plus a looping noise buffer, each through its own gain node. Notes are
written as scheduled parameter changes on the audio clock rather than played from
the game cycle — the game's longest sound is 58 seconds, and the two clocks
drift.

The engine never talks to WebAudio itself. It holds a `SoundOutput`, of which
WebAudio is one implementation and silence is another, so the rules below hold
identically with no audio at all — which is the state of every headless test and
of every browser before the player has touched the page.

*The audio* is timed on the audio clock; *the flag a script waits on* is timed on
the engine's own elapsed milliseconds, and is advanced before anything else in
the loop. That is what lets a sound finish, and release the script waiting for
it, while the game is parked on a window with no cycles running at all.

The noise channel is an approximation and says so: the original is a shift
register whose periodic mode has an audible pitch, and what is built is a
looping buffer of random samples played at the rate the notes ask for.

Two constraints shape the design more than the format does:

- **An `AudioContext` starts suspended until a user gesture.** The context is
  created lazily and resumed on the first keypress, and a suspended context
  degrades to what M4 did — silence, with the flag set on schedule — never to a
  stall.
- **`stop.sound` must release whatever was waiting.** A script that stops its own
  sound and then waits on its flag would otherwise hang. This is the one deadlock
  playback can introduce that a no-op could not.

`FLAG.SOUND_ON` is the on/off switch the status line shows, and
`VAR.SOUND_VOLUME` is a level from 0 to 15 that the game's own volume keys move
— logic 0 raises it only while it is under 15, which is where the range comes
from. Both are honoured, and neither touches timing: a sound turned down or off
mid-way still takes exactly as long, so the scripts waiting on it are released
at the same moment and the game's pacing does not change with a volume key.
Nothing in the game ever sets the volume a first time, so the engine starts it
at 15; started at zero, the whole game plays silently.

Playback is stopped on `new.room`, on `quit` and on a restart, with the rest of
the teardown, because scheduled audio otherwise outlives the room that started
it — and each of those paths sets the waiting script's flag, for the same reason
`stop.sound` does.

## Save and restore (M8)

The interpreter's state is kept as data rather than scattered across closures,
which is what makes this a serialisation problem rather than a refactor.

### What a snapshot holds

```text
GameState     256 variables, 256 flags, 12 strings, the room number
Inventory     the current room of every item, not OBJECT's starting rooms
ViewTable     every active object: view/loop/cel, position, direction, step and
              cycle timing, motion state, priority, and its flags
Machine       horizon, block rectangle, playerControl, inputAccepted,
              statusLineVisible, textMode, text colours, currentPicture,
              loadedPictures, lastLine
MenuBar       which items the game has greyed out
scan starts   the per-logic re-entry points set by set.scan.start
```

The last of these is the one that is easy to miss. `set.scan.start` moves where a
script resumes next cycle, and it lives on the compiled logic beside the decoded
instructions, which makes it look like a property of the resource. It is not: a
game restored without it puts every mid-wait script back at the top of its
question. The original interpreter saves these too.

Nothing derived is saved. Decoded views, the drawn background, the saved sprite
areas and the text layer are all rebuilt by replaying the room load, exactly as
`new.room` builds them. Saving them would double the format and give it a second
way to be wrong.

A snapshot is a JSON-serialisable value carrying a format version and a
fingerprint of the game it came from (the resource counts and item count that
`summariseGame` already computes). A snapshot from another game or an older
format version is refused with a message, not applied.

### Restoring

`restore.game` replaces the state from inside a running cycle, so the rest of
that cycle must be abandoned the way `new.room` abandons it. The engine's
`Unwind` already carries a kind for exactly this; restore becomes another kind
rather than a second mechanism, and the cycle then loads the room the snapshot
names.

Saves live in named slots in IndexedDB, keyed by the game fingerprint, and can be
exported to and imported from a file so they survive the browser clearing site
data. Storage fails at the moment a player is trying not to lose progress, so a
failure is reported in the shell like any other, never swallowed.

The save and restore dialogs are the same suspend-the-cycle `Interaction` the
inventory screen and text windows use, and the game's own menus and key bindings
already offer Save and Restore — the previously stubbed commands simply start
doing something.

## Rendering to canvas

A single `<canvas>` at 320x200, scaled up by whole-number factors with smoothing
disabled so the pixels stay sharp. The engine composes into an offscreen
`ImageData` buffer and blits once per frame; it never draws primitives with the
canvas 2D API.

Rendering is decoupled from the cycle: the engine marks the frame dirty, and the
next animation frame paints it. A cycle that changes nothing costs no drawing.

The canvas is letterboxed to preserve aspect ratio, and the scale factor follows
the window size.

## Application shell

Deliberately thin: a page holding the canvas, a title, and an error surface.

Errors are reported rather than swallowed. A missing resource, a corrupt VOL
header or an unimplemented opcode shows what failed and where, because during
development those are the interesting events.

A debug overlay, behind three function keys, exposes what would otherwise
require a debugger: `F7` swaps the visual screen for the priority screen, `F8`
dumps the engine's state -- the view table, the room and cycle counters, the
variables and flags the game has touched, and the commands it reached that the
engine cannot yet do -- and `F9` disassembles the current room's script.

## Error handling

The engine distinguishes three kinds of failure:

```text
load failure       missing or malformed game files; fatal, reported in the shell
engine defect      unimplemented opcode, bad jump; fatal, reported with context
game-data oddity   a script doing something unusual but legal; logged, continue
```

`agi-extract`'s stable error codes are reused for anything about resource
loading, so both projects name the same failures the same way.

## Testing

`node:test` as in `agi-extract`, run against the source directly.

```text
unit         opcode decoding, message decryption, WORDS.TOK and OBJECT parsing,
             parser matching, priority and blocking rules
golden       load the bundled game, run N cycles from a fixed start, and compare
             a hash of the visual screen against a recorded value
regression   each fixed game bug becomes a test that runs the shortest cycle
             sequence reproducing it
round trip   run N cycles, snapshot, run M more, restore the snapshot, run
             those M again, and compare screen hashes
```

The round-trip test is how M8 is proved. A snapshot that omits a field restores
without error and diverges quietly minutes later; a diverging hash is the only
thing that finds the fields nobody thought of.

The golden tests matter more than usual here: an interpreter has enormous state,
and most defects show up as a wrong picture rather than an exception. Being able
to say "room 1 renders identically to yesterday" is what makes changes safe.

Rendering is testable headlessly because the engine composes into a pixel buffer;
only the final blit needs a canvas.

## Milestones

Each milestone ends with something observable, not just code. M0-M7 are done;
M8 is specified below and not yet built. The numbering is the one
[plan.md](plan.md) works to.

```text
M0  Workspace foundation
    npm workspaces, Vite, the page mounted, game files bundled with a manifest.
    Ends with: the dev server serves a page and tests run in both packages.

M1  Resource layer
    The four DIR files, the resource manager, WORDS.TOK and OBJECT.
    Ends with: resource, item and word counts printed on screen.

M2  Static rendering
    The two screens, the display buffer, agi-extract's decoders wired in.
    Ends with: any PICTURE drawn on the canvas, any VIEW cel drawn over it.

M3  LOGIC reader
    Bytecode reader, opcode table, message decryption, disassembler.
    Ends with: any LOGIC resource disassembled to readable text.

M4  The machine runs
    State, interpreter, cycle loop, room loading.
    Ends with: the game's first room loads and its script runs without ego.

M5  Ego moves
    View table, sprite drawing, motion, priority and control lines.
    Ends with: walking around room one, correctly occluded and blocked.

M6  The game is playable
    Text windows, status line, inventory, menus, the prompt and the parser.
    Ends with: the game's opening is playable from the first room onward.

M7  Sound
    SOUND resources decoded, WebAudio playback, the sound commands made real.
    Ends with: the game's sounds play, and stopping one releases the script.

M8  Save and restore
    Snapshot of the interpreter's state, storage, and the two dialogs.
    Ends with: save, reload the page, restore, and play continues.
```

```text
M0  complete    M3  complete    M6  complete
M1  complete    M4  complete    M7  complete
M2  complete    M5  complete    M8  not started
```

## Later phases

Specified now so the design does not preclude them. Sound and save/restore were
in this list while M0-M6 were the whole of the spec; they are now *Sound (M7)*
and *Save and restore (M8)* above, and the two concessions the core made to them
— sound commands setting their flags, and state kept as data — are what let them
be milestones rather than rewrites.

- **Player-supplied game files.** A second `ResourceSource` implementation.
- **AGI v3.** Different directory layout and compressed VOL entries; confined to
  the resource layer by design.

## Open questions

To settle before or during the milestone they affect:

- Whether the game needs a game-specific loader. Some AGI games have quirks the
  original interpreter special-cased.
- How faithfully to reproduce the original's timing. The cycle rate is specified,
  but the original's speed also depended on the hardware it ran on.
- Whether the debug overlay ships in the production build or is stripped.
