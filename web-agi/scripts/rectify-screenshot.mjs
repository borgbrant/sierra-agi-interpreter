/**
 * A capture of the original on a Hercules, turned back into the bits it was.
 *
 * The screenshots in `screenshots-from-original/` are scaled screen grabs, not
 * photographs of a tube: every one of them is a whole-ish multiple of the
 * mode's own raster, so a capture can be put back on that grid and sampled.
 *
 * What comes back per pixel is **not** reliably the original's lit-or-unlit
 * decision, and M15 learned that the hard way. Half of the Hercules dither
 * table's patterns alternate on a one-pixel pitch, and a capture smooths those
 * into a flat half-tone before it is saved -- so a threshold reports light
 * grey's checkerboard as solid amber and cyan's alternating rows as solid
 * black. Use `grid` for geometry, for text, and for coarse patterns; use
 * brightness for anything finer. `scripts/check-hgc-dither.mjs` does the
 * latter.
 *
 * ## Calibrating without being told anything
 *
 * The status bar is the landmark, because it is the one thing on the screen
 * whose size and position are known from the geometry rather than from the
 * game: it is lit across the whole width of the scene, and the scene is 640
 * device pixels wide. So its lit extent gives both the horizontal scale and
 * where the scene's left edge is -- which is all that is needed, because the
 * pixels are square (640x336 is the picture's own 1.905:1, which is why this
 * driver asks for square pixels in the first place).
 *
 * Its *height* is the part that had to be measured rather than assumed. The lit
 * band comes out twelve device rows tall, not fourteen: the status row is a
 * fourteen-row cell whose inverse background covers only the twelve rows the
 * glyph occupies, leaving one unlit row above and one below. That is `HGC_FONT`'s
 * twelve rows showing up in a place nothing in this repository predicted, and it
 * is what fixes the vertical origin -- the band's top edge is device row 1, so
 * the picture starts at device row 14.
 *
 * ## Sampling
 *
 * The captures are smoothed upscales, so a device pixel's footprint is bright
 * in the middle and mixed at its edges. Only the inner half is averaged, and
 * the lit/unlit split is Otsu's threshold over the whole capture rather than a
 * constant -- amber is `#FFB000` on a card, but not after a scaler and a PNG.
 *
 * Usage:
 *   node scripts/rectify-screenshot.mjs <capture.png> [--text] [--out grid.txt]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

/** The mode's raster, and the scene inside it. */
export const SCENE_WIDTH = 640;
export const SCENE_HEIGHT = 336;
/** The status row's cell, and the glyph band inside it that the capture shows lit. */
export const STATUS_ROWS = 14;
export const STATUS_LIT_ROWS = 12;
/** One AGI pixel, in device pixels. */
export const HGC_PIXEL_WIDTH = 4;
export const HGC_PIXEL_HEIGHT = 2;

/**
 * PNG in, RGBA out.
 *
 * Written here rather than pulled in as a dependency: the whole of it is IHDR,
 * the IDAT chunks concatenated, `inflateSync`, and five filter types, and a
 * repository that decodes AGI's own picture format can decode this one.
 */
export function decodePng(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0) !== 0x89504e47) throw new Error('not a PNG');

  let width = 0;
  let height = 0;
  let depth = 0;
  let colourType = 0;
  const parts = [];

  for (let at = 8; at < bytes.length; ) {
    const length = view.getUint32(at);
    const kind = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const body = bytes.subarray(at + 8, at + 8 + length);

    if (kind === 'IHDR') {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      depth = body[8];
      colourType = body[9];
      if (depth !== 8) throw new Error(`only 8 bits per channel: got ${depth}`);
      if (body[12] !== 0) throw new Error('interlaced PNGs are not read here');
    } else if (kind === 'IDAT') {
      parts.push(body);
    } else if (kind === 'IEND') {
      break;
    }
    at += 12 + length;
  }

  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colourType];
  if (!channels) throw new Error(`colour type ${colourType} is not read here`);

  const raw = inflateSync(Buffer.concat(parts));
  const stride = width * channels;
  const out = new Uint8Array(stride * height);

  // Unfiltering, which is the only part of PNG that is not a library call. Each
  // row's filter byte says what its bytes were made relative to.
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = out.subarray(y * stride, (y + 1) * stride);
    const above = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;

    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? row[x - channels] : 0;
      const up = above ? above[x] : 0;
      const upLeft = above && x >= channels ? above[x - channels] : 0;
      let value = line[x];

      switch (filter) {
        case 0: break;
        case 1: value += left; break;
        case 2: value += up; break;
        case 3: value += (left + up) >> 1; break;
        case 4: {
          const p = left + up - upLeft;
          const dl = Math.abs(p - left);
          const du = Math.abs(p - up);
          const dul = Math.abs(p - upLeft);
          value += dl <= du && dl <= dul ? left : du <= dul ? up : upLeft;
          break;
        }
        default: throw new Error(`filter ${filter} on row ${y}`);
      }
      row[x] = value & 0xff;
    }
  }

  return { width, height, channels, pixels: out };
}

