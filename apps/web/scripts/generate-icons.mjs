// Generates the four icon files apps/web/src/seo/head.ts and jsonld.ts
// already reference but which apps/web/public/ never carried — a
// prerendered page that 404s four times over. One-off generator, run with
// `node apps/web/scripts/generate-icons.mjs`; its output is committed, not
// regenerated at build time.
//
// SEO-14: "the favicon is the wordmark's first letter in cream on voltage,
// and that is enough" (DESIGN.md records that no mark exists yet). No image
// library: a PNG is eight lines of zlib + a hand-rolled CRC32 (the same
// shape apps/web/test/seo.test.ts already reads og.png's IHDR with), and an
// ICO is a six-field directory wrapping that same PNG — valid since Vista.
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Buffer } from "node:buffer";
import console from "node:console";

const PUBLIC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../public");

// DESIGN.md tokens (apps/web/src/styles/tokens.css).
const VOLTAGE = [0xe2, 0x4c, 0x18];
const CREAM = [0xff, 0xfb, 0xf5];

// A geometric "P": a full-height stem plus a bowl occupying the top half,
// open at the bottom-right — 4 columns x 7 rows, scaled to whatever size is
// asked for. Blocky by design: a favicon is read at 16px, not admired.
const GLYPH = [
  [1, 1, 1, 1],
  [1, 0, 0, 1],
  [1, 0, 0, 1],
  [1, 1, 1, 1],
  [1, 0, 0, 0],
  [1, 0, 0, 0],
  [1, 0, 0, 0],
];

function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    rgba[i * 4] = VOLTAGE[0];
    rgba[i * 4 + 1] = VOLTAGE[1];
    rgba[i * 4 + 2] = VOLTAGE[2];
    rgba[i * 4 + 3] = 255;
  }

  const cols = GLYPH[0].length;
  const rows = GLYPH.length;
  const margin = size * 0.24;
  const boxW = size - margin * 2;
  const boxH = boxW * (rows / cols);
  const offsetY = (size - boxH) / 2;
  const cellW = boxW / cols;
  const cellH = boxH / rows;

  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      if (!GLYPH[gy][gx]) continue;
      const x0 = Math.round(margin + gx * cellW);
      const x1 = Math.round(margin + (gx + 1) * cellW);
      const y0 = Math.round(offsetY + gy * cellH);
      const y1 = Math.round(offsetY + (gy + 1) * cellH);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const idx = (y * size + x) * 4;
          rgba[idx] = CREAM[0];
          rgba[idx + 1] = CREAM[1];
          rgba[idx + 2] = CREAM[2];
          rgba[idx + 3] = 255;
        }
      }
    }
  }
  return rgba;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // bytes 10-12 (compression/filter/interlace) default to 0, already zeroed.

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }

  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ICO container wrapping one PNG image — valid since Windows Vista, and the
// format every browser still reads a .ico as.
function encodeIco(size, pngBuffer) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // one image

  const entry = Buffer.alloc(16);
  entry[0] = size >= 256 ? 0 : size;
  entry[1] = size >= 256 ? 0 : size;
  entry.writeUInt16LE(1, 4); // colour planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(pngBuffer.length, 8);
  entry.writeUInt32LE(header.length + entry.length, 12); // offset

  return Buffer.concat([header, entry, pngBuffer]);
}

function favicon() {
  const [vr, vg, vb] = VOLTAGE.map((n) => n.toString(16).padStart(2, "0"));
  const [cr, cg, cb] = CREAM.map((n) => n.toString(16).padStart(2, "0"));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-label="Pariksha">
  <rect width="32" height="32" fill="#${vr}${vg}${vb}"/>
  <text x="16" y="23" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="21" fill="#${cr}${cg}${cb}">P</text>
</svg>
`;
}

writeFileSync(resolve(PUBLIC_DIR, "favicon.svg"), favicon());
writeFileSync(resolve(PUBLIC_DIR, "favicon.ico"), encodeIco(32, encodePng(32, drawIcon(32))));
writeFileSync(resolve(PUBLIC_DIR, "apple-touch-icon.png"), encodePng(180, drawIcon(180)));
writeFileSync(resolve(PUBLIC_DIR, "icon-512.png"), encodePng(512, drawIcon(512)));

console.log("Wrote favicon.svg, favicon.ico, apple-touch-icon.png, icon-512.png to", PUBLIC_DIR);
