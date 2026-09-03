/**
 * Resource loading: directory lookup, volume caching, payload extraction.
 */
import { parseVolHeader } from 'agi-extract/volume';

import {
  DIR_FILE_BY_TYPE,
  loadDirectories,
  presentResources,
  RESOURCE_TYPES,
  type DirectoryTable,
  type ResourceType,
} from './directory.ts';
import { ResourceError, ERROR_CODES } from './errors.ts';
import type { ResourceSource } from './source.ts';

/** Size of the resource header that precedes every payload in a VOL file. */
const VOL_HEADER_SIZE = 5;

export class ResourceManager {
  readonly directories: Record<ResourceType, DirectoryTable>;

  #source: ResourceSource;
  #volumes = new Map<number, Promise<Uint8Array>>();
  #ready = new Map<number, Uint8Array>();

  private constructor(source: ResourceSource, directories: Record<ResourceType, DirectoryTable>) {
    this.#source = source;
    this.directories = directories;
  }

  static async open(source: ResourceSource): Promise<ResourceManager> {
    return new ResourceManager(source, await loadDirectories(source));
  }

  /**
   * Fetch every volume the directories reference.
   *
   * The interpreter's cycle is synchronous -- a script cannot await a resource
   * mid-instruction -- so the volumes are in memory before it runs. There are
   * only a few hundred kilobytes of them.
   */
  async preload(): Promise<void> {
    const volumes = new Set<number>();
    for (const type of RESOURCE_TYPES) {
      for (const entry of this.directories[type]) {
        if (entry.present) volumes.add(entry.volume!);
      }
    }
    await Promise.all([...volumes].map((n) => this.#volume(n).then((b) => this.#ready.set(n, b))));
  }

  /**
   * Load a resource without awaiting, for use inside the cycle.
   *
   * Requires {@link preload} to have completed.
   */
  loadSync(type: ResourceType, id: number): Uint8Array {
    const entry = this.directories[type][id];
    if (!entry?.present) {
      throw new ResourceError(
        ERROR_CODES.RESOURCE_MISSING,
        `${type} ${id} is not present in ${DIR_FILE_BY_TYPE[type]}`,
      );
    }

    const volume = this.#ready.get(entry.volume!);
    if (!volume) {
      throw new ResourceError(
        ERROR_CODES.VOL_FILE_NOT_FOUND,
        `VOL.${entry.volume} has not been preloaded`,
      );
    }

    return this.#extract(volume, entry.volume!, entry.offset!, type, id);
  }

  /** Whether a resource exists, without loading it. */
  isPresent(type: ResourceType, id: number): boolean {
    return this.directories[type][id]?.present === true;
  }

  /** Resource numbers of one type that are actually present. */
  ids(type: ResourceType): number[] {
    return presentResources(this.directories[type]).map((entry) => entry.id);
  }

  /** How many resources of each type the game holds. */
  counts(): Record<ResourceType, number> {
    const counts = {} as Record<ResourceType, number>;
    for (const type of RESOURCE_TYPES) counts[type] = this.ids(type).length;
    return counts;
  }

  /**
   * Load one resource's payload, with the 5-byte VOL header stripped.
   *
   * @param type resource type
   * @param id   resource number
   */
  async load(type: ResourceType, id: number): Promise<Uint8Array> {
    const entry = this.directories[type][id];

    if (!entry) {
      throw new ResourceError(
        ERROR_CODES.RESOURCE_ID_OUT_OF_RANGE,
        `${type} ${id} is outside ${DIR_FILE_BY_TYPE[type]}, which holds ${this.directories[type].length} entries`,
      );
    }
    if (!entry.present) {
      throw new ResourceError(
        ERROR_CODES.RESOURCE_MISSING,
        `${type} ${id} is marked missing in ${DIR_FILE_BY_TYPE[type]}`,
      );
    }

    const volumeNumber = entry.volume!;
    const offset = entry.offset!;
    const volume = await this.#volume(volumeNumber);

    return this.#extract(volume, volumeNumber, offset, type, id);
  }

  /** Validate a resource header and slice out its payload. */
  #extract(
    volume: Uint8Array,
    volumeNumber: number,
    offset: number,
    type: ResourceType,
    id: number,
  ): Uint8Array {
    if (offset + VOL_HEADER_SIZE > volume.length) {
      throw new ResourceError(
        ERROR_CODES.VOL_OFFSET_OUT_OF_RANGE,
        `${type} ${id} points at offset ${offset} in VOL.${volumeNumber}, which is ${volume.length} bytes`,
      );
    }

    // agi-extract validates the signature and the volume number, and raises the
    // same stable codes this engine reports.
    const header = parseVolHeader(volume, volumeNumber, offset, offset) as {
      payloadLength: number;
      headerLength: number;
    };

    const start = offset + header.headerLength;
    const end = start + header.payloadLength;
    if (end > volume.length) {
      throw new ResourceError(
        ERROR_CODES.PAYLOAD_OUT_OF_RANGE,
        `${type} ${id} declares ${header.payloadLength} bytes at ${start} but VOL.${volumeNumber} ends at ${volume.length}`,
      );
    }

    return volume.subarray(start, end);
  }

  /** Fetch a volume once and keep it; AGI volumes are small. */
  #volume(number: number): Promise<Uint8Array> {
    let pending = this.#volumes.get(number);
    if (!pending) {
      pending = this.#source.read(`VOL.${number}`).then((bytes) => {
        if (!bytes) {
          throw new ResourceError(
            ERROR_CODES.VOL_FILE_NOT_FOUND,
            `A directory entry references VOL.${number}, which is not in the game files`,
          );
        }
        return bytes;
      });
      this.#volumes.set(number, pending);
    }
    return pending;
  }
}