/** Luma, as a plain array of one value per pixel. */
export function luma({ width, height, channels, pixels }) {
  const out = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const at = i * channels;
    out[i] = channels === 1
      ? pixels[at]
      : 0.299 * pixels[at] + 0.587 * pixels[at + 1] + 0.114 * pixels[at + 2];
  }
  return out;
}

/**
 * The lit/unlit split, chosen from the capture rather than from `#FFB000`.
 *
 * Otsu's threshold: the one that minimises the variance within the two groups
 * it makes. A mono screen is about as close to two-peaked as an image gets, so
 * this is the case the method is for.
 */
export function otsu(values) {
  const histogram = new Float64Array(256);
  for (const value of values) histogram[Math.max(0, Math.min(255, Math.round(value)))]++;

  const total = values.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * histogram[i];

  let below = 0;
  let weight = 0;
  let best = 0;
  let bestVariance = -1;

  for (let t = 0; t < 256; t++) {
    weight += histogram[t];
    if (weight === 0) continue;
    const rest = total - weight;
    if (rest === 0) break;
    below += t * histogram[t];
    const meanBelow = below / weight;
    const meanAbove = (sum - below) / rest;
    const variance = weight * rest * (meanBelow - meanAbove) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      best = t;
    }
  }
  return best;
}

/**
 * Where the scene is in a capture, and how big a device pixel came out.
 *
 * Everything follows from the status bar: lit across the scene's full 640
 * pixels, twelve device rows of lit background one row down from the top of the
 * screen. Nothing here trusts the capture's own dimensions, because the seven
 * captures are not cropped the same way -- three of them are the scene alone
 * and four include the card's unlit margins.
 */
export function calibrate(image, values, threshold) {
  const { width, height } = image;
  const lit = (x, y) => values[y * width + x] > threshold;

  // The status band: the topmost run of rows that are lit nearly all the way
  // across whatever the widest lit span on the row is.
  const litPerRow = new Int32Array(height);
  for (let y = 0; y < height; y++) {
    let count = 0;
    for (let x = 0; x < width; x++) if (lit(x, y)) count++;
    litPerRow[y] = count;
  }

  const widest = Math.max(...litPerRow);
  const isBand = (y) => litPerRow[y] > widest * 0.7;

  let top = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    if (!isBand(y)) continue;
    let end = y;
    while (end + 1 < height && isBand(end + 1)) end++;
    if (end - y + 1 >= 6) {
      top = y;
      bottom = end;
      break;
    }
    y = end;
  }
  if (top < 0) throw new Error('no status bar found: this capture cannot be calibrated');

  // Its horizontal extent is the scene's, measured on the band's own rows so
  // that dark glyph pixels inside it cannot pull the edges in.
  const band = [];
  for (let x = 0; x < width; x++) {
    let count = 0;
    for (let y = top; y <= bottom; y++) if (lit(x, y)) count++;
    band.push(count);
  }
  const inside = (x) => band[x] > (bottom - top + 1) * 0.3;
  let left = 0;
  while (left < width && !inside(left)) left++;
  let right = width - 1;
  while (right > left && !inside(right)) right--;

  const scale = (right - left + 1) / SCENE_WIDTH;
  // The band's top edge is device row 1: the status cell is fourteen rows and
  // its lit background is the glyph's twelve, so there is one unlit row above.
  const originY = top - scale;

  return {
    originX: left,
    originY,
    scale,
    // What the band measured, for the caller to check against STATUS_LIT_ROWS.
    statusLitRows: (bottom - top + 1) / scale,
    deviceRows: (height - originY) / scale,
  };
}

/** One device pixel, sampled from the inner half of its footprint. */
function sample(image, values, { originX, originY, scale }, x, y) {
  const cx = originX + (x + 0.5) * scale;
  const cy = originY + (y + 0.5) * scale;
  const half = Math.max(0.5, scale / 4);

  let total = 0;
  let count = 0;
  for (let py = Math.round(cy - half); py <= Math.round(cy + half); py++) {
    if (py < 0 || py >= image.height) continue;
    for (let px = Math.round(cx - half); px <= Math.round(cx + half); px++) {
      if (px < 0 || px >= image.width) continue;
      total += values[py * image.width + px];
      count++;
    }
  }
  return count ? total / count : 0;
}

