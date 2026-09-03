# Sierra online AGI interpreter

Two tools for Sierra's AGI adventure games, in one npm workspace: a resource
extractor that runs on the command line, and a game engine that runs in a
browser.

```text
agi-extract/   extract raw AGI resources, and render graphics to PNG
web-agi/       a Sierra AGI game engine for the browser
```

They share a boundary rather than a codebase. `agi-extract` owns the file
formats — the directory entries, the VOL headers, the PICTURE vector interpreter,
the VIEW decoder — and `web-agi` imports those decoders instead of reimplementing
them. The modules `web-agi` needs are kept free of Node built-ins so they bundle
for a browser; everything that touches the filesystem lives in modules it does
not import.

Both target the **AGI v2** layout: separate `LOGDIR` / `PICDIR` / `VIEWDIR` /
`SNDDIR` directory files plus numbered `VOL.n` volumes. AGI v3 and SCI are out of
scope.

## Getting started

```sh
npm install     # installs both workspaces
npm test        # 365 tests across both
npm run build   # typecheck and bundle web-agi
npm run dev     # serve web-agi at http://localhost:5173
```

Requires Node.js 22 or newer for `web-agi` (its tests run TypeScript directly
through `node --test`). `agi-extract` alone needs only Node 18.

## Game files are not included

Neither package ships a game. The resource files are copyrighted, so
`web-agi/public/game/` and any `data/` or `out/` directory are git-ignored.

Bring your own copy of an AGI v2 game and put it in **`agi-extract/data/`** —
the whole DOS directory is fine. One copy there serves both tools:

```sh
# extract from it
node agi-extract/bin/agi-extract.js all --input agi-extract/data --output ./out

# copy the nine files web-agi reads into web-agi/public/game/, then run it
npm run game:sync --workspace web-agi
npm run dev
```

`agi-extract/data/` is where `game:sync` looks when given no argument; the
extractor has no such default and reads the current directory unless told
otherwise. Both take any other directory instead — `--input <dir>` for the
extractor, `npm run game:sync --workspace web-agi -- <dir>` for the engine.

`web-agi`'s tests read the game from `web-agi/public/game/` rather than over
HTTP, so `game:sync` has to have been run before `npm test` will pass in that
workspace. See [web-agi/README.md](web-agi/README.md#where-the-game-files-go) for
which files are required and what the generated copy contains.

## agi-extract

A CLI that locates resources through the directory files and copies the payload
bytes out of the VOL files, exactly as stored. With `--png` it also renders the
graphics: PICTURE resources by replaying their vector drawing commands, VIEW
resources by decoding their sprite frames — one PNG per cel plus an animated PNG
per loop. LOGIC and SOUND payloads are never decoded.

```sh
agi-extract list view --input ./lsl1
agi-extract all --png --png-scale 2 --input ./lsl1 --output ./out
```

Full documentation: [agi-extract/README.md](agi-extract/README.md).

## web-agi

A browser engine that reads an original game's own resources and interprets its
scripts. Rooms load and draw, ego walks and is occluded and blocked by scenery,
text windows and menus work, and typed commands reach the scripts' `said` tests.
Rendering is headless — the engine composes into a byte buffer, and only the
final blit needs a canvas — so the whole engine is testable without a browser.

Full documentation: [web-agi/README.md](web-agi/README.md).

## Repository scripts

```text
npm test         both workspaces
npm run build    web-agi: typecheck, then bundle
npm run dev      web-agi: Vite dev server
```

Per-workspace scripts are listed in each package's README.

## Licence

MIT, for the tools. Game data is not covered and is not distributed here.
