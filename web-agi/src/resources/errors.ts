/**
 * Failure reporting for the resource layer.
 *
 * The stable error codes are shared with agi-extract so both projects name the
 * same failures the same way, and codes only this engine can raise are added
 * alongside them.
 */
import { ERROR_CODES as EXTRACT_CODES } from 'agi-extract/errors';

export const ERROR_CODES = {
  ...EXTRACT_CODES,
  /** The manifest that says which files exist could not be read. */
  MANIFEST_NOT_FOUND: 'MANIFEST_NOT_FOUND',
  /** A file the manifest promised could not be fetched. */
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  /** OBJECT could not be parsed under either encryption assumption. */
  OBJECT_MALFORMED: 'OBJECT_MALFORMED',
  /** WORDS.TOK is not shaped like a vocabulary. */
  VOCABULARY_MALFORMED: 'VOCABULARY_MALFORMED',
} as const;

export type ErrorCode = string;

/** An error carrying one of the stable codes. */
export class ResourceError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ResourceError';
    this.code = code;
  }
}
