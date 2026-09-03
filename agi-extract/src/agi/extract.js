import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { AgiError, ERROR_CODES, toErrorResult } from '../util/errors.js';
import {
  assertResourceType,
  GameFiles,
  RESOURCE_TYPES,
  resourceOutputPath,
} from './files.js';
import {
  directoryLengthWarning,
  parseDirectory,
  requireResource,
} from './directory.js';
import { decodePicture, EGA_PALETTE, PICTURE_HEIGHT, PICTURE_WIDTH } from './pic.js';
import {
  celPixelsForLoop,
  composeOnCanvas,
  decodeView,
  TRANSPARENT,
  VIEW_PALETTE,
} from './view.js';
import { encodeIndexedApng, encodeIndexedPng, scalePixels } from '../util/png.js';
import { VolumeCache } from './volume-file.js';

/**
 * An AGI pixel is twice as wide as it is tall, so rendering at 2x horizontally
 * gives an image with the aspect ratio players actually saw. This applies to
 * VIEW cels as much as to pictures.
 */
const PICTURE_PIXEL_ASPECT = 2;

/** Default animation speed for a rendered VIEW loop, in frames per second. */
const DEFAULT_VIEW_FPS = 10;

/** Two-digit label for a loop or cel number, so file names sort correctly. */
const pad2 = (n) => String(n).padStart(2, '0');

/**
 * Interpret a PICTURE payload and encode its visual screen as a PNG.
 *
 * @param {Buffer} payload raw PICTURE bytes, without the VOL header
 * @param {{ scale?: number }} [options]
 * @returns {{ data: Buffer, width: number, height: number }}
 */
export function renderPictureToPng(payload, { scale = 1 } = {}) {
  const screens = decodePicture(payload);
  const scaled = scalePixels(
    screens.visual,
    PICTURE_WIDTH,
    PICTURE_HEIGHT,
    scale * PICTURE_PIXEL_ASPECT,
    scale,
  );

  return {
    data: encodeIndexedPng({ ...scaled, palette: EGA_PALETTE }),
    width: scaled.width,
    height: scaled.height,
  };
}

/**
 * @typedef {object} RenderedFile
 * @property {string} name    file name suffix, appended after `view.NNN.`
 * @property {Buffer} data
 * @property {number} width
 * @property {number} height
 */

/**
 * Render a VIEW into one PNG per cel, plus an animated PNG for every loop that
 * has more than one cel.
 *
 * A loop's frames can differ in size, so each loop gets a canvas as large as
 * its biggest cel and every frame is anchored bottom-left within it — the same
 * corner AGI positions a view by.
 *
 * @param {Buffer} payload raw VIEW bytes, without the VOL header
 * @param {{ scale?: number, fps?: number }} [options]
 * @returns {{ files: RenderedFile[], loops: Array<object>, description: string | null }}
 */
