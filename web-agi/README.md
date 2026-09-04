# web-agi

A Sierra AGI game engine that runs in the browser. It reads an original AGI v2
game's own resource files and interprets its scripts — no transpilation, no
reimplementation of the game itself.

The engine is complete enough to play the bundled game's opening: rooms load and
draw, ego walks and is occluded and blocked by the scenery, text windows and the
status line appear, the menus work, inventory opens, and typed commands reach the
scripts' `said` tests.

Rendering is headless by design. The engine composes into a plain byte buffer,
and only the final blit needs a canvas — so everything it draws can be asserted
in a test without a browser.

## Requirements

- Node.js 22 or newer. The tests run TypeScript directly through `node --test`,
  which needs Node's own type stripping.
- A copy of an AGI v2 game. **None is included** — the resource files are
  copyrighted, and `web-agi/public/game/` is deliberately git-ignored.

## Where the game files go

Two directories, and it is worth being clear about which is which:

```text
agi-extract/data/       <- you put the game here (the source; any layout)
web-agi/public/game/    <- game:sync writes here (the served copy; generated)
```

Both paths are relative to the repository root, and both are git-ignored.

**The source.** Drop your copy of the game into `agi-extract/data/` — the whole
DOS directory is fine, extra files and subdirectories are ignored. That is the
directory `game:sync` reads when given no argument, and keeping the game there
means the sibling `agi-extract` CLI can be pointed at the same copy
(`--input agi-extract/data`) rather than a second one. Any other directory works
if you pass it to the sync script.

File names are matched case-insensitively, so an uppercase, lowercase or
mixed-case dump all work. These must be present:

```text
LOGDIR  PICDIR  VIEWDIR  SNDDIR    the four resource directory files
VOL.0  VOL.1  …                    at least one volume; all are found and copied
OBJECT                             inventory items and their starting rooms
WORDS.TOK                          the vocabulary
```

The DOS executables and the CGA/Hercules overlays (`AGI`, `LL.COM`,
`*_GRAF.OVL`, …) are not needed and are not copied. If anything on the list is
missing, the sync script says which before copying anything.

**The served copy.** `web-agi/public/game/` is generated — never edit or commit
it. Vite serves it at `/game/`, and the browser has no directory listing, so the
script also writes a `manifest.json` there naming every file and its size. That
manifest is how the app discovers which volumes exist; without it the engine
cannot start. The copies are written with canonical uppercase names.

## Getting it running

```sh
npm install                          # from the repository root
```

Then, from `web-agi/`:

```sh
npm run game:sync                    # from ../agi-extract/data
npm run game:sync -- /path/to/game   # or from anywhere else
```

or from the repository root:

```sh
npm run game:sync --workspace web-agi -- /path/to/game
```

It reports what it copied:

```text
Copied 9 file(s) (448 KiB) from /…/agi-extract/data
  LOGDIR     177
  PICDIR     138
  …
```

Then:

```sh
npm run dev                          # http://localhost:5173
```

The sync only has to be re-run when the game files change. **`npm test` needs it
too** — the tests read the game straight from `public/game/` rather than over
HTTP, so they fail on a fresh clone until it has been run once.

## Scripts

```text
npm run dev          Vite dev server with hot reload
npm run build        typecheck, then a production bundle in dist/
npm run preview      serve the production bundle
npm run typecheck    tsc --noEmit
npm test             the whole suite, headless
npm run game:sync    copy game files into public/game/ and write the manifest
```

## Playing

```text
arrow keys       walk ego
letters, ENTER   type a command at the prompt
```

Everything else is the game's own. AGI scripts bind keys to controllers
themselves, so the engine only translates a keypress into the scan code the DOS
original would have reported and lets the script decide: in the bundled game that
makes `ESC` open the menu, `TAB` the inventory, `Ctrl-B` the boss key and `Alt-Z`
quit, as its menus advertise. Ctrl and Alt combinations are therefore passed
through rather than filtered; only the platform's command key is left to the
browser.

The order a key is offered in is the whole of AGI's input model: whatever the
game is waiting for takes it first, then keys a script has bound to a controller,
then the menu, then the command line — which claims anything printable — and only
what is left reaches ego's feet. That is why the arrow keys walk while the
letters type.

## The developer panel

Behind one collapsed panel in the header, because every letter goes to the
game's command line and every function key worth having is one the game has
already bound. `F7` used to be the priority screen *and* the game's Restore,
and one press did both.

```text
Priority screen      swap the visual screen for the priority screen
State dump           dump the engine's state into the panel
Disassemble room     disassemble the current room's script
```

Each is a button, and a shortcut while the panel is open: `Alt+Shift+P`,
`Alt+Shift+S`, `Alt+Shift+D`. Every shell shortcut is checked against the keys
the loaded game's scripts have claimed, and refused if the game wants it -- so
the rule holds for the next game too. The panel opens *over* the game rather
than below it: opening a debugger should not resize the thing being debugged.

The priority screen is the one that earns its keep. Occlusion and blocking are decided by pixels
nobody can see, so being able to look at them is the difference between
diagnosing a bug and guessing at it.

