import { deflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

/**
 * @param {Buffer} buffer
 * @returns {number} unsigned CRC-32
 */
function crc32(buffer) {
  let c = -1;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/**
 * @param {string} type four-character chunk name
 * @param {Buffer} data
 * @returns {Buffer}
 */
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);

  return Buffer.concat([head, data, crc]);
}

/**
 * Build the IHDR, PLTE and optional tRNS payloads shared by still and animated
 * images.
 *
 * @param {{ width: number, height: number,
 *           palette: ReadonlyArray<readonly [number, number, number]>,
 *           transparentIndex?: number }} options
 */
function headerChunks({ width, height, palette, transparentIndex }) {
  if (palette.length === 0 || palette.length > 256) {
    throw new Error(`palette must hold 1-256 colours, got ${palette.length}`);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 3; // colour type: indexed
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const plte = Buffer.alloc(palette.length * 3);
  palette.forEach(([r, g, b], i) => {
    plte[i * 3] = r;
    plte[i * 3 + 1] = g;
    plte[i * 3 + 2] = b;
  });

  // tRNS lists alpha for palette entries from index 0; anything past its end is
  // opaque, so it only needs to reach the transparent entry.
  let trns = null;
  if (transparentIndex !== undefined) {
    if (transparentIndex < 0 || transparentIndex >= palette.length) {
      throw new Error(`transparentIndex ${transparentIndex} is outside the palette`);
    }
    trns = Buffer.alloc(transparentIndex + 1, 0xff);
    trns[transparentIndex] = 0x00;
  }

  return { ihdr, plte, trns };
}

/**
 * Prefix each row with its filter type. Filter 0 (None) compresses well for
 * flat-colour images and keeps the encoder simple.
 *
 * @param {Uint8Array} pixels @param {number} width @param {number} height
 * @returns {Buffer}
 */
function scanlines(pixels, width, height) {
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0;
    raw.set(pixels.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  }
  return raw;
}

/**
 * Encode an 8-bit palette-indexed PNG.
 *
 * Indexed colour is a natural fit for AGI's 16-colour screens: the output is
 * exact, small, and keeps the original colour indices intact.
 *
 * @param {object} image
 * @param {number} image.width
 * @param {number} image.height
 * @param {Uint8Array} image.pixels  one palette index per pixel, row-major
 * @param {ReadonlyArray<readonly [number, number, number]>} image.palette up to 256 RGB entries
 * @param {number} [image.transparentIndex] palette entry to render fully transparent
 * @returns {Buffer}
 */
export function encodeIndexedPng({ width, height, pixels, palette, transparentIndex }) {
  if (pixels.length !== width * height) {
    throw new Error(`pixel buffer is ${pixels.length} bytes, expected ${width * height}`);
  }
  const { ihdr, plte, trns } = headerChunks({ width, height, palette, transparentIndex });
  const raw = scanlines(pixels, width, height);

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('PLTE', plte),
    ...(trns ? [chunk('tRNS', trns)] : []),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Encode an animated PNG (APNG).
 *
 * Every frame covers the whole canvas and replaces what came before, which
 * keeps transparent regions transparent instead of smearing earlier frames
 * through them. Viewers that do not understand APNG fall back to showing the
 * first frame, which is a reasonable still image of the animation.
 *
 * @param {object} animation
 * @param {number} animation.width
 * @param {number} animation.height
 * @param {Uint8Array[]} animation.frames one palette-index buffer per frame
 * @param {ReadonlyArray<readonly [number, number, number]>} animation.palette
 * @param {number} [animation.transparentIndex]
 * @param {number} [animation.delayNumerator]   frame delay, numerator (default 1)
 * @param {number} [animation.delayDenominator] frame delay, denominator (default 10)
 * @param {number} [animation.plays]            0 (the default) loops forever
 * @returns {Buffer}
 */
export function encodeIndexedApng({
  width,
  height,
  frames,
  palette,
  transparentIndex,
  delayNumerator = 1,
  delayDenominator = 10,
  plays = 0,
}) {
  if (frames.length === 0) throw new Error('an animation needs at least one frame');

  const { ihdr, plte, trns } = headerChunks({ width, height, palette, transparentIndex });

  const actl = Buffer.alloc(8);
  actl.writeUInt32BE(frames.length, 0);
  actl.writeUInt32BE(plays, 4);

  /** Frame control chunk. Sequence numbers run across fcTL and fdAT together. */
  const fctl = (sequence) => {
    const data = Buffer.alloc(26);
    data.writeUInt32BE(sequence, 0);
    data.writeUInt32BE(width, 4);
    data.writeUInt32BE(height, 8);
    data.writeUInt32BE(0, 12); // x offset
    data.writeUInt32BE(0, 16); // y offset
    data.writeUInt16BE(delayNumerator, 20);
    data.writeUInt16BE(delayDenominator, 22);
    data[24] = 0; // dispose: leave the canvas as-is
    data[25] = 0; // blend: source, so this frame replaces what is under it
    return chunk('fcTL', data);
  };

  const parts = [
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('acTL', actl),
    chunk('PLTE', plte),
    ...(trns ? [chunk('tRNS', trns)] : []),
  ];

  let sequence = 0;
  frames.forEach((pixels, index) => {
    const compressed = deflateSync(scanlines(pixels, width, height), { level: 9 });
    parts.push(fctl(sequence++));

    if (index === 0) {
      // The first frame is the image the PNG itself shows.
      parts.push(chunk('IDAT', compressed));
    } else {
      const fdat = Buffer.alloc(4 + compressed.length);
      fdat.writeUInt32BE(sequence++, 0);
      compressed.copy(fdat, 4);
      parts.push(chunk('fdAT', fdat));
    }
  });

  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

/**
 * Scale a paletted image by whole-pixel replication.
 *
 * @param {Uint8Array} pixels
 * @param {number} width
 * @param {number} height
 * @param {number} scaleX
 * @param {number} scaleY
 * @returns {{ width: number, height: number, pixels: Uint8Array }}
 */
export function scalePixels(pixels, width, height, scaleX, scaleY) {
  if (scaleX === 1 && scaleY === 1) return { width, height, pixels };

  const outWidth = width * scaleX;
  const outHeight = height * scaleY;
  const out = new Uint8Array(outWidth * outHeight);

  for (let y = 0; y < height; y++) {
    const row = new Uint8Array(outWidth);
    for (let x = 0; x < width; x++) {
      row.fill(pixels[y * width + x], x * scaleX, (x + 1) * scaleX);
    }
    for (let sy = 0; sy < scaleY; sy++) {
      out.set(row, (y * scaleY + sy) * outWidth);
    }
  }

  return { width: outWidth, height: outHeight, pixels: out };
}