export function renderViewToPngs(payload, { scale = 1, fps = DEFAULT_VIEW_FPS } = {}) {
  const view = decodeView(payload);

  /** @type {RenderedFile[]} */
  const files = [];
  const loops = [];

  const scaleX = scale * PICTURE_PIXEL_ASPECT;
  const encode = (pixels, width, height) => {
    const scaled = scalePixels(pixels, width, height, scaleX, scale);
    return {
      data: encodeIndexedPng({
        ...scaled,
        palette: VIEW_PALETTE,
        transparentIndex: TRANSPARENT,
      }),
      width: scaled.width,
      height: scaled.height,
    };
  };

  for (const loop of view.loops) {
    const cels = loop.cels.filter((cel) => cel.width > 0 && cel.height > 0);

    if (cels.length === 0) {
      loops.push({ loop: loop.loop, cels: 0, width: 0, height: 0, animationPath: null });
      continue;
    }

    const canvasWidth = Math.max(...cels.map((cel) => cel.width));
    const canvasHeight = Math.max(...cels.map((cel) => cel.height));

    const frames = cels.map((cel) =>
      composeOnCanvas(
        celPixelsForLoop(cel, loop.loop),
        cel.width,
        cel.height,
        canvasWidth,
        canvasHeight,
      ),
    );

    cels.forEach((cel, index) => {
      // Each still is written at the cel's own size, not padded to the canvas,
      // so a frame extracted on its own is exactly the sprite.
      const png = encode(celPixelsForLoop(cel, loop.loop), cel.width, cel.height);
      files.push({ name: `loop${pad2(loop.loop)}.cel${pad2(index)}.png`, ...png });
    });

    // Every frame shares the loop's canvas, so the scaled size is arithmetic
    // rather than something to measure -- and the same arithmetic the loop
    // summary below reports.
    const width = canvasWidth * scaleX;
    const height = canvasHeight * scale;

    let animationName = null;
    if (frames.length > 1) {
      const scaled = frames.map(
        (pixels) => scalePixels(pixels, canvasWidth, canvasHeight, scaleX, scale).pixels,
      );

      animationName = `loop${pad2(loop.loop)}.anim.png`;
      files.push({
        name: animationName,
        data: encodeIndexedApng({
          width,
          height,
          frames: scaled,
          palette: VIEW_PALETTE,
          transparentIndex: TRANSPARENT,
          delayNumerator: 1,
          delayDenominator: fps,
        }),
        width,
        height,
      });
    }

    loops.push({ loop: loop.loop, cels: cels.length, width, height, animationName });
  }

  return { files, loops, description: view.description };
}

/**
 * @typedef {object} ExtractedResource
 * @property {string} type
 * @property {number} id
 * @property {number} volume
 * @property {number} offset
 * @property {number} payloadLength
 * @property {string} outputPath
 * @property {boolean} includedHeader
 * @property {'png'} [format] present only when the resource was rendered
 * @property {number} [width]  rendered image width, rendered PICTURE only
 * @property {number} [height] rendered image height, rendered PICTURE only
 * @property {string[]} [files] every file written, rendered VIEW only
 * @property {Array<{loop: number, cels: number, width: number, height: number,
 *                   animationPath: string | null}>} [loops] rendered VIEW only
 * @property {string} [description] VIEW description text, when the resource has one
 */

/**
 * @typedef {object} ExtractResult
 * @property {boolean} ok
 * @property {ExtractedResource[]} resources
 * @property {Array<{ type?: string, id?: number, code: string, message: string }>} errors
 */

/**
 * One extraction session against a game directory. Holds the case-insensitive
 * file index, parsed directory files and open VOL handles.
 *
 * Always {@link Session#close} it when done.
 */
export class Session {
  /**
   * @param {GameFiles} files
   * @param {{ outputDir?: string, includeHeader?: boolean, force?: boolean, strict?: boolean,
   *           png?: boolean, pngScale?: number, viewFps?: number,
   *           onWarn?: (message: string) => void }} [options]
   */
  constructor(files, options = {}) {
    this.files = files;
    this.outputDir = resolve(options.outputDir ?? 'extracted');
    this.includeHeader = options.includeHeader ?? false;
    this.force = options.force ?? false;
    this.strict = options.strict ?? false;
    /** Render PICTURE and VIEW resources to PNG instead of writing raw bytes. */
    this.png = options.png ?? false;
    this.pngScale = options.pngScale ?? 1;
    this.viewFps = options.viewFps ?? DEFAULT_VIEW_FPS;
    this.onWarn = options.onWarn;
    this.volumes = new VolumeCache(files);
    /** @type {Map<string, Buffer>} */
    this._dirBuffers = new Map();
  }

  /**
   * @param {string} inputDir
   * @param {ConstructorParameters<typeof Session>[1]} [options]
   * @returns {Promise<Session>}
   */
  static async open(inputDir, options) {
    return new Session(await GameFiles.open(inputDir), options);
  }

  /**
   * Raw bytes of a type's directory file, read once per session.
   *
   * @param {string} type
   * @returns {Promise<Buffer>}
   */
  async directoryBuffer(type) {
    assertResourceType(type);
    const cached = this._dirBuffers.get(type);
    if (cached) return cached;

    const path = this.files.dirFilePath(type);
    const buffer = await readFile(path);

    const warning = directoryLengthWarning(buffer, path);
    if (warning) this.onWarn?.(warning);

    this._dirBuffers.set(type, buffer);
    return buffer;
  }

