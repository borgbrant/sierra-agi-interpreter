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
v2 scope     sound (M7) and save/restore (M8), both shipped
v3 scope     the sound chip switch (M9), the display seam (M10), what the
             scripts are told (M11), CGA (M12) and Hercules (M13, M15), shipped
v4 scope     the shell the player sees (M14), shipped
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

- **An `AudioContext` starts suspended until a user gesture**, and the game
  starts its theme on cycle 1. Those two facts do not fit, so the game **starts
  with its sound switched off** and the player turns it on when they want it —
  which is itself a gesture, and therefore the moment audio can exist. Nothing
  is gated on it: the game runs from the moment it loads, the context is built at
  the first key or click whenever that comes, and a sound already playing by
  then is handed to it at the point it has reached, so switching sound on during
  the theme joins the theme rather than restarting it. The game's own start-up
  script switches sound on during the first cycle, so the shell switches it off
  after that cycle rather than racing it. A browser with no WebAudio at all
  simply plays silently.

  Off rather than merely silent, because the status line shows the game's sound
  flag: a game that says *Sound:on* while playing nothing is worse than one that
  says what it is doing.
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

## The graphics modes (M10-M13)

The original shipped four display drivers and the game still carries them:
`EGA_GRAF.OVL`, `CGA_GRAF.OVL`, `JR_GRAF.OVL` and `HGC_GRAF.OVL`, with a
`HGC_FONT` and a pair of `*_OBJS` overlays beside them. The engine now draws
through a driver and the shell chooses which — **three drivers, not four**, and
all three draw in their own colours at their own size. This is what the other
two mean, and why there is no third.

A mode is two things at once, and that is the whole difficulty -- and the reason
the work is four milestones rather than one. It is an adapter's palette to draw
with (M10 made room for it, M12 and M13 build two), and it is an answer the
scripts get (M11, shipped). The two are worth separating because they are
checked in entirely different ways: a seam and an answer can be tested, while a
palette can only be looked at.

```text
EGA        16 colours, 160x168 doubled to 320
CGA        4 colours, with the 16 reached by dithering pairs of pixels
Hercules   two colours at 720x348, an 18x12 cell, and a screen with no room
           at the bottom for a command line
```

CGA's dither costs nothing, which is why one set of resources could serve four
adapters. Hercules dithers all sixteen of its colours over an 8x8 cell, and its
table is the interpreter's own — see *What the screenshots settled, and what
they could not* below. An AGI pixel is twice as wide as it is tall, so EGA spends its 320
pixels *duplicating* the picture's 160; CGA spends the same two on colour
instead. What it cannot do is reach sixteen: two colours from four is ten
blends, so six of the sixteen share an appearance with another. The mapping is
CGA palette 1 at low intensity — black, cyan, magenta, light grey — chosen by
scoring all four hardware palettes against the colours this game actually
draws, which puts the bright cyan-and-magenta of Sierra CGA screenshots second.
Three quarters of what is lost is one group: light grey, yellow and white, all
on the brightest blend, because a palette whose brightest colour is light grey
cannot show a highlight on light grey. Text is drawn solid rather than dithered
— a glyph stroke is one or two pixels of an eight-pixel cell, and a dithered
stroke is a stroke with holes in it.

`JR_GRAF.OVL` has no counterpart, and that is a decision rather than an
omission. A PCjr differs from an EGA in three places and two of them are empty:
its 160x200 mode *is* the sixteen-colour palette AGI was drawn for, so there is
no driver to build, and its monitor value is distinguished by no branch in the
game. What is left is that computer type 1 binds the digit keys instead of the
function keys, because a PCjr's chiclet keyboard had none — which is a
*computer* the game is running on rather than a monitor it is drawn on. A
graphics mode whose whole effect is a keyboard mapping is not a graphics mode,
and a select offering a fourth choice that can never look different from
another misdescribes what the engine does. The behaviour is recorded in
`engine/hardware.ts`, and the day the shell offers a computer to choose, the
PCjr is the first entry on that list.

The scripts ask about the display in twenty-seven places, and twenty-six of them
ask one question: *is this mono?* CGA, PCjr and EGA all take the same path. The
twenty-seventh is logic 0 asking for an IBM PC that is neither mono nor EGA —
which is CGA — and offering it a graphics-mode toggle, the one script-visible
difference that mode has.

On a mono screen the game lays itself out differently, and it does so itself:
it drops a line it would otherwise print, prints another on row 24 instead of
21, narrows an input field from 38 characters to 28, and twice loads a different
view. None of that asks the interpreter to move anything. So a Hercules mode
that draws in two colours without answering the scripts would lay itself out
wrongly, and one that answers without drawing is exactly what M11 ships: the
mono layout, in EGA's colours.

