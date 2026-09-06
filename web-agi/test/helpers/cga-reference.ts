/**
 * The one CGA capture of the original, and how it was taken.
 *
 * M16 built the four-colour mode out of `CGA_GRAF.OVL` and `AGIDATA.OVL` alone
 * and recorded that nothing checked it: of the captures this project had, none
 * was a CGA screen, which made CGA the least verified of the four modes. It was also, it turned out, the wrong one -- M16
 * read the 16-byte table at `0x1bb8` as the four-colour picture table, and the
 * interpreter does not use it for the picture at all.
 *
 * ## How the capture was taken
 *
 * The game itself, not an emulator's idea of it. `agi-extract/data/kq1` is a
 * complete 2.917 install -- loader, interpreter, overlays and volumes -- so it
 * runs:
 *
 * ```text
 * dosbox-x -conf ...      machine=cga, the directory mounted, KQ1.COM
 * autotype                enter x5 to reach room 1, then esc
 * screencapture           the whole screen, cropped to the CGA-coloured area
 * ```
 *
 * On a CGA the game starts in the *640x200 two-colour* mode -- the one M19
 * simulates as a composite monitor -- because `CGA_GRAF.OVL` takes that branch
 * when its flag is zero. The four-colour mode is what "Graphics Mode <Ctrl-R>"
 * reaches, and the capture is in it.
 *
 * The file is stored quantised: every pixel is one of the four palette entries
 * exactly, so a sampling grid does not have to be re-fitted to read it. The
 * menu was open when it was taken and its overlay is not in the game's picture
 * data, so {@link MENU} says where to stop comparing.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

import { CGA_PALETTE_RGB } from '../../src/render/drivers/cga.ts';

/** Anchored to this file, so moving the game's copy cannot silently skip. */
export const CAPTURE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'captures',
  'kq1-cga-castle.png',
);

/** King's Quest I, picture 1: the castle, the tree and the bridge. */
export const PICTURE = 1;

/**
 * The open menu, in AGI pixels, which the game's picture data does not contain.
 *
 * Rows and columns of the 160x168 visual screen, not of the display.
 */
export const MENU = { rows: 30, columns: 42 } as const;

/**
 * How much of the capture the driver reproduces, measured when M20 landed.
 *
 * 51,240 display pixels compared -- the picture outside the menu, which is
 * 25,620 AGI pixels doubled -- of which 485 differ. Those are the ego, which
 * the capture has and a bare picture does not, and the sampling edges. The
 * 16-byte table this driver used before reproduced 16.4% of the same pixels,
 * which is about what agreeing on the solid colours alone is worth.
 */
export const AGREEMENT = { measured: 0.9905, floor: 0.98, wasBefore: 0.164 } as const;

/** A decoded image: 8-bit RGB, row-major, no alpha. */
export interface Decoded {
  readonly width: number;
  readonly height: number;
  readonly rgb: Uint8Array;
}

/**
 * Enough of a PNG reader for one file this repository wrote itself.
 *
 * Eight-bit truecolour, non-interlaced, which is what the capture is. Anything
 * else throws rather than being half read.
 */
export function decodePng(bytes: Uint8Array): Decoded {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (const [i, byte] of SIGNATURE.entries()) {
    if (bytes[i] !== byte) throw new Error('not a PNG');
  }

  let at = 8;
  let width = 0;
  let height = 0;
  const parts: Uint8Array[] = [];

  while (at < bytes.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const data = bytes.subarray(at + 8, at + 8 + length);

    if (type === 'IHDR') {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      const [depth, colour, , , interlace] = [...data.subarray(8, 13)];
      if (depth !== 8 || colour !== 2 || interlace !== 0) {
        throw new Error(`unsupported PNG: depth ${depth}, colour type ${colour}`);
      }
    } else if (type === 'IDAT') {
      parts.push(data);
    } else if (type === 'IEND') {
      break;
    }

    at += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(parts));
  const stride = width * 3;
  const rgb = new Uint8Array(height * stride);

  // Undo the per-row filters. Only the five the format defines.
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);

    for (let x = 0; x < stride; x++) {
      const a = x >= 3 ? rgb[y * stride + x - 3]! : 0;
      const b = y > 0 ? rgb[(y - 1) * stride + x]! : 0;
      const c = x >= 3 && y > 0 ? rgb[(y - 1) * stride + x - 3]! : 0;

      let prior = 0;
      switch (filter) {
        case 0: prior = 0; break;
        case 1: prior = a; break;
        case 2: prior = b; break;
        case 3: prior = (a + b) >> 1; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          prior = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
        default: throw new Error(`unknown PNG filter ${filter} on row ${y}`);
      }

      rgb[y * stride + x] = (line[x]! + prior) & 0xff;
    }
  }

  return { width, height, rgb };
}

/**
 * The capture as CGA colour indices, one per display pixel.
 *
 * Every pixel of the stored file is one of the four exactly, so a colour that
 * is not one of them is a corrupt file rather than something to round.
 */
export function readCapture(): { width: number; height: number; pixels: Uint8Array } {
  const { width, height, rgb } = decodePng(readFileSync(CAPTURE));
  const pixels = new Uint8Array(width * height);

  for (let i = 0; i < pixels.length; i++) {
    const [r, g, b] = [rgb[i * 3]!, rgb[i * 3 + 1]!, rgb[i * 3 + 2]!];
    let found = -1;
    for (let colour = 0; colour < 4; colour++) {
      if (
        CGA_PALETTE_RGB[colour * 3] === r
        && CGA_PALETTE_RGB[colour * 3 + 1] === g
        && CGA_PALETTE_RGB[colour * 3 + 2] === b
      ) {
        found = colour;
        break;
      }
    }
    if (found < 0) throw new Error(`capture pixel ${i} is ${r},${g},${b}, not a CGA colour`);
    pixels[i] = found;
  }

  return { width, height, pixels };
}
