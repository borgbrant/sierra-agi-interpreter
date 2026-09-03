import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import {
  extractAll,
  extractOne,
  extractType,
  listResources,
  Session,
} from './agi/extract.js';
import { assertResourceId, assertResourceType, RESOURCE_TYPES } from './agi/files.js';
import { toErrorResult } from './util/errors.js';
import {
  formatErrorLine,
  formatExtractedLine,
  formatListJson,
  formatListTable,
  formatResultJson,
  formatSummary,
} from './util/format.js';

export const USAGE = `agi-extract - extract raw Sierra AGI resources as binary files

Usage:
  agi-extract one <type> <number> [options]   extract a single resource
  agi-extract type <type> [options]           extract every resource of one type
  agi-extract all [options]                   extract every supported type
  agi-extract list [type] [options]           list resources without extracting

Types:
  ${RESOURCE_TYPES.join(', ')}

Options:
  -i, --input <dir>     input directory containing AGI files, default "."
  -o, --output <dir>    output directory, default "./extracted"
      --include-header  write VOL header + payload instead of payload only
      --png             render PICTURE and VIEW resources to PNG instead of raw data
      --png-scale <n>   extra whole-number scale for --png output, default 1
      --view-fps <n>    frame rate of rendered VIEW animations, default 10
      --force           overwrite existing files
      --strict          stop bulk extraction at the first failure
      --json            emit machine-readable JSON result
  -h, --help            show this help
  -V, --version         show version

Examples:
  agi-extract one view 12 --input ./lsl1 --output ./out
  agi-extract type pic --input ./lsl1 --output ./out
  agi-extract all --input ./lsl1 --output ./out
  agi-extract list view --input ./lsl1
  agi-extract type pic --png --png-scale 2 --input ./lsl1 --output ./out
  agi-extract one view 12 --png --input ./lsl1 --output ./out
`;

const OPTIONS = {
  input: { type: 'string', short: 'i', default: '.' },
  output: { type: 'string', short: 'o', default: 'extracted' },
  'include-header': { type: 'boolean', default: false },
  png: { type: 'boolean', default: false },
  'png-scale': { type: 'string', default: '1' },
  'view-fps': { type: 'string', default: '10' },
  force: { type: 'boolean', default: false },
  strict: { type: 'boolean', default: false },
  json: { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
  version: { type: 'boolean', short: 'V', default: false },
};

const COMMANDS = new Set(['one', 'type', 'all', 'list']);

/** Usage error: the command line itself is malformed. Exits 2. */
class UsageError extends Error {}

/**
 * @param {{ out: (line: string) => void, err: (line: string) => void }} io
 * @param {import('./agi/extract.js').ExtractResult} result
 * @param {boolean} json
 * @param {string} outputDir
 * @returns {number} exit code
 */
function reportExtraction(io, result, json, outputDir) {
  if (json) {
    io.out(formatResultJson(result));
    return result.ok ? 0 : 1;
  }

  for (const resource of result.resources) io.out(formatExtractedLine(resource));
  for (const error of result.errors) io.err(formatErrorLine(error));

  io.out(formatSummary(result, outputDir));
  return result.ok ? 0 : 1;
}

/**
 * Run the CLI.
 *
 * @param {string[]} argv    arguments after the node binary and script
 * @param {{ out?: (line: string) => void, err?: (line: string) => void, cwd?: string }} [io]
 * @returns {Promise<number>} process exit code
 */
export async function run(argv, io = {}) {
  const out = io.out ?? ((line) => console.log(line));
  const err = io.err ?? ((line) => console.error(line));
  const sink = { out, err };

  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true }));
  } catch (parseErr) {
    err(`agi-extract: ${parseErr.message}`);
    err('');
    err(USAGE);
    return 2;
  }

  if (values.help) {
    out(USAGE);
    return 0;
  }
  if (values.version) {
    const { default: pkg } = await import('../package.json', { with: { type: 'json' } });
    out(pkg.version);
    return 0;
  }

  const pngScale = Number(values['png-scale']);
  if (!Number.isInteger(pngScale) || pngScale < 1) {
    err(`agi-extract: --png-scale must be a positive integer, got "${values['png-scale']}"`);
    return 2;
  }

  const viewFps = Number(values['view-fps']);
  if (!Number.isInteger(viewFps) || viewFps < 1 || viewFps > 65535) {
    err(`agi-extract: --view-fps must be an integer between 1 and 65535, got "${values['view-fps']}"`);
    return 2;
  }

  const json = values.json;
  const outputDir = resolve(io.cwd ?? process.cwd(), values.output);
  const inputDir = resolve(io.cwd ?? process.cwd(), values.input);

  let session;
  try {
    const [command, ...operands] = positionals;

    if (!command) throw new UsageError('Missing command.');
    if (!COMMANDS.has(command)) throw new UsageError(`Unknown command "${command}".`);

    // Validate operand shape before touching the filesystem.
    let type;
    let id;
    if (command === 'one') {
      if (operands.length < 2) throw new UsageError('Usage: agi-extract one <type> <number>');
      if (operands.length > 2) throw new UsageError(`Unexpected argument "${operands[2]}".`);
      type = assertResourceType(operands[0]);
      id = assertResourceId(operands[1], type);
    } else if (command === 'type') {
      if (operands.length < 1) throw new UsageError('Usage: agi-extract type <type>');
      if (operands.length > 1) throw new UsageError(`Unexpected argument "${operands[1]}".`);
      type = assertResourceType(operands[0]);
    } else if (command === 'list') {
      if (operands.length > 1) throw new UsageError(`Unexpected argument "${operands[1]}".`);
      if (operands.length === 1) type = assertResourceType(operands[0]);
    } else if (operands.length > 0) {
      throw new UsageError(`Unexpected argument "${operands[0]}".`);
    }

    session = await Session.open(inputDir, {
      outputDir,
      includeHeader: values['include-header'],
      png: values.png,
      pngScale,
      viewFps,
      force: values.force,
      strict: values.strict,
      onWarn: json ? undefined : (message) => err(`agi-extract: warning: ${message}`),
    });

    if (command === 'list') {
      const types = type ? [type] : RESOURCE_TYPES;
      const result = await listResources(session, types);

      if (json) {
        out(formatListJson(result.resources));
      } else {
        if (result.resources.length > 0) out(formatListTable(result.resources));
        for (const error of result.errors) err(formatErrorLine(error));
      }
      return result.ok ? 0 : 1;
    }

    const result =
      command === 'one'
        ? await extractOne(session, type, id)
        : command === 'type'
          ? await extractType(session, type)
          : await extractAll(session);

    return reportExtraction(sink, result, json, outputDir);
  } catch (runErr) {
    if (runErr instanceof UsageError) {
      err(`agi-extract: ${runErr.message}`);
      err('');
      err(USAGE);
      return 2;
    }

    const error = toErrorResult(runErr);
    if (json) {
      out(formatResultJson({ ok: false, resources: [], errors: [error] }));
    } else {
      err(formatErrorLine(error));
    }
    return 1;
  } finally {
    await session?.close();
  }
}