`configure.screen` is real as of M11. The bundled game calls it once, at
start-up and unconditionally, with the three rows the engine had assumed —
status line 0, input line 23, nothing printed above row 1 — so honouring it
changes nothing here and removes an assumption from three modules.

The computer type is a separate variable from the monitor, read at ten sites in
logics 0, 51 and 55: a different menu, different key bindings, and four
different help pages. The shell has no control for it, so it is inferred from
the one choice that bears on it — the PCjr's sound chip with ordinary graphics
is a Tandy 1000, and anything else is an IBM PC. A Tandy is the one machine
other than a plain PC the shell can describe, and what the game gives it is its
volume keys.

Each mode is a **display driver**, a layer outside the engine that the engine
draws through — one per adapter, as the original had one overlay per adapter.
What crosses down to a driver is a *frame*: an ordered description of the two
160x168 screens, the cells that have been written and their colours, any window
over them, and — once, for an item's close-up — a lone VIEW cel. Nothing in it
mentions a display pixel. What a driver decides is its canvas size and pixel
aspect, its palette and how sixteen colours reach fewer, its font, and how a
character cell becomes pixels.

That is not an aesthetic split. **Hercules is 720x348**, not 320x200, and its
font is not the engine's: the game's own `HGC_FONT` is 3072 bytes — 256 glyphs
of 12 bytes, an 8x12 cell against the 8x8 drawn today. A layer that could only
choose colours would have nowhere to put either fact, so the canvas takes its
size and proportions from the driver rather than from the 320x200 the engine
happens to compose in now. Nothing above the seam asks which driver is running;
the one fact that travels the other way is the reserved monitor variable, and
that belongs to the scripts rather than to the renderer.

The CGA palette cannot be read out of the original driver, because the bundled
game deliberately ships only its resource files. It is derived instead, and
checked the way the opcode table was: by rendering the game's own pictures and
looking at the result. Hercules' two colours were derived the same way until
M15, which replaced them with the interpreter's own table, read out of
`AGIDATA.OVL` -- so of the two mappings one is judged and one is copied. M12 is where that mattered — two
mappings that scored better on lost boundaries each hid a whole object, because
a boundary count measures an outline's perimeter while the object is its area.
What each mapping costs is recorded beside it and recomputed by a test, so
changing it is a decision with a number attached rather than a matter of taste.

### Hercules, and what photographs settled

Its geometry is arithmetic once the photographs are read. The adapter is
720x348; the picture is four times its width by twice its height, 640x336,
centred with 40 unlit pixels either side; and it reaches the bottom of the
screen with no dead band under it. 640x336 is 1.905:1, exactly what EGA shows
the same picture at with 320x168, so the buffer wants square pixels.

The character grid goes across **the picture's 640 pixels, not the screen's
720**: the photographs show the status bar exactly as wide as the scene, and the
game's bottom band starting at the scene's left edge. So the cell is 16 wide,
and the glyph fills it — doubled from the font's 8 bits, which is the thick
wide lettering the photographs show. The air between the letters is the font's
own: every PC font of this family leaves its rightmost column blank — only two
of the engine's 95 glyphs use theirs — and that column doubles to two pixels of
ground. AGI's rows 1 to 24 are the picture's 336
rows, which makes the cell 14 tall and puts rows 22 to 24 on the screen's bottom
edge, where the photographs have the band; `HGC_FONT`'s glyphs fill 12 of the
14, leaving two of leading.
Twenty-five 14-row cells is 350 against a 348-row card, so the last two pixels
of row 24 fall off.

The game's rows 22 to 24 therefore have scene behind them. That is where it puts
"Please answer a, b, c, or d:" and its captions, and it gets a black bar to put
them on by clearing those rows first — which is why `clear.lines` has to
**paint** rather than empty cells. See *The text plane* below.

The dither is **the interpreter's own**, copied rather than reconstructed: 128
bytes at offset `0x1bea` of `AGIDATA.OVL`, which is the table Sierra's
`HGC_GRAF.OVL` indexes. Every one of AGI's sixteen colours has a pattern in it,
over an 8x8 cell of device pixels, at ten distinct densities from 0/64 to 64/64.
There is no threshold anywhere in it.

### What the screenshots settled, and what they could not (M15)

