/**
 * Where the game's bytes come from.
 *
 * Everything above this line is unaware of whether the files were bundled with
 * the app, picked by the player, or unpacked from an archive.
 */
import { ResourceError, ERROR_CODES } from './errors.ts';

export interface ResourceSource {
  /** Case-insensitive, like the DOS originals. Null when the file is absent. */
  read(name: string): Promise<Uint8Array | null>;

  /** Every file this source can serve, in canonical upper case. */
  list(): readonly string[];
}

export interface ManifestEntry {
  name: string;
  bytes: number;
}

export interface GameManifest {
  /** The directory the game is served from, and how a choice is remembered. */
  id?: string;
  /** What to call it on the picker. */
  title?: string;
  /** Which AGI shipped with it, from the version line in AGIDATA.OVL. */
  interpreter?: string;
  source: string;
  generated: string;
  files: ManifestEntry[];
}

/** One game on the picker, as `games/index.json` lists it. */
export interface GameEntry {
  id: string;
  title: string;
  interpreter?: string;
  /** How much there is to load, for a picker that wants to say so. */
  bytes?: number;
}

/** Where the bundled games live, under the app's base URL. */
export const GAMES_BASE = 'games/';

/**
 * Which games this build was made with.
 *
 * The one thing fetched before the player has chosen anything, and small: a
 * couple of hundred bytes against the four megabytes a game costs. That is the
 * whole reason the picker is a separate file rather than a field in a manifest
 * -- choosing has to happen before the choice is loaded.
 */
export async function listGames(baseUrl = GAMES_BASE): Promise<GameEntry[]> {
  const url = `${baseUrl}index.json`;

  let response: Response;
  try {
    response = await fetch(url);
  } catch (cause) {
    throw new ResourceError(ERROR_CODES.MANIFEST_NOT_FOUND, `Cannot fetch ${url}`, { cause });
  }
  if (!response.ok) {
    throw new ResourceError(
      ERROR_CODES.MANIFEST_NOT_FOUND,
      `Cannot fetch ${url}: HTTP ${response.status}. Run npm run game:sync`,
    );
  }

  const index = (await response.json()) as { games?: GameEntry[] };
  const games = (index.games ?? []).filter((game) => typeof game.id === 'string');
  if (games.length === 0) {
    throw new ResourceError(ERROR_CODES.MANIFEST_NOT_FOUND, `${url} lists no games`);
  }

  return games;
}

/**
 * Reads the copy of the game bundled with the app.
 *
 * HTTP has no directory listing, so the set of files is read from a manifest
 * generated at build time rather than discovered.
 */
export class BundledSource implements ResourceSource {
  readonly manifest: GameManifest;

  #baseUrl: string;
  #names: Map<string, string>;
  #cache = new Map<string, Uint8Array>();

  private constructor(baseUrl: string, manifest: GameManifest) {
    this.#baseUrl = baseUrl;
    this.manifest = manifest;
    this.#names = new Map(manifest.files.map((f) => [f.name.toUpperCase(), f.name]));
  }

  /** The game this source is serving, from its own manifest. */
  get id(): string {
    return this.manifest.id ?? '';
  }

  /**
   * Open one of the bundled games by its id.
   *
   * @param id the directory name under `games/`, as `index.json` lists it
   */
  static async forGame(id: string): Promise<BundledSource> {
    return BundledSource.load(`${GAMES_BASE}${id}/`);
  }

  /**
   * @param baseUrl directory holding the game files and their manifest
   */
  static async load(baseUrl: string): Promise<BundledSource> {
    const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    const url = `${base}manifest.json`;

    let response: Response;
    try {
      response = await fetch(url);
    } catch (cause) {
      throw new ResourceError(ERROR_CODES.MANIFEST_NOT_FOUND, `Cannot fetch ${url}`, { cause });
    }
    if (!response.ok) {
      throw new ResourceError(
        ERROR_CODES.MANIFEST_NOT_FOUND,
        `Cannot fetch ${url}: HTTP ${response.status}`,
      );
    }

    const manifest = (await response.json()) as GameManifest;
    if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
      throw new ResourceError(ERROR_CODES.MANIFEST_NOT_FOUND, `${url} lists no files`);
    }

    return new BundledSource(base, manifest);
  }

  list(): readonly string[] {
    return [...this.#names.keys()];
  }

  async read(name: string): Promise<Uint8Array | null> {
    const key = name.toUpperCase();
    const cached = this.#cache.get(key);
    if (cached) return cached;

    const actual = this.#names.get(key);
    if (!actual) return null;

    const url = `${this.#baseUrl}${actual}`;
    const response = await fetch(url);
    if (!response.ok) {
      // The manifest promised this file, so its absence is a broken build
      // rather than a missing optional resource.
      throw new ResourceError(
        ERROR_CODES.FILE_NOT_FOUND,
        `${actual} is in the manifest but ${url} returned HTTP ${response.status}`,
      );
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    this.#cache.set(key, bytes);
    return bytes;
  }
}
