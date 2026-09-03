import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ResourceSource } from '../../src/resources/source.ts';

export const GAME_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'public',
  'game',
);

/**
 * Reads the bundled game from disk.
 *
 * Exists so the engine can be tested without a server. That it drops in for
 * BundledSource is the point of having the ResourceSource interface.
 */
export class DiskSource implements ResourceSource {
  #names: Map<string, string>;
  #dir: string;

  private constructor(dir: string, names: Map<string, string>) {
    this.#dir = dir;
    this.#names = names;
  }

  static async open(dir = GAME_DIR): Promise<DiskSource> {
    const entries = await readdir(dir, { withFileTypes: true });
    const names = new Map<string, string>();
    for (const entry of entries) {
      if (entry.isFile()) names.set(entry.name.toUpperCase(), entry.name);
    }
    return new DiskSource(dir, names);
  }

  list(): readonly string[] {
    return [...this.#names.keys()];
  }

  async read(name: string): Promise<Uint8Array | null> {
    const actual = this.#names.get(name.toUpperCase());
    if (!actual) return null;
    return new Uint8Array(await readFile(join(this.#dir, actual)));
  }
}

/** An in-memory source, for tests that need a game that does not exist. */
export class MemorySource implements ResourceSource {
  #files: Map<string, Uint8Array>;

  constructor(files: Record<string, Uint8Array>) {
    this.#files = new Map(Object.entries(files).map(([k, v]) => [k.toUpperCase(), v]));
  }

  list(): readonly string[] {
    return [...this.#files.keys()];
  }

  async read(name: string): Promise<Uint8Array | null> {
    return this.#files.get(name.toUpperCase()) ?? null;
  }
}
