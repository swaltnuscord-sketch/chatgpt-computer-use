import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import zlib from 'zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const iconsDir = path.join(__dirname, 'icons');

if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

/**
 * Minimal uncompressed RGBA PNG generator
 */
function createPng(width, height, drawPixelFn) {
  const rowBytes = width * 4;
  const rawData = Buffer.alloc(height * (rowBytes + 1));

  for (let y = 0; y < height; y++) {
    const rowOffset = y * (rowBytes + 1);
    rawData[rowOffset] = 0; // Filter type 0 (None)

    for (let x = 0; x < width; x++) {
      const pixelOffset = rowOffset + 1 + x * 4;
      const [r, g, b, a] = drawPixelFn(x, y, width, height);
      rawData[pixelOffset] = r;
      rawData[pixelOffset + 1] = g;
      rawData[pixelOffset + 2] = b;
      rawData[pixelOffset + 3] = a;
    }
  }

  const compressed = zlib.deflateSync(rawData);

  // PNG Signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR Chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const ihdrChunk = createChunk('IHDR', ihdr);

  // IDAT Chunk
  const idatChunk = createChunk('IDAT', compressed);

  // IEND Chunk
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createChunk(type, data) {
  const len = data.length;
  const buf = Buffer.alloc(12 + len);
  buf.writeUInt32BE(len, 0);
  buf.write(type, 4);
  data.copy(buf, 8);

  const crc = crc32(buf.subarray(4, 8 + len));
  buf.writeUInt32BE(crc >>> 0, 8 + len);
  return buf;
}

// CRC32 Table
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return c ^ 0xffffffff;
}

// Draw a sleek modern bot/circuit icon with cyan & purple gradient
function botIconPainter(x, y, w, h) {
  const cx = w / 2;
  const cy = h / 2;
  const dist = Math.hypot(x - cx, y - cy);
  const radius = w * 0.45;

  if (dist > radius) {
    return [0, 0, 0, 0]; // Transparent outside circle
  }

  // Gradient background from cyan (#38bdf8) to indigo (#6366f1)
  const factor = (x + y) / (w + h);
  const r = Math.round(56 + factor * (99 - 56));
  const g = Math.round(189 + factor * (102 - 189));
  const b = Math.round(248 + factor * (241 - 248));

  // Inner white robot eye/dot
  const eyeDist = Math.hypot(x - cx, y - cy);
  if (eyeDist < radius * 0.35) {
    return [255, 255, 255, 255];
  }

  return [r, g, b, 255];
}

for (const size of [16, 48, 128]) {
  const pngBuf = createPng(size, size, botIconPainter);
  fs.writeFileSync(path.join(iconsDir, `icon${size}.png`), pngBuf);
  console.log(`Generated icon${size}.png (${pngBuf.length} bytes)`);
}
