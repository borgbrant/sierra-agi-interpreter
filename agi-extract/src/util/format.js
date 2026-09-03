/**
 * Format a VOL offset the way the list table shows it: `0x00123A`.
 *
 * @param {number} offset
 * @returns {string}
 */
function formatOffset(offset) {
  return `0x${offset.toString(16).toUpperCase().padStart(6, '0')}`;
}

const LIST_COLUMNS = [
  { header: 'TYPE', min: 7, value: (r) => r.type },
  { header: 'ID', min: 5, value: (r) => String(r.id) },
  { header: 'VOL', min: 6, value: (r) => String(r.volume) },
  { header: 'OFFSET', min: 10, value: (r) => formatOffset(r.offset) },
  { header: 'SIZE', min: 4, value: (r) => (r.payloadLength === null ? '-' : String(r.payloadLength)) },
];

/**
 * Render the human-readable `list` table.
 *
 * @param {import('../agi/extract.js').ListedResource[]} resources
 * @returns {string}
 */
export function formatListTable(resources) {
  const rows = resources.map((r) => LIST_COLUMNS.map((col) => col.value(r)));

  const widths = LIST_COLUMNS.map((col, i) =>
    Math.max(col.min, ...rows.map((row) => row[i].length + 2)),
  );

  const line = (cells) =>
    cells
      .map((cell, i) => (i === cells.length - 1 ? cell : cell.padEnd(widths[i])))
      .join('')
      .trimEnd();

  return [line(LIST_COLUMNS.map((col) => col.header)), ...rows.map(line)].join('\n');
}

/**
 * Render the `list` JSON output: a bare array of resource records.
 *
 * @param {import('../agi/extract.js').ListedResource[]} resources
 * @returns {string}
 */
export function formatListJson(resources) {
  return JSON.stringify(resources, null, 2);
}

/**
 * Render an extraction result as JSON.
 *
 * @param {import('../agi/extract.js').ExtractResult} result
 * @returns {string}
 */
export function formatResultJson(result) {
  return JSON.stringify(
    { ok: result.ok, resources: result.resources, errors: result.errors },
    null,
    2,
  );
}

/**
 * Render one extracted resource as a progress line.
 *
 * @param {import('../agi/extract.js').ExtractedResource} resource
 * @returns {string}
 */
export function formatExtractedLine(resource) {
  if (resource.format === 'png' && resource.files) {
    const frames = resource.loops.reduce((n, loop) => n + loop.cels, 0);
    const animations = resource.loops.filter((loop) => loop.animationPath).length;
    const parts = [
      `${resource.loops.length} loop(s)`,
      `${frames} frame(s)`,
      ...(animations > 0 ? [`${animations} animation(s)`] : []),
    ];
    return (
      `${resource.outputPath.replace(/\.loop\d+\.cel\d+\.png$/, '.*.png')}  ` +
      `(${parts.join(', ')} from ${resource.payloadLength} bytes in VOL.${resource.volume})`
    );
  }

  if (resource.format === 'png') {
    return (
      `${resource.outputPath}  (${resource.width}x${resource.height} PNG from ` +
      `${resource.payloadLength} bytes of vectors in VOL.${resource.volume})`
    );
  }
  const bytes = resource.payloadLength + (resource.includedHeader ? 5 : 0);
  return `${resource.outputPath}  (${bytes} bytes from VOL.${resource.volume})`;
}

/**
 * Render an error entry as a stderr line.
 *
 * @param {{ type?: string, id?: number, code: string, message: string }} error
 * @returns {string}
 */
export function formatErrorLine(error) {
  const subject =
    error.type === undefined
      ? ''
      : error.id === undefined
        ? ` ${error.type}`
        : ` ${error.type} ${error.id}`;
  return `${error.code}:${subject} ${error.message}`;
}

/**
 * Render the trailing summary of an extraction run.
 *
 * @param {import('../agi/extract.js').ExtractResult} result
 * @param {string} outputDir
 * @returns {string}
 */
export function formatSummary(result, outputDir) {
  const extracted = `Extracted ${result.resources.length} resource(s) to ${outputDir}`;
  return result.errors.length === 0
    ? extracted
    : `${extracted}, ${result.errors.length} failed`;
}