  /**
   * Present resources of one type, in resource-number order.
   *
   * @param {string} type
   * @returns {Promise<import('./directory.js').ResourceLocation[]>}
   */
  async listType(type) {
    return parseDirectory(await this.directoryBuffer(type)).filter((entry) => entry.present);
  }

  /**
   * Read one resource without writing it.
   *
   * @param {string} type
   * @param {number} id
   * @returns {Promise<import('./volume.js').VolResource>}
   */
  async readResource(type, id) {
    const entry = requireResource(await this.directoryBuffer(type), id, type);
    const volume = await this.volumes.get(entry.volume);
    return volume.readResource(entry.offset, { includeHeader: this.includeHeader });
  }

  /**
   * Extract one resource to disk.
   *
   * @param {string} type
   * @param {number} id
   * @returns {Promise<ExtractedResource>}
   */
  async extractResource(type, id) {
    const { volume, offset, payloadLength, payload } = await this.readResource(type, id);

    const base = { type, id, volume, offset, payloadLength };

    if (this.png && type === 'pic') {
      const rendered = this.#renderPicture(payload, type, id);
      const outputPath = resourceOutputPath(this.outputDir, type, id, '.png');
      await this.#write(outputPath, rendered.data, type, id);

      return {
        ...base,
        outputPath,
        // A rendered image is not a slice of the VOL file, so the header flag
        // never applies to it.
        includedHeader: false,
        format: 'png',
        width: rendered.width,
        height: rendered.height,
      };
    }

    if (this.png && type === 'view') {
      return { ...base, ...(await this.#extractViewAsPngs(payload, type, id)) };
    }

    const outputPath = resourceOutputPath(this.outputDir, type, id);
    await this.#write(outputPath, payload, type, id);

    return { ...base, outputPath, includedHeader: this.includeHeader };
  }

  /**
   * Write one file, turning filesystem failures into stable error codes.
   *
   * @param {string} path @param {Buffer} data @param {string} type @param {number} id
   */
  async #write(path, data, type, id) {
    await mkdir(dirname(path), { recursive: true });

    try {
      await writeFile(path, data, { flag: this.force ? 'w' : 'wx' });
    } catch (err) {
      if (err.code === 'EEXIST') {
        throw new AgiError(
          ERROR_CODES.OUTPUT_EXISTS,
          `Output file already exists: ${path}. Pass --force to overwrite.`,
          { type, id, cause: err },
        );
      }
      throw new AgiError(ERROR_CODES.WRITE_FAILED, `Cannot write ${path}: ${err.message}`, {
        type,
        id,
        cause: err,
      });
    }
  }

  /**
   * Render a VIEW to a set of PNGs: one per cel, plus an animation per loop.
   *
   * @param {Buffer} payload @param {string} type @param {number} id
   */
  async #extractViewAsPngs(payload, type, id) {
    let rendered;
    try {
      rendered = renderViewToPngs(payload, { scale: this.pngScale, fps: this.viewFps });
    } catch (err) {
      throw new AgiError(
        ERROR_CODES.VIEW_RENDER_FAILED,
        `Cannot render view ${id} to PNG: ${err.message}`,
        { type, id, cause: err },
      );
    }

    if (rendered.files.length === 0) {
      throw new AgiError(
        ERROR_CODES.VIEW_RENDER_FAILED,
        `View ${id} contains no cels to render.`,
        { type, id },
      );
    }

    const prefix = resourceOutputPath(this.outputDir, type, id, '.');
    const pathFor = (name) => prefix + name;

    const files = [];
    for (const file of rendered.files) {
      const path = pathFor(file.name);
      await this.#write(path, file.data, type, id);
      files.push(path);
    }

    return {
      outputPath: files[0],
      includedHeader: false,
      format: 'png',
      files,
      loops: rendered.loops.map(({ animationName, ...loop }) => ({
        ...loop,
        animationPath: animationName ? pathFor(animationName) : null,
      })),
      ...(rendered.description === null ? {} : { description: rendered.description }),
    };
  }

