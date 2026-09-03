/**
 * The four resource directory files, which say where every resource lives.
 *
 * The 3-byte entry format is parsed by agi-extract, which already has tests for
 * the packing and for the FF FF FF missing-resource marker.
 */
import { parseDirectory } from 'agi-extract/directory';

import { ResourceError, ERROR_CODES } from './errors.ts';
import type { ResourceSource } from './source.ts';

export const RESOURCE_TYPES = ['logic', 'pic', 'view', 'sound'] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export const DIR_FILE_BY_TYPE: Record<ResourceType, string> = {
  logic: 'LOGDIR',
  pic: 'PICDIR',
  view: 'VIEWDIR',
  sound: 'SNDDIR',
};

/** Where one resource's payload lives. */
export interface ResourceLocation {
  id: number;
  present: boolean;
  volume?: number;
  offset?: number;
}

/** Every resource of one type, indexed by resource number. */
export type DirectoryTable = readonly ResourceLocation[];

/**
 * Load and parse all four directory files.
 *
 * @param source where to read the files from
 */
export async function loadDirectories(
  source: ResourceSource,
): Promise<Record<ResourceType, DirectoryTable>> {
  const tables = {} as Record<ResourceType, DirectoryTable>;

  for (const type of RESOURCE_TYPES) {
    const name = DIR_FILE_BY_TYPE[type];
    const bytes = await source.read(name);
    if (!bytes) {
      throw new ResourceError(ERROR_CODES.DIR_FILE_NOT_FOUND, `Missing directory file ${name}`);
    }
    tables[type] = parseDirectory(bytes) as DirectoryTable;
  }

  return tables;
}

/** Resources that are actually present, in resource-number order. */
export function presentResources(table: DirectoryTable): ResourceLocation[] {
  return table.filter((entry) => entry.present);
}
