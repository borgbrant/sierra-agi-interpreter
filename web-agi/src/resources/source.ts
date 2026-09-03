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
  source: string;
  generated: string;
  files: ManifestEntry[];
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

  /**
   * @param baseUrl directory holding the game files and their manifest
   */
  static async load(baseUrl = 'game/'): Promise<BundledSource> {
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
