/**
 * Genera iconos PNG para la PWA usando solo módulos built-in de Node.js.
 * Produce un cuadrado con esquinas redondeadas, fondo violeta #4f46e5 y la letra "S".
 * Colores: bg=#4f46e5 (79,70,229), letra=blanco.
 */
import { writeFileSync, mkdirSync } from 'fs';
import { deflateSync } from 'zlib';

// ── CRC-32 ──────────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const t   = Buffer.from(type, 'ascii');
  const len = Buffer.allocUnsafe(4); len.writeUInt32BE(data.length);
  const crc = Buffer.allocUnsafe(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

// ── Pixel renderer ──────────────────────────────────────────────────────────
// Letra "S" definida en una cuadrícula 5×7 (1=píxel blanco)
const S_GLYPH = [
  [0,1,1,1,0],
  [1,0,0,0,1],
  [1,0,0,0,0],
  [0,1,1,1,0],
  [0,0,0,0,1],
  [1,0,0,0,1],
  [0,1,1,1,0],
];

function createIconPNG(size) {
  // BG color
  const BR = 79, BG = 70, BB = 229;
  const radius = Math.round(size * 0.18); // esquinas redondeadas ~18%

  // Tamaño de la letra S en píxeles (glyph escala)
  const glyphW = 5, glyphH = 7;
  const scale  = Math.floor(size * 0.55 / Math.max(glyphW, glyphH));
  const offX   = Math.round((size - glyphW * scale) / 2);
  const offY   = Math.round((size - glyphH * scale) / 2);

  // Crear buffer RGBA
  const pixels = new Uint8ClampedArray(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;

      // Rounded corners: distancia al corner
      const cx = Math.min(x, size - 1 - x);
      const cy = Math.min(y, size - 1 - y);
      const inCorner = cx < radius && cy < radius;
      const dist     = inCorner ? Math.sqrt((radius - cx - 1) ** 2 + (radius - cy - 1) ** 2) : 0;
      const inBounds  = !inCorner || dist <= radius;

      if (!inBounds) { pixels[idx + 3] = 0; continue; }

      // Letra S
      const gx = Math.floor((x - offX) / scale);
      const gy = Math.floor((y - offY) / scale);
      const inGlyph = gy >= 0 && gy < glyphH && gx >= 0 && gx < glyphW && S_GLYPH[gy][gx] === 1;

      pixels[idx]     = inGlyph ? 255 : BR;
      pixels[idx + 1] = inGlyph ? 255 : BG;
      pixels[idx + 2] = inGlyph ? 255 : BB;
      pixels[idx + 3] = 255;
    }
  }

  // Raw PNG rows: filter byte 0 + RGBA per pixel
  const raw = Buffer.allocUnsafe(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    raw[y * (1 + size * 4)] = 0; // filter None
    for (let x = 0; x < size; x++) {
      const si = (y * size + x) * 4;
      const di = y * (1 + size * 4) + 1 + x * 4;
      raw[di]     = pixels[si];
      raw[di + 1] = pixels[si + 1];
      raw[di + 2] = pixels[si + 2];
      raw[di + 3] = pixels[si + 3];
    }
  }

  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = ihdr[11] = ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Generar archivos ─────────────────────────────────────────────────────────
mkdirSync('public/icons', { recursive: true });

for (const size of [192, 512]) {
  const path = `public/icons/icon-${size}.png`;
  writeFileSync(path, createIconPNG(size));
  console.log(`  ✓ ${path} (${size}x${size})`);
}

console.log('Icons generados.');
