/**
 * What the app reports about the game it loaded.
 *
 * Kept apart from the DOM so the content can be tested without a browser.
 */
import { RESOURCE_TYPES, type ResourceType } from './directory.ts';
import type { ResourceManager } from './manager.ts';
import type { ObjectFile } from './objects.ts';
import type { Vocabulary } from './words.ts';

export interface GameSummary {
  counts: Record<ResourceType, number>;
  totalResources: number;
  items: number;
  maxAnimatedObjects: number;
  words: number;
  encryptedObjects: boolean;
}

export function summariseGame(
  manager: ResourceManager,
  objects: ObjectFile,
  vocabulary: Vocabulary,
): GameSummary {
  const counts = manager.counts();
  return {
    counts,
    totalResources: RESOURCE_TYPES.reduce((sum, type) => sum + counts[type], 0),
    items: objects.items.length,
    maxAnimatedObjects: objects.maxAnimatedObjects,
    words: vocabulary.size,
    encryptedObjects: objects.encrypted,
  };
}

/** Render a summary as the lines the shell displays. */
export function formatSummary(summary: GameSummary): string[] {
  return [
    ...RESOURCE_TYPES.map((type) => `${type.padEnd(6)} ${String(summary.counts[type]).padStart(4)}`),
    `${'total'.padEnd(6)} ${String(summary.totalResources).padStart(4)} resources`,
    '',
    `inventory items   ${summary.items}${summary.encryptedObjects ? ' (OBJECT was obfuscated)' : ''}`,
    `max animated      ${summary.maxAnimatedObjects}`,
    `vocabulary        ${summary.words} words`,
  ];
}