Two tables were built before anyone opened that file, and both were careful and
wrong. M13 derived densities from luminance and handed out three weaves by rule.
M15 then measured densities off the captures in `screenshots-from-original/` and
concluded that thirteen of the sixteen colours were solid — which is what a
capture says if you threshold its pixels. Half of the real table's patterns
alternate on a one-pixel pitch, and a capture smooths those into a flat
half-tone before it is ever saved, so light grey's checkerboard reads as solid
amber and cyan's alternating rows as solid black.

What the captures *did* settle is the geometry, and one fact nothing here
predicted: they are scaled screen grabs rather than photographs of a tube, each
a whole multiple of the mode's own raster, and the status bar's lit band is
**twelve device rows** rather than fourteen — the row is a fourteen-row cell
whose inverse background covers only the twelve rows `HGC_FONT`'s glyphs occupy.

They also corroborate the table, once they are read for brightness instead of
bits. The mean luminance of each colour's regions against the table's densities
is a straight line, `luma = 6.1 + 137.1 x density`, at R² = 0.95 and in the
correct order throughout — with the residual curving the way a display gamma
curves. Even the colours with a handful of pixels land where the table says:
green at 8/64 comes back at 22 over 34 pixels, yellow at 60/64 at 144 over nine.
What is compared against is the screen the *room* composes, not a PICTURE
resource, because a room draws over its picture and those pixels are not the
colour the PICTURE holds underneath them.

The cost of two colours is still real, and now it is the original's cost rather
than this project's: ten densities for sixteen colours, so four groups collide —
green, magenta and dark grey at 8/64; cyan, red and brown at 16/64; light blue
with light cyan; light red with light magenta. Each pair is told apart, where it
is told apart at all, by the shape of its weave rather than by its brightness.

### The text plane

The engine keeps text in a plane of character cells that the picture shows
through, rather than in the picture itself: that is what lets a window close
without the scene being redrawn. `clear.lines` is the one command where the
difference bites, because AGI has no such plane — it paints the colour over
whatever was there.

So it paints here too. It emptied cells until M13, and the two were
indistinguishable for seven milestones: on a 320x200 screen nothing is behind
rows 22 to 24, so transparent and black look the same. Hercules is where they
came apart, and the defect turned out to be on EGA as well — the game clears
**row 21**, the picture's last row, in two places, and prints a caption on the
black bar that makes.

Making it paint exposed a second gap, which M8's round-trip test found the same
minute: the snapshot did not carry the text plane. It had never needed to, for
the same reason. It carries it now, as a sparse list of the cells that hold
something.

The phosphor is amber. It belonged to the monitor rather than to the card and
green was equally common, but every photograph of this game on a Hercules is
amber.

### The prompt box

The photographs show a box over the scene with a title on one line, a blank
line, and the typed text in an inverse field — while the screen's bottom rows
carry the game's own text instead. The game's own questions use the same box:
`get.num`'s "How old are you?" is drawn exactly like the command line, while a
plain message window beside it is still just text in a box. `ENTER COMMAND` is
the interpreter's own words — no message in any LOGIC resource contains them.

Not because there is nowhere else to put it, which was the first explanation
here and was wrong: rows 22 to 24 exist on Hercules too. The original chose a
box, and the engine follows the evidence rather than an argument that turned out
to be circular.

The engine draws it whenever the display is monochrome, read from the monitor
variable rather than from the renderer — the same fact the scripts read, so
nothing above the display seam has to ask which driver is running. The game's
own `toggle.monitor` therefore moves the command line into a box and back.

Because it covers the scene the scene has to hold still, so it is an interaction
rather than a layer of the frame: it opens on the keystroke that would have gone
onto an input row, the cycle parks on it, and the game carries on when the line
is handed over. Escape abandons it, and so does backspacing away the last
character. It carries no `]` — that marker belongs to the input *row*, and the
box announces itself with its title.

### Hercules is a simulation, and it is now a close one

It used to be the least faithful of the three modes, and the reason was that
every file behind it belonged to the interpreter rather than to the game.
`HGC_FONT` and `AGIDATA.OVL` are copied now when a copy of the game has them —
optional, like every interpreter file, and read when they are there. So the
letterforms are the original's and so is the dither table; what is left is
smaller than it was:

```text
how sprites are drawn     through the picture's own table, where the original
                          had HGC_OBJS.OVL to do it. Nothing here has read that
                          overlay, and the captures cannot settle it: the
                          hatched objects in them turned out to be brown in the
                          room's composed screen, which the picture table
                          already explains
the status bar's band      its lit background is twelve device rows of the
                          fourteen-row cell, measured off the captures while
                          calibrating them; this engine fills the whole cell,
                          so its status row is two rows taller than the
                          original's
AGI's 25 rows on 29       the picture covers 28 of them, so the game's own
                          rows 22-24 sit on scene and the rest is unreachable
                          by any text row; nothing decides whether the original
                          agreed
without the two files     the engine's own 8x8 font in a 16x14 cell, and the
                          dither table LSL1's copy holds. Both are what a game
                          that shipped without them gets, and the font is the
                          more visible of the two by far
```

