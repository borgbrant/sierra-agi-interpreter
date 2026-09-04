#!/usr/bin/env node
/**
 * Copy the game resource files the engine reads into `public/game/`, and write
 * the manifest that tells the app what is there.
 *
 * HTTP offers no directory listing, so a served build cannot discover which
 * VOL files exist. The manifest is that listing, generated at build time.
 *
 * Usage: node scripts/build-manifest.mjs [sourceDir]
 */
import { copyFile, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..');
const DEFAULT_SOURCE = resolve(REPO_ROOT, 'agi-extract', 'data');
const TARGET = resolve(here, '..', 'public', 'game');

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

async function main() {
  const source = resolve(process.argv[2] ?? DEFAULT_SOURCE);
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

  await mkdir(TARGET, { recursive: true });

  const files = [];
  for (const name of wanted) {
    const from = join(source, available.get(name));
    const to = join(TARGET, name); // canonical upper case in the served copy
    await copyFile(from, to);
    files.push({ name, bytes: (await stat(to)).size });
  }

  // Recorded relative to the repository, never as an absolute path: the
  // manifest is served to the browser, and where the files came from on the
  // machine that built them is nobody else's business.
  const manifest = {
    source: relative(REPO_ROOT, source) || '.',
    generated: new Date().toISOString(),
    files,
  };
  await writeFile(join(TARGET, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const total = files.reduce((sum, f) => sum + f.bytes, 0);
  console.log(`Copied ${files.length} file(s) (${(total / 1024).toFixed(0)} KiB) from ${source}`);
  for (const f of files) console.log(`  ${f.name.padEnd(10)} ${f.bytes}`);

  for (const name of INTERPRETER_FILES.filter((n) => !available.has(n))) {
    console.log(`  ${name.padEnd(10)} not in this copy of the game; the engine has a fallback`);
  }
}

try {
  await main();
} catch (err) {
  console.error(`build-manifest: ${err.message}`);
  process.exitCode = 1;
}
