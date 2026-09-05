#!/usr/bin/env node
/**
 * Copy the game resource files the engine reads into `public/games/<id>/`, and
 * write the manifests that tell the app what is there.
 *
 * HTTP offers no directory listing, so a served build cannot discover which VOL
 * files exist, or which games. Two manifests answer that: one per game listing
 * its files, and `games/index.json` listing the games -- which is what the
 * shell's picker is drawn from, and the only thing it fetches before the player
 * has chosen.
 *
 * Usage: node scripts/build-manifest.mjs [sourceDir...] [--title=...]
 *
 * `agi-extract/data` holds one directory per game, and its name is the game's
 * id in the served copy. Several may be named at once; one that is not there is
 * reported and skipped, because which games a machine has is that machine's
 * business.
 */
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..');
const DATA = resolve(REPO_ROOT, 'agi-extract', 'data');
const DEFAULT_SOURCES = [resolve(DATA, 'lsl1'), resolve(DATA, 'kq1')];
const GAMES = resolve(here, '..', 'public', 'games');

/**
 * What to call each game on the picker, by the directory it came from.
 *
 * A courtesy rather than a fact the files hold: AGI's own `set.game.id` gives
 * a script an identifier like `LLLLL`, not a title anyone would recognise, and
 * nothing in the resources spells the name out. `--title=` overrides this, and
 * a directory that is in neither is called by its own name.
 */
const TITLES = {
  lsl1: 'Leisure Suit Larry in the Land of the Lounge Lizards',
  kq1: "King's Quest I: Quest for the Crown",
};

/** The interpreter names itself in AGIDATA.OVL, in the line it prints. */
const VERSION_TEXT = /Version (\d\.\d{3}(?:\.\d+)?)/;

/** Resource directory files, all four required. */
const DIR_FILES = ['LOGDIR', 'PICDIR', 'VIEWDIR', 'SNDDIR'];

/** Other game data the engine reads. */
const DATA_FILES = ['OBJECT', 'WORDS.TOK'];

/**
 * Interpreter files the engine reads, copied when they are there.
 *
 * Not game resources: these belong to the AGI interpreter that shipped
 * alongside the game, and a copy of a game need not include them. So they are
 * optional -- a missing one costs a mode some fidelity, never the ability to
 * play -- which is the opposite of the rule for the files above.
 *
 * `HGC_FONT` is the Hercules driver's own font, 3072 bytes of it. The engine
 * draws its own CGA and EGA font when it is absent, and that reads as exactly
 * the wrong font, so it is worth copying wherever it exists.
 *
 * `AGIDATA.OVL` is interpreter data, and 128 bytes of it at offset 0x1bea are
 * the Hercules dither table that `HGC_GRAF.OVL` indexes -- the one thing about
 * that mode this project spent two milestones guessing at. Copied for those
 * bytes; nothing else in the file is read.
 */
const INTERPRETER_FILES = ['HGC_FONT', 'AGIDATA.OVL'];

/** Volume files are numbered, so they are discovered rather than listed. */
const VOLUME = /^VOL\.\d+$/;

/**
 * Index a directory case-insensitively. DOS-era files arrive in any case
 * depending on where the copy came from.
 *
 * @param {string} dir
 * @returns {Promise<Map<string, string>>} upper-cased name -> real name
 */
async function index(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`Source directory not found: ${dir}`);
    }
    throw err;
  }

  const found = new Map();
  for (const entry of entries) {
    if (entry.isFile()) found.set(entry.name.toUpperCase(), entry.name);
  }
  return found;
}

/**
 * Copy one game, and return its entry for the index.
 *
 * @param {string} source the game's directory
 * @param {string | undefined} title what to call it, if the caller knows
 */