Each names what would close it: the object overlay, a line in the text path, a
fact that may not be recorded anywhere, and nothing at all. **The mode can be
improved further**, and none of it needs the engine rearranged — a better table
is a better table behind the same seam. [plan.md](plan.md) records what each
attempt was and why it was replaced, including the two tables that were guessed
before anyone opened `AGIDATA.OVL`.

## The sound chip (M9)

The engine plays all four channels of every SOUND resource, which is what a PCjr
or a Tandy does. Until M9 it said "PC speaker" while doing so; now the shell
offers the choice and the two agree either way.

A PC speaker is **one voice, not a quieter four**: it plays tone channel 0, and
the other two tone channels and the noise channel are not played at all. In the
bundled game that is about half of the notes -- 1864 on channel 0 against 1974
on the rest -- and in the eight sounds of twenty-eight where channel 0 is not
the longest channel, the piece now ends when that one voice runs out. It also
has **no volume**: attenuation shapes channel 0 through fourteen of its sixteen
steps and a speaker can only be on or off, so everything below silence plays at
one level. Attenuation 15 stays a rest.

Nothing in the game branches on the choice. Variable 22, which names the sound
hardware, is not read in any condition in any of the forty-six scripts, so this
changes what is heard and nothing else -- which is what separates it from the
graphics choice, where the game branches in twenty-seven places. The variable is
still written to match the choice, because the next game may ask.

Two rules carry over from M7 and are what the milestone was really about. The
choice applies to a sound *already playing*, through the same hand-over that
gives a late audio context a running sound at its offset -- one operation, used
by both, so the rule below is enforced in one place. And **timing does not
change**: a sound switched from four voices to one ends at the same moment and
releases the waiting script at the same moment, exactly as turning the volume
down does. `SoundPlayer` keeps owning the clock; `SoundOutput` decides only what
is audible.

The default is the PCjr rather than the speaker. The two have to be made to
agree and agreeing downwards would take away half the notes of a game most
people remember with them, so the speaker is a choice made on purpose. That is a
decision rather than a detail, which is why it is written down.

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
              loadedPictures, lastLine, the input line's cursor
MenuBar       whether the menu is offered, and which items are greyed out
scenery       the cels a script painted into the picture with add.to.pic
scan starts   the per-logic re-entry points set by set.scan.start
```

The last of these is the one that is easy to miss. `set.scan.start` moves where a
script resumes next cycle, and it lives on the compiled logic beside the decoded
instructions, which makes it look like a property of the resource. It is not: a
game restored without it puts every mid-wait script back at the top of its
question. The original interpreter saves these too.

Nothing derived is saved. Decoded views, the drawn background, the saved sprite
areas and the text layer are all rebuilt from what produced them. Saving them
would double the format and give it a second way to be wrong.

The background is the exception that shows the rule: a snapshot holds the
picture's *number*, and a picture is a file, so anything a script painted into
it with `add.to.pic` would be lost. The engine therefore keeps the list of cels
that were added and replays them — which is what brings the customers back with
the bar.

A snapshot is a JSON-serialisable value carrying a format version and a
fingerprint of the game it came from (the resource counts and item count that
`summariseGame` already computes). A snapshot from another game or an older
format version is refused with a message, not applied.

### Restoring

`restore.game` replaces the state from inside a running cycle, so the rest of
that cycle must be abandoned the way `new.room` abandons it. The engine's
`Unwind` already carries a kind for exactly this; restore becomes another kind
rather than a second mechanism. The cycle then loads nothing: the snapshot
brought the room, the objects and the picture with it.

Two orderings inside the restore matter, and both were found by testing rather
than by reading. The sound is stopped *before* the state is read, because
stopping a sound sets the flag its script was waiting on and a flag set
afterwards is the discarded game writing into the restored one. And a view table
slot that had no view when the game was saved is emptied rather than left alone:
releasing a slot does not clear it, so a save taken before an object existed
would otherwise leave that object on screen.

Saves live in named slots in the browser's own storage, keyed by the game
fingerprint, and can be exported to and imported from a file so they survive the
browser clearing site data. Storage fails at the moment a player is trying not to
lose progress, so a failure is reported where the player is looking — on the save
screen itself — and never swallowed.

The save and restore dialogs are the same suspend-the-cycle `Interaction` the
inventory screen and text windows use, and the game's own menus and key bindings
already offer Save and Restore — the previously stubbed commands simply start
doing something.

## Rendering to canvas

A single `<canvas>`, scaled up by whole-number factors with smoothing disabled
so the pixels stay sharp. Its backing size is the running driver's own -- EGA's
320x200 today, and 720x348 when Hercules arrives -- re-made when the driver
changes, and the aspect it is presented at follows the driver too. EGA asks for
square pixels, because the doubling that turns the 160-wide picture into 320 is
already the correction. The engine composes into an offscreen
`ImageData` buffer and blits once per frame; it never draws primitives with the
canvas 2D API.

Rendering is decoupled from the cycle: the engine marks the frame dirty, and the
next animation frame paints it. A cycle that changes nothing costs no drawing.

The canvas is letterboxed to preserve aspect ratio, and the scale factor follows
the window size.

## Application shell

Deliberately thin: a page holding the canvas, a title, an error surface, and a
row of controls for the things the player chooses rather than the game.

Three controls, and every one of them does something:

```text
Graphics    EGA / CGA / Hercules      a driver each, and the scripts told
                                      which; all three draw in their own
                                      colours, at their own size
