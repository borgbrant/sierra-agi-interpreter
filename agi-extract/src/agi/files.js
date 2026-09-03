import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { AgiError, ERROR_CODES } from '../util/errors.js';

/** Canonical resource type names. */
export const RESOURCE_TYPES = Object.freeze(['logic', 'pic', 'view', 'sound']);

/** Canonical type -> AGI v2 directory file. */
export const DIR_FILE_BY_TYPE = Object.freeze({
  logic: 'LOGDIR',
  pic: 'PICDIR',
  view: 'VIEWDIR',
  sound: 'SNDDIR',
});

/** Canonical type -> output file extension. */
const EXTENSION_BY_TYPE = Object.freeze({
  logic: '.logic',
  pic: '.pic',
  view: '.view',
  sound: '.sound',
});

/**
 * Validate a resource type given on the command line.
 *
 * @param {string} type
 * @returns {string} the canonical type
 */
export function assertResourceType(type) {
  if (!RESOURCE_TYPES.includes(type)) {
    throw new AgiError(
      ERROR_CODES.UNKNOWN_RESOURCE_TYPE,
      `Unknown resource type "${type}". Expected one of: ${RESOURCE_TYPES.join(', ')}.`,
    );
  }
  return type;
}

/**
 * Validate a resource number given on the command line.
 *
 * @param {string} raw
 * @param {string} [type]
 * @returns {number}
 */
export function assertResourceId(raw, type) {
  if (!/^\d+$/.test(String(raw).trim())) {
    throw new AgiError(
      ERROR_CODES.INVALID_RESOURCE_ID,
      `Resource number must be a non-negative decimal integer, got "${raw}".`,
      { type },
    );
  }
  return Number(raw);
}

/**
 * An AGI game directory, indexed for case-insensitive lookups.
 *
 * Files from old DOS releases show up uppercase, lowercase or mixed case
 * depending on the filesystem and the source of the dump, so every lookup goes
 * through the index built here rather than hitting the filesystem by name.
 */
export class GameFiles {
  /** @param {string} dir @param {Map<string, string>} index */
  constructor(dir, index) {
    this.dir = dir;
    this.index = index;
  }

  /**
   * @param {string} inputDir
   * @returns {Promise<GameFiles>}
   */
  static async open(inputDir) {
    const dir = resolve(inputDir);

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') {
        throw new AgiError(ERROR_CODES.INPUT_DIR_NOT_FOUND, `Input directory not found: ${dir}`, {
          cause: err,
        });
      }
      if (err.code === 'ENOTDIR') {
        throw new AgiError(
          ERROR_CODES.INPUT_DIR_NOT_FOUND,
          `Input path is not a directory: ${dir}`,
          { cause: err },
        );
      }
      throw err;
    }

    const index = new Map();
    for (const entry of entries) {
      if (entry.isDirectory()) continue;
      index.set(entry.name.toUpperCase(), join(dir, entry.name));
    }

    return new GameFiles(dir, index);
  }

  /**
   * Case-insensitive lookup of a plain file name.
   *
   * @param {string} name
   * @returns {string | undefined} absolute path, if present
   */
  find(name) {
    return this.index.get(name.toUpperCase());
  }

  /**
   * @param {string} type canonical resource type
   * @returns {string} absolute path to the directory file
   */
  dirFilePath(type) {
    const name = DIR_FILE_BY_TYPE[assertResourceType(type)];
    const path = this.find(name);
    if (!path) {
      throw new AgiError(
        ERROR_CODES.DIR_FILE_NOT_FOUND,
        `Missing directory file ${name} in ${this.dir}.`,
        { type },
      );
    }
    return path;
  }

  /**
   * @param {number} volume
   * @returns {string} absolute path to VOL.<volume>
   */
  volumePath(volume) {
    const path = this.find(`VOL.${volume}`);
    if (!path) {
      throw new AgiError(
        ERROR_CODES.VOL_FILE_NOT_FOUND,
        `Missing volume file VOL.${volume} in ${this.dir}.`,
      );
    }
    return path;
  }

  /** Resource types whose directory file is present. */
  availableTypes() {
    return RESOURCE_TYPES.filter((type) => this.find(DIR_FILE_BY_TYPE[type]));
  }
}

/**
 * Deterministic output file name: `<type>.<id padded to 3>.<extension>`.
 *
 * @param {string} type
 * @param {number} id
 * @param {string} [extension] override, e.g. `.png` for a rendered picture
 * @returns {string}
 */
function resourceFileName(type, id, extension = EXTENSION_BY_TYPE[type]) {
  return `${type}.${String(id).padStart(3, '0')}${extension}`;
}

/**
 * Default output layout groups files by resource type.
 *
 * @param {string} outputDir
 * @param {string} type
 * @param {number} id
 * @param {string} [extension]
 * @returns {string} absolute path
 */
export function resourceOutputPath(outputDir, type, id, extension) {
  return resolve(outputDir, type, resourceFileName(type, id, extension));
}