async function bundle(source, title) {
  const id = basename(source).toLowerCase();
  const available = await index(source);

  const wanted = [
    ...DIR_FILES,
    ...[...available.keys()].filter((name) => VOLUME.test(name)).sort(
      (a, b) => Number(a.slice(4)) - Number(b.slice(4)),
    ),
    ...DATA_FILES,
    ...INTERPRETER_FILES.filter((name) => available.has(name)),
  ];

  const missing = wanted.filter((name) => !available.has(name));
  if (missing.length > 0) {
    throw new Error(`Missing required game files in ${source}: ${missing.join(', ')}`);
  }
  if (!wanted.some((name) => VOLUME.test(name))) {
    throw new Error(`No VOL.n files found in ${source}`);
  }

  const target = join(GAMES, id);
  await mkdir(target, { recursive: true });

  const files = [];
  for (const name of wanted) {
    const from = join(source, available.get(name));
    const to = join(target, name); // canonical upper case in the served copy
    await copyFile(from, to);
    files.push({ name, bytes: (await stat(to)).size });
  }

  // Which interpreter shipped with this game, from the file that says so. The
  // engine reads it again at run time -- see resources/interpreter.ts -- and
  // this copy is for the picker, so a player choosing between two games can
  // see they are not the same machine underneath.
  let interpreter;
  if (available.has('AGIDATA.OVL')) {
    const bytes = await readFile(join(target, 'AGIDATA.OVL'), 'latin1');
    interpreter = VERSION_TEXT.exec(bytes)?.[1];
  }

  const manifest = {
    id,
    title: title ?? TITLES[id] ?? id,
    interpreter,
    // Recorded relative to the repository, never as an absolute path: the
    // manifest is served to the browser, and where the files came from on the
    // machine that built them is nobody else's business.
    source: relative(REPO_ROOT, source) || '.',
    generated: new Date().toISOString(),
    files,
  };
  await writeFile(join(target, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const total = files.reduce((sum, f) => sum + f.bytes, 0);
  console.log(`${manifest.title}`);
  console.log(`  ${files.length} file(s), ${(total / 1024).toFixed(0)} KiB, from ${manifest.source}` +
    (interpreter ? `, AGI ${interpreter}` : ''));
  for (const name of INTERPRETER_FILES.filter((n) => !available.has(n))) {
    console.log(`  ${name} is not in this copy; the engine has a fallback`);
  }

  return { id: manifest.id, title: manifest.title, interpreter, bytes: total };
}

/**
 * Rewrite `games/index.json`, keeping games this run did not touch.
 *
 * Syncing one game must not un-bundle the other: the files of a game not named
 * on the command line are still sitting in `public/games`, and dropping it from
 * the index would hide a game that is there.
 *
 * @param {{id: string, title: string}[]} bundled
 */
async function writeIndex(bundled) {
  /** @type {{id: string}[]} */
  let existing = [];
  try {
    existing = JSON.parse(await readFile(join(GAMES, 'index.json'), 'utf8')).games ?? [];
  } catch {
    // No index yet, or one this cannot read: this run writes a fresh one.
  }

  const kept = [];
  for (const game of existing) {
    if (bundled.some((b) => b.id === game.id)) continue;
    // Only if its files are actually still there.
    try {
      await stat(join(GAMES, game.id, 'manifest.json'));
      kept.push(game);
    } catch {
      console.log(`  dropping ${game.id} from the index: its files are gone`);
    }
  }

  const games = [...kept, ...bundled].sort((a, b) => a.id.localeCompare(b.id));
  await writeFile(
    join(GAMES, 'index.json'),
    `${JSON.stringify({ generated: new Date().toISOString(), games }, null, 2)}\n`,
  );
  console.log(`\n${games.length} game(s) in games/index.json: ${games.map((g) => g.id).join(', ')}`);
}

async function main() {
  const args = process.argv.slice(2);
  const title = args.find((a) => a.startsWith('--title='))?.slice('--title='.length);
  const named = args.filter((a) => !a.startsWith('--'));
  const sources = named.length > 0 ? named.map((a) => resolve(a)) : DEFAULT_SOURCES;

  await mkdir(GAMES, { recursive: true });

  const bundled = [];
  for (const source of sources) {
    try {
      await stat(source);
    } catch {
      // Which games a machine has is that machine's business, so a directory
      // that is not there is a line of output rather than a failure -- unless
      // it is the only one asked for.
      console.log(`${source} is not here; skipping`);
      continue;
    }
    bundled.push(await bundle(source, sources.length === 1 ? title : undefined));
  }

  if (bundled.length === 0) {
    throw new Error(`No games to bundle. Looked in: ${sources.join(', ')}`);
  }

  await writeIndex(bundled);
}

try {
  await main();
} catch (err) {
  console.error(`build-manifest: ${err.message}`);
  process.exitCode = 1;
}