  /**
   * @param {Buffer} payload
   * @param {string} type
   * @param {number} id
   */
  #renderPicture(payload, type, id) {
    try {
      return renderPictureToPng(payload, { scale: this.pngScale });
    } catch (err) {
      throw new AgiError(
        ERROR_CODES.PIC_RENDER_FAILED,
        `Cannot render picture ${id} to PNG: ${err.message}`,
        { type, id, cause: err },
      );
    }
  }

  close() {
    return this.volumes.close();
  }
}

/** @returns {ExtractResult} an empty result to accumulate into */
function empty() {
  return { ok: true, resources: [], errors: [] };
}

/** @param {ExtractResult} result */
function finish(result) {
  result.ok = result.errors.length === 0;
  return result;
}

/**
 * Extract every present resource of one type into an existing result.
 *
 * Missing directory entries are skipped; a failure on one resource is recorded
 * and the run continues, unless the session is strict.
 *
 * @param {Session} session
 * @param {string} type
 * @param {ExtractResult} result accumulated into
 * @returns {Promise<boolean>} false when a strict session should stop here
 */
async function collectType(session, type, result) {
  let entries;
  try {
    assertResourceType(type);
    entries = await session.listType(type);
  } catch (err) {
    result.errors.push(toErrorResult(err, { type }));
    return !session.strict;
  }

  for (const entry of entries) {
    try {
      result.resources.push(await session.extractResource(type, entry.id));
    } catch (err) {
      result.errors.push(toErrorResult(err, { type, id: entry.id }));
      if (session.strict) return false;
    }
  }

  return true;
}

/**
 * Extract a single resource.
 *
 * @param {Session} session
 * @param {string} type
 * @param {number} id
 * @returns {Promise<ExtractResult>}
 */
export async function extractOne(session, type, id) {
  const result = empty();
  try {
    assertResourceType(type);
    result.resources.push(await session.extractResource(type, id));
  } catch (err) {
    result.errors.push(toErrorResult(err, { type, id }));
  }
  return finish(result);
}

/**
 * Extract every present resource of one type.
 *
 * @param {Session} session
 * @param {string} type
 * @returns {Promise<ExtractResult>}
 */
export async function extractType(session, type) {
  const result = empty();
  await collectType(session, type, result);
  return finish(result);
}

/**
 * Extract every present resource of every supported type.
 *
 * @param {Session} session
 * @returns {Promise<ExtractResult>}
 */
export async function extractAll(session) {
  const result = empty();
  for (const type of RESOURCE_TYPES) {
    if (!(await collectType(session, type, result))) break;
  }
  return finish(result);
}

/**
 * @typedef {object} ListedResource
 * @property {string} type
 * @property {number} id
 * @property {number} volume
 * @property {number} offset
 * @property {number | null} payloadLength null when the header could not be read
 */

/**
 * List present resources, reading each VOL header for its payload length.
 *
 * @param {Session} session
 * @param {string[]} types
 * @returns {Promise<{ ok: boolean, resources: ListedResource[], errors: ExtractResult['errors'] }>}
 */
export async function listResources(session, types) {
  /** @type {ListedResource[]} */
  const resources = [];
  /** @type {ExtractResult['errors']} */
  const errors = [];

  outer: for (const type of types) {
    assertResourceType(type);

    let entries;
    try {
      entries = await session.listType(type);
    } catch (err) {
      errors.push(toErrorResult(err, { type }));
      if (session.strict) break;
      continue;
    }

    for (const entry of entries) {
      try {
        const volume = await session.volumes.get(entry.volume);
        const header = await volume.readHeader(entry.offset);
        resources.push({
          type,
          id: entry.id,
          volume: entry.volume,
          offset: entry.offset,
          payloadLength: header.payloadLength,
        });
      } catch (err) {
        errors.push(toErrorResult(err, { type, id: entry.id }));
        resources.push({
          type,
          id: entry.id,
          volume: entry.volume,
          offset: entry.offset,
          payloadLength: null,
        });
        if (session.strict) break outer;
      }
    }
  }

  return { ok: errors.length === 0, resources, errors };
}
