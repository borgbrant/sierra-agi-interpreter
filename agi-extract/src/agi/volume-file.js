/**
 * Reading VOL files from disk.
 *
 * Kept apart from `volume.js` so that the header format logic stays free of
 * Node built-ins and can be bundled for a browser, which cannot resolve
 * `node:fs/promises` at all.
 */
import { open } from 'node:fs/promises';

import { AgiError, ERROR_CODES } from '../util/errors.js';
import { parseVolHeader, VOL_HEADER_SIZE } from './volume.js';

/**
 * An open VOL file, with its size cached for bounds checks.
 */
export class VolumeFile {
  /**
   * @param {number} volume
   * @param {import('node:fs/promises').FileHandle} handle
   * @param {number} size
   */
  constructor(volume, handle, size) {
    this.volume = volume;
    this.handle = handle;
    this.size = size;
  }

  /**
   * @param {number} volume
   * @param {string} path
   * @returns {Promise<VolumeFile>}
   */
  static async open(volume, path) {
    let handle;
    try {
      handle = await open(path, 'r');
    } catch (err) {
      throw new AgiError(ERROR_CODES.VOL_FILE_NOT_FOUND, `Cannot open ${path}: ${err.message}`, {
        cause: err,
      });
    }
    const { size } = await handle.stat();
    return new VolumeFile(volume, handle, size);
  }

  /**
   * Read and validate the resource header at `offset`.
   *
   * @param {number} offset
   * @returns {Promise<VolResource>}
   */
  async readHeader(offset) {
    if (offset < 0 || offset >= this.size) {
      throw new AgiError(
        ERROR_CODES.VOL_OFFSET_OUT_OF_RANGE,
        `Offset ${offset} is outside VOL.${this.volume}, which is ${this.size} bytes.`,
      );
    }
    if (offset + VOL_HEADER_SIZE > this.size) {
      throw new AgiError(
        ERROR_CODES.VOL_HEADER_TRUNCATED,
        `Resource header at VOL.${this.volume} offset ${offset} runs past the end of the file ` +
          `(${this.size - offset} of ${VOL_HEADER_SIZE} bytes available).`,
      );
    }

    const buffer = Buffer.alloc(VOL_HEADER_SIZE);
    const { bytesRead } = await this.handle.read(buffer, 0, VOL_HEADER_SIZE, offset);
    if (bytesRead < VOL_HEADER_SIZE) {
      throw new AgiError(
        ERROR_CODES.VOL_HEADER_TRUNCATED,
        `Read only ${bytesRead} of ${VOL_HEADER_SIZE} header bytes at VOL.${this.volume} offset ${offset}.`,
      );
    }

    const { volume, payloadLength, headerLength } = parseVolHeader(buffer, this.volume, 0, offset);

    if (offset + headerLength + payloadLength > this.size) {
      throw new AgiError(
        ERROR_CODES.PAYLOAD_OUT_OF_RANGE,
        `Declared payload length ${payloadLength} at VOL.${this.volume} offset ${offset} runs past ` +
          `the end of the file (${this.size - offset - headerLength} bytes available).`,
      );
    }

    return { volume, offset, headerLength, payloadLength };
  }

  /**
   * Read a resource, returning the payload exactly as stored.
   *
   * With `includeHeader`, the buffer spans the resource offset through the end
   * of the payload, i.e. the 5-byte header is prepended.
   *
   * @param {number} offset
   * @param {{ includeHeader?: boolean }} [options]
   * @returns {Promise<VolResource>}
   */
  async readResource(offset, { includeHeader = false } = {}) {
    const meta = await this.readHeader(offset);

    const start = includeHeader ? offset : offset + meta.headerLength;
    const length = includeHeader ? meta.headerLength + meta.payloadLength : meta.payloadLength;

    const payload = Buffer.alloc(length);
    if (length > 0) {
      const { bytesRead } = await this.handle.read(payload, 0, length, start);
      if (bytesRead < length) {
        throw new AgiError(
          ERROR_CODES.PAYLOAD_OUT_OF_RANGE,
          `Read only ${bytesRead} of ${length} bytes at VOL.${this.volume} offset ${start}.`,
        );
      }
    }

    return { ...meta, payload };
  }

  close() {
    return this.handle.close();
  }
}

/**
 * Opens VOL files on demand and keeps the handles around, so a bulk extraction
 * opens each volume once.
 */
export class VolumeCache {
  /** @param {import('./files.js').GameFiles} files */
  constructor(files) {
    this.files = files;
    /** @type {Map<number, Promise<VolumeFile>>} */
    this.volumes = new Map();
  }

  /**
   * @param {number} volume
   * @returns {Promise<VolumeFile>}
   */
  get(volume) {
    let pending = this.volumes.get(volume);
    if (!pending) {
      pending = Promise.resolve().then(() =>
        VolumeFile.open(volume, this.files.volumePath(volume)),
      );
      this.volumes.set(volume, pending);
    }
    return pending;
  }

  async close() {
    const pending = [...this.volumes.values()];
    this.volumes.clear();
    await Promise.all(pending.map((p) => p.then((vol) => vol.close()).catch(() => {})));
  }
}