/**
 * A capture decoded once, because the recovery samples it hundreds of times.
 *
 * Kept apart from the sampling so that refining the grid costs an arithmetic
 * pass rather than another inflate of eight megabytes.
 */
export function load(file) {
  const image = decodePng(readFileSync(file));
  const values = luma(image);
  const threshold = otsu(values);
  return { file, image, values, threshold, geometry: calibrate(image, values, threshold) };
}

/**
 * A capture, as one bit per device pixel of the scene.
 *
 * The grid is the scene only: 640 by 336, starting at device row 14, which is
 * where the picture starts. The status row and anything below the scene are not
 * the picture's dither and are no use to the recovery.
 */
export function grid(loaded, geometry = loaded.geometry) {
  const bits = new Uint8Array(SCENE_WIDTH * SCENE_HEIGHT);
  for (let y = 0; y < SCENE_HEIGHT; y++) {
    for (let x = 0; x < SCENE_WIDTH; x++) {
      const value = sample(loaded.image, loaded.values, geometry, x, y + STATUS_ROWS);
      bits[y * SCENE_WIDTH + x] = value > loaded.threshold ? 1 : 0;
    }
  }
  return bits;
}

/** Both halves, for the callers that only want the bits once. */
export function rectify(file, geometry) {
  const loaded = load(file);
  return { ...loaded, geometry: geometry ?? loaded.geometry, bits: grid(loaded, geometry) };
}

/**
 * The two landmarks a wrong calibration cannot fake.
 *
 * The first is the status band's height, which has to come out at the twelve
 * rows the glyph cell has. The second is that a solidly lit region of the
 * picture comes out in runs of four device pixels, on the AGI pixel's own
 * boundaries -- if the scale or the origin is off, those runs land at three or
 * five and start in the middle of an AGI pixel.
 */
export function checkLandmarks({ bits, geometry }) {
  const litRowsOff = Math.abs(geometry.statusLitRows - STATUS_LIT_ROWS);

  let aligned = 0;
  let stray = 0;
  for (let y = 0; y < SCENE_HEIGHT; y++) {
    let run = 0;
    for (let x = 0; x <= SCENE_WIDTH; x++) {
      const bit = x < SCENE_WIDTH ? bits[y * SCENE_WIDTH + x] : 0;
      if (bit) {
        run++;
        continue;
      }
      if (run >= HGC_PIXEL_WIDTH) {
        // Where a run of four or more starts and ends, relative to the AGI grid.
        const start = x - run;
        if (start % HGC_PIXEL_WIDTH === 0 && run % HGC_PIXEL_WIDTH === 0) aligned++;
        else stray++;
      }
      run = 0;
    }
  }

  return { litRowsOff, aligned, stray, alignment: aligned / Math.max(1, aligned + stray) };
}

if (process.argv[1]?.endsWith('rectify-screenshot.mjs')) {
  const [file, ...flags] = process.argv.slice(2);
  if (!file) {
    console.error('usage: node scripts/rectify-screenshot.mjs <capture.png> [--text] [--out file]');
    process.exit(1);
  }

  const result = rectify(file);
  const landmarks = checkLandmarks(result);
  const { geometry } = result;

  console.log(`${file}`);
  console.log(`  ${result.image.width}x${result.image.height}, threshold ${result.threshold}`);
  console.log(`  scene at (${geometry.originX}, ${geometry.originY.toFixed(1)}) `
    + `at ${geometry.scale.toFixed(3)}x, ${geometry.deviceRows.toFixed(1)} device rows`);
  console.log(`  status band ${geometry.statusLitRows.toFixed(2)} rows `
    + `(expected ${STATUS_LIT_ROWS}, off by ${landmarks.litRowsOff.toFixed(2)})`);
  console.log(`  lit runs of four or more: ${(landmarks.alignment * 100).toFixed(1)}% on the AGI grid `
    + `(${landmarks.aligned} aligned, ${landmarks.stray} stray)`);

  const text = () => {
    const lines = [];
    for (let y = 0; y < SCENE_HEIGHT; y++) {
      let line = '';
      for (let x = 0; x < SCENE_WIDTH; x++) line += result.bits[y * SCENE_WIDTH + x] ? '#' : '.';
      lines.push(line);
    }
    return lines.join('\n');
  };

  const out = flags.indexOf('--out');
  if (out >= 0 && flags[out + 1]) {
    writeFileSync(flags[out + 1], `${text()}\n`);
    console.log(`  written to ${flags[out + 1]}`);
  } else if (flags.includes('--text')) {
    console.log(text());
  }
}
