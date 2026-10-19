import { inflateSync } from 'node:zlib';

/*
 * Checks on the signature PNG a signer's browser sends, made on the raw
 * bytes before the PDF renderer sees them. The renderer (react-pdf, through
 * png-js) unpacks every pixel into memory, so the compressed size says
 * little: an 8000 × 8000 blank PNG is about 250 KB and takes over a
 * gigabyte to render, which kills the server. A failed render saves
 * nothing, so the per-booking cap on signatures never stops it repeating.
 *
 * The pad (src/components/waiver/SignaturePad.tsx) is its box's width by
 * 170px, at up to 2× pixel density. On the signing page, 42rem wide, that's
 * at most about 1,130 × 340. The limits leave room for a larger default
 * text size, which widens the page. Server-side only (node:zlib).
 */
const MAX_SIGNATURE_WIDTH = 4000;
const MAX_SIGNATURE_HEIGHT = 800;
const MAX_SIGNATURE_PIXELS = 2_000_000;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Whether `png` is a PNG the pad could have drawn: within the limits above,
 * and with no more image data than that size holds (a small image can carry
 * data that unpacks to hundreds of megabytes). The chunk walk refuses
 * anything png-js would read differently from it: a second IHDR (png-js
 * uses the last one), a chunk running past the end, or a tRNS chunk png-js
 * skips without reading.
 */
export function isPadSizedPng(png: Buffer): boolean {
  if (png.length < 33 || !png.subarray(0, 8).equals(PNG_MAGIC)) return false;
  // IHDR comes first, 13 bytes: width, height, bit depth, colour type, …
  if (png.readUInt32BE(8) !== 13 || png.toString('latin1', 12, 16) !== 'IHDR') return false;
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (width === 0 || height === 0) return false;
  if (width > MAX_SIGNATURE_WIDTH || height > MAX_SIGNATURE_HEIGHT || width * height > MAX_SIGNATURE_PIXELS) {
    return false;
  }
  const colorType = png[25];

  const idat: Buffer[] = [];
  for (let pos = 33; ; ) {
    if (pos + 12 > png.length) return false;
    const length = png.readUInt32BE(pos);
    const type = png.toString('latin1', pos + 4, pos + 8);
    const next = pos + 12 + length;
    if (next > png.length || type === 'IHDR') return false;
    if (type === 'tRNS' && colorType !== 0 && colorType !== 2 && colorType !== 3) return false;
    if (type === 'IDAT') idat.push(png.subarray(pos + 8, pos + 8 + length));
    if (type === 'IEND') break;
    pos = next;
  }

  try {
    // Unpacked, each row is a filter byte and at most 8 bytes a pixel
    // (16-bit RGBA); interlacing adds a few more filter bytes.
    inflateSync(Buffer.concat(idat), { maxOutputLength: (width * 8 + 2) * height });
  } catch {
    return false;
  }
  return true;
}
