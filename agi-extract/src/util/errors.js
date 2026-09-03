/** Stable error codes, as specified. Keep these strings frozen — they are API. */
export const ERROR_CODES = Object.freeze({
  INPUT_DIR_NOT_FOUND: 'INPUT_DIR_NOT_FOUND',
  DIR_FILE_NOT_FOUND: 'DIR_FILE_NOT_FOUND',
  UNKNOWN_RESOURCE_TYPE: 'UNKNOWN_RESOURCE_TYPE',
  INVALID_RESOURCE_ID: 'INVALID_RESOURCE_ID',
  RESOURCE_ID_OUT_OF_RANGE: 'RESOURCE_ID_OUT_OF_RANGE',
  RESOURCE_MISSING: 'RESOURCE_MISSING',
  VOL_FILE_NOT_FOUND: 'VOL_FILE_NOT_FOUND',
  VOL_OFFSET_OUT_OF_RANGE: 'VOL_OFFSET_OUT_OF_RANGE',
  VOL_HEADER_TRUNCATED: 'VOL_HEADER_TRUNCATED',
  INVALID_VOL_SIGNATURE: 'INVALID_VOL_SIGNATURE',
  VOL_NUMBER_MISMATCH: 'VOL_NUMBER_MISMATCH',
  PAYLOAD_OUT_OF_RANGE: 'PAYLOAD_OUT_OF_RANGE',
  OUTPUT_EXISTS: 'OUTPUT_EXISTS',
  WRITE_FAILED: 'WRITE_FAILED',
  // Extensions beyond the specified set, for PNG rendering.
  PIC_RENDER_FAILED: 'PIC_RENDER_FAILED',
  VIEW_RENDER_FAILED: 'VIEW_RENDER_FAILED',
});

/**
 * An error carrying one of the stable {@link ERROR_CODES}, plus the resource it
 * relates to when that is known.
 */
export class AgiError extends Error {
  /**
   * @param {string} code    One of ERROR_CODES.
   * @param {string} message Human-readable explanation.
   * @param {{ type?: string, id?: number, cause?: unknown }} [details]
   */
  constructor(code, message, details = {}) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = 'AgiError';
    this.code = code;
    if (details.type !== undefined) this.type = details.type;
    if (details.id !== undefined) this.id = details.id;
  }

  /**
   * Shape used in the `errors` array of a JSON result.
   *
   * @returns {{ type?: string, id?: number, code: string, message: string }}
   */
  toResult() {
    return {
      ...(this.type === undefined ? {} : { type: this.type }),
      ...(this.id === undefined ? {} : { id: this.id }),
      code: this.code,
      message: this.message,
    };
  }
}

/**
 * Coerce any thrown value into an {@link AgiError} result entry, so unexpected
 * failures still surface with a stable code.
 *
 * @param {unknown} err
 * @param {{ type?: string, id?: number }} [context]
 */
export function toErrorResult(err, context = {}) {
  if (err instanceof AgiError) {
    return { ...context, ...err.toResult() };
  }
  return {
    ...context,
    code: ERROR_CODES.WRITE_FAILED,
    message: err instanceof Error ? err.message : String(err),
  };
}