The state dump reports the room and cycle counters, what the game is waiting on,
every object in the view table, the variables and flags the game has actually put
something in, and any commands it reached that the engine cannot yet do.

The disassembly prints the room's bytecode as readable text with its messages
inline.
Reserved variables and flags are where an interpreter runs without error and
still does the wrong thing, and no state dump says what a script was *trying* to
do — only reading it does.

## How it fits together

```text
src/
  main.ts         wiring: load, build the machine, drive the frame loop
  shell/          the DOM around the canvas
    shell.ts        the layout, the palettes, status line, error surface
    canvas.ts       canvas element, and how big it is drawn
    controls.ts     the player's settings, apart from the game's own
    settings.ts     what the player chose, and how it is remembered
    debug.ts        the developer panel's tools and what they print
  resources/      getting bytes and turning them into resources
    source.ts       where bytes come from; BundledSource fetches them
    directory.ts    the four DIR files -> resource location tables
    manager.ts      VOL cache, header validation, payload slicing
    objects.ts      OBJECT: inventory items and their starting rooms
    words.ts        WORDS.TOK: the vocabulary and its word numbers
    crypt.ts        AGI's cyclic-XOR obfuscation
    errors.ts       stable error codes, shared with agi-extract
    summary.ts      what the app reports about the game it loaded
  logic/          LOGIC resources
    resource.ts     header split: bytecode vs message section
    messages.ts     message decryption and the offset table
    opcodes.ts      the instruction set, per interpreter version
    reader.ts       bytecode -> instructions
    disasm.ts       instructions -> readable text
  engine/         the interpreter and the game world
    machine.ts      dispatch, the call stack, waiting, unwinding
    state.ts        256 vars, 256 flags, 12 strings, reserved names
    cycle.ts        the fixed-timestep loop
    room.ts         the new.room sequence
    viewtable.ts    the object table; entry 0 is ego
    motion.ts       direction, step size, edges, control lines, blocking
    animate.ts      erase and redraw, in two passes
    interaction.ts  the things a script can wait on
    message.ts      building the windows text commands ask for
    menu.ts         the menu bar the game defines, and its key bindings
    inventory.ts    where the game's objects are now
    present.ts      composing a frame, in AGI's layer order
    commands/       the command table: core, graphics, objects, text, items
  render/         pixels, with no DOM
    screens.ts      the 160x168 visual and priority buffers
    display.ts      the 320x200 framebuffer and the EGA palette
    renderer.ts     screens -> display
    sprite.ts       drawing a cel: transparency and the priority test
    font.ts         the embedded 8x8 font
    text.ts         character cells, windows, word wrap
  input/
    keyboard.ts     key events -> engine keys, and the key state
    prompt.ts       the command line editor
    parser.ts       typed text -> word numbers
test/             mirrors src/, plus helpers/disk-source.ts
scripts/          build-manifest.mjs
```

Waiting is the design decision worth knowing about before reading the engine.
A command that needs the player — a message to dismiss, a question to answer —
returns the thing being waited on; `Machine.run` is a generator that yields it,
and the cycle parks. When the player acts the generator resumes at the *next*
instruction, exactly as if the command had blocked. Nothing ever blocks a frame.

## Reuse from agi-extract

The sibling package already implements, and has tests for, the format work this
engine would otherwise duplicate. It is a workspace dependency:

```text
agi-extract/pic        PICTURE vector interpreter -> visual + priority screens,
                       the EGA palette
agi-extract/view       VIEW decoder: cels, loops, mirroring, transparency
agi-extract/directory  3-byte DIR entry parsing
agi-extract/volume     VOL header validation (parseVolHeader)
agi-extract/errors     the stable error codes, so both projects name the same
                       failures the same way
```

Those five modules are free of Node built-ins so they can be bundled for a
browser; everything in `agi-extract` that touches the filesystem lives in
modules this package does not import.

## Tests

```sh
npm test
```

Three layers, in the order they catch things:

```text
format tests   the decoders against the real game files: every LOGIC decodes,
               every VIEW decodes, WORDS.TOK accounts for every byte
unit tests     opcode decoding, message decryption, parser matching, blocking
               rules, reserved variable semantics
golden tests   load the game, run a fixed number of cycles, hash the visual
               screen and compare
```

The tests read the game from `public/game/` through `test/helpers/disk-source.ts`,
so `npm run game:sync` has to have been run first.

The opcode table is the one piece of pure data that cannot be verified in
advance, so it is checked rather than trusted: `logic.test.ts` walks every LOGIC
resource in the game and requires each decode to land exactly on its message
section with every jump on an instruction boundary. A wrong argument count
desynchronises the walk and cannot survive that.

## Not supported

No sound, no save/restore, no player-supplied game files, no AGI v3, no touch
controls. All are specified as later phases in [spec.md](spec.md), and the design
makes room for them: sound commands already set the flags scripts wait on, and
interpreter state is data rather than closures so it can be serialised.

## Further reading

- [spec.md](spec.md) — what the engine is and how each part is meant to behave
- [plan.md](plan.md) — the implementation plan as it stood before the work, kept
  for the format measurements and the reasoning behind the sequencing
- [../agi-extract/README.md](../agi-extract/README.md) — the resource decoders
