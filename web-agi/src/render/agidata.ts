/**
 * Finding the interpreter's dither tables in `AGIDATA.OVL`.
 *
 * M15 and M16 read four tables out of that file at four fixed offsets, and
 * both said "this is where they are" when what they meant was "this is where
 * they are in Leisure Suit Larry's copy". King's Quest I settled the difference:
 * its `AGIDATA.OVL` is AGI 2.917 rather than 2.440, and everything sits 436
 * bytes higher.
 *
 * What is at 0x1bea in that game is the ASCII text `store in\n\n%s\n\nPr` -- a
 * printf format string. Read as sixteen groups of eight it has densities
 * `[33, 22, 28, 30, ...]` ending in zero, so black comes out a mid grey and
 * white comes out black, and the picture is noise with its ends swapped.
 * Nothing anywhere says so: the CGA decoder's own consistency check caught its
 * three tables reading garbage, and the Hercules one had no check to fail.
 *
 * ## The block, and how it is found
 *
 * The four tables are one run of 242 bytes, and in the two copies here that run
 * is *byte for byte identical* -- the tables belong to the interpreter and did
 * not change between 2.440 and 2.917. Only its address moved.
 *
 * ```text
 * +0     16 x 3   the CGA fill patterns
 * +48    16       the CGA two-colour picture table
 * +64    16       the CGA four-colour picture table
 * +80    34       a scratch copy the blit makes at init, and 18 bytes besides
 * +114   128      the Hercules dither table
 * ```
 *
 * The anchor is the two-colour table, and the argument for it is M16's: its
 * sixteen low nibbles are a *permutation* of the sixteen values, which only a
 * one-bit dither is shaped like, and the fill table's first column repeats it
 * entry for entry 48 bytes earlier, which two unrelated runs of bytes have no
 * reason to do. Together they pick exactly one site in each of the two files.
 *
 * The Hercules table cannot anchor itself. It begins with eight zero bytes and
 * ends with eight 0xff ones, and the bytes on either side of it are zeros and
 * 0xffs too, so its own shape matches at four consecutive offsets and a run of
 * zeros elsewhere in the file matches as well. It is found by its distance from
 * the anchor and then checked, which is the honest way round: an anchor that
 * cannot be ambiguous, and a table that can only be confirmed.
 */
import {
  CGA_FILL_STRIDE,
  CGA_TABLE_ENTRIES,
  CGA_TABLES,
  CgaTableError,
  decodeCgaTables,
  type CgaTables,
  type CgaTableSites,
} from './cgatables.ts';
import {
  decodeHgcDither,
  ditherDensity,
  HGC_CELL_HEIGHT,
  HGC_DITHER,
  HGC_DITHER_BYTES,
  HGC_LEVELS,
  type HgcDither,
} from './hgcdither.ts';

/** Where each table sits, measured from the fill table that starts the block. */
export const BLOCK_LAYOUT = {
  fill: 0,
  mono: 48,
  colour: 64,
  hercules: 114,
} as const;

/** The whole run, from the first fill byte to the last Hercules one. */
export const BLOCK_BYTES = BLOCK_LAYOUT.hercules + HGC_DITHER_BYTES;

/** Where the four tables were found, as file offsets. */
export interface TableSites extends CgaTableSites {
  readonly hercules: number;
}

/** Everything the two dithering drivers read out of `AGIDATA.OVL`. */
export interface InterpreterTables {
  readonly cga: CgaTables;
  readonly hercules: HgcDither;
  /** Where they came from, or `null` for the tables bundled with the engine. */
  readonly sites: TableSites | null;
  /** Why the file's own tables were not used, when they were not. */
  readonly why?: string;
}

/**
 * Find the block, by the anchor M16 proved its reading with.
 *
 * @param bytes the whole of `AGIDATA.OVL`
 * @returns where the four tables are, or null if the file has no such block
 */
export function findTables(bytes: Uint8Array): TableSites | null {
  const nibbles = (at: number) =>
    [...bytes.subarray(at, at + CGA_TABLE_ENTRIES)].map((byte) => byte & 0x0f);

  for (let mono = BLOCK_LAYOUT.mono; mono + BLOCK_BYTES - BLOCK_LAYOUT.mono <= bytes.length; mono++) {
    const drawing = nibbles(mono);
    if (!isPermutation(drawing)) continue;

    // The tie: the fill table's first column is the same table, 48 bytes back.
    const fill = mono - BLOCK_LAYOUT.mono;
    let agrees = true;
    for (let entry = 0; entry < CGA_TABLE_ENTRIES && agrees; entry++) {
      agrees = (bytes[fill + entry * CGA_FILL_STRIDE]! & 0x0f) === drawing[entry];
    }
    if (!agrees) continue;

    const sites: TableSites = {
      fill,
      mono,
      colour: mono + (BLOCK_LAYOUT.colour - BLOCK_LAYOUT.mono),
      hercules: mono + (BLOCK_LAYOUT.hercules - BLOCK_LAYOUT.mono),
    };
    if (looksLikeHgcDither(bytes, sites.hercules)) return sites;
  }

  return null;
}

/**
 * The tables this copy of the interpreter holds, or the bundled ones.
 *
 * Never throws: a file this cannot read is a file the engine draws without,
 * which is the rule every interpreter file here follows. What it does instead
 * is say why, so the shell can report a fallback rather than a game quietly
 * getting another game's dither.
 *
 * @param bytes the whole of `AGIDATA.OVL`, or undefined if it is not there
 */
export function readInterpreterTables(bytes?: Uint8Array): InterpreterTables {
  const bundled = (why: string): InterpreterTables => ({
    cga: CGA_TABLES,
    hercules: HGC_DITHER,
    sites: null,
    why,
  });

  if (!bytes) return bundled('AGIDATA.OVL is not bundled with this game');

  const sites = findTables(bytes);
  if (!sites) return bundled('AGIDATA.OVL holds no table block this engine recognises');

  try {
    return {
      cga: decodeCgaTables(bytes, sites),
      hercules: decodeHgcDither(bytes, sites.hercules),
      sites,
    };
  } catch (cause) {
    // The block was found and then would not decode, which is a file this
    // engine has misread rather than one it cannot read. Worth saying so.
    return bundled(cause instanceof CgaTableError ? cause.message : String(cause));
  }
}

/** Sixteen values, each exactly once. */
function isPermutation(values: readonly number[]): boolean {
  const seen = new Set(values);
  return seen.size === CGA_TABLE_ENTRIES && values.every((v) => v >= 0 && v < CGA_TABLE_ENTRIES);
}

/**
 * Whether 128 bytes read as a dither table rather than as something else.
 *
 * Three things a table of sixteen patterns must be and a printf string is not:
 * black draws nothing, white draws everything, and the sixteen densities are
 * not all the same handful. The string that started this milestone fails the
 * first two on its own.
 */
function looksLikeHgcDither(bytes: Uint8Array, at: number): boolean {
  if (at + HGC_DITHER_BYTES > bytes.length) return false;

  const table: number[][] = [];
  for (let colour = 0; colour < CGA_TABLE_ENTRIES; colour++) {
    const from = at + colour * HGC_CELL_HEIGHT;
    table.push([...bytes.subarray(from, from + HGC_CELL_HEIGHT)]);
  }

  if (ditherDensity(table, 0) !== 0) return false;
  if (ditherDensity(table, 15) !== HGC_LEVELS) return false;

  const densities = new Set<number>();
  for (let colour = 0; colour < CGA_TABLE_ENTRIES; colour++) {
    densities.add(ditherDensity(table, colour));
  }
  return densities.size >= 6;
}