Sound chip  PC speaker / PCjr         wired: one voice, or four
Sound on    on / off                  wired: the game's own sound flag
```

The graphics choice is two things at once — what the game is drawn in, and what
the game is *told* it is being drawn on — and both halves are real for all three
modes. A game told it is on a mono screen lays its opening out for one and gets
its command line in a box; one told it is on CGA is offered a graphics-mode
toggle.

The two sound controls are wired. The chip switch changes what is played and
what the scripts are told they are being played on, through one entry point so
the two cannot be changed apart. The on/off switch sets the same flag the game's
own F2 and Options menu set, and its label follows the flag rather than
remembering what was last pressed, because the game changes it too.

Settings are remembered separately from saved games and under a different rule:
a save that cannot be written stops the player and says so, while a setting that
cannot be written is quietly lost. One is a preference; the other is somebody's
evening.

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

Each milestone ends with something observable, not just code. M0-M15 are done.
The numbering is the one [plan.md](plan.md)
works to, and that document records what each one turned out to need --
including where it contradicted what was written here first.

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

M9  The sound chip switch
    The shell's PC speaker / PCjr choice made real: one voice or four.
    Ends with: switching mid-theme changes the voices and nothing else.

M10 The display driver seam
    One driver per adapter, and the engine drawing through it. EGA first.
    Ends with: nothing changes on screen, and the golden tests say so.

M11 What the scripts are drawn on
    configure.screen for real, and the monitor and computer variables.
    Ends with: the game lays itself out for the machine it is told it is on
    -- a CGA menu item, a Tandy's volume keys, a mono opening -- while still
    drawn in EGA colours. The PCjr mode came out: see The graphics modes.

M12 CGA
    Four colours, and sixteen reached by dithering pairs of pixels.
    Ends with: every picture renders in CGA in the four colours it has, the
    dither reads as a checkerboard, text stays solid and legible, and EGA is
    untouched.

M13 Hercules
    720x348, two colours, an 18x12 cell, and the command line in a box.
    Ends with: the canvas follows the driver, all sixteen colours stay
    distinguishable as greys, and the game is legible on it. HGC_FONT is not
    bundled, so the shapes are the IBM font's. The dither it derived to keep
    those sixteen apart is what M15 replaced with the interpreter's.

M14 The shell the player sees
    The page around the engine: the player's surface separated from the
    developer's, and no shell key shadowing one the game has bound.
    Ends with: someone who has never opened the repository can play, save
    and change the display without seeing a cycle count.

M15 The dither the original shipped
    The Hercules table stops being guessed at. Two attempts to derive and
    then to measure it came first; the answer was 128 bytes of AGIDATA.OVL
    all along, indexed by HGC_GRAF.OVL, and the captures are the check
    rather than the source.
    Ends with: every one of the sixteen colours dithered as the interpreter
    dithered it, the table read from the bundled file and pinned to it by a
    test, and the captures' brightness a straight line in its densities at
    R2 = 0.95.
```

```text
M0  complete    M4  complete    M8  complete     M12 complete
M1  complete    M5  complete    M9  complete     M13 complete
                                                 M14 complete
M2  complete    M6  complete    M10 complete     M15 complete
M3  complete    M7  complete    M11 complete
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
- ~~Whether the debug overlay ships in the production build or is stripped.~~
  Answered: it ships behind the developer panel rather than on the player's
  surface.
