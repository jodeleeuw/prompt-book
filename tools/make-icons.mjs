// Generates the app icons. Run with `npm run icons`; the PNGs it writes are
// committed, so a normal build never depends on this script.
//
// The mark is a page from a script with one line lit — the line you are being
// prompted with. Drawn from rectangles at 4x and averaged down, which is
// cheaper than carrying an image dependency for five small files.

import zlib from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../public/icons');
const SS = 4; // supersampling factor: the only source of anti-aliasing here

const INK = [0x17, 0x16, 0x14, 0xff];
const PAPER = [0xf7, 0xf4, 0xee, 0xff];
const RULE = [0xcb, 0xc2, 0xb4, 0xff];
const ACCENT = [0xb4, 0x48, 0x2f, 0xff];

// ---- PNG encoding ----------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // compression, filter and interlace all stay 0

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type: none
    Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- drawing ---------------------------------------------------------------

const canvas = (size) => ({ size, px: new Uint8Array(size * size * 4) });

function fillRoundRect(c, x, y, w, h, r, colour) {
  const radius = Math.min(r, w / 2, h / 2);
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(c.size, Math.ceil(x + w));
  const y1 = Math.min(c.size, Math.ceil(y + h));

  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      // Distance into the corner arc, if this pixel is in a corner at all.
      const dx = Math.max(x + radius - px, px - (x + w - radius), 0);
      const dy = Math.max(y + radius - py, py - (y + h - radius), 0);
      if (dx * dx + dy * dy > radius * radius) continue;

      const i = (py * c.size + px) * 4;
      c.px.set(colour, i);
    }
  }
}

/** Average each SS x SS block down to one pixel. */
function downsample(c, target) {
  const out = new Uint8Array(target * target * 4);
  const factor = c.size / target;
  for (let y = 0; y < target; y++) {
    for (let x = 0; x < target; x++) {
      const sums = [0, 0, 0, 0];
      for (let sy = 0; sy < factor; sy++) {
        for (let sx = 0; sx < factor; sx++) {
          const i = ((y * factor + sy) * c.size + (x * factor + sx)) * 4;
          for (let k = 0; k < 4; k++) sums[k] += c.px[i + k];
        }
      }
      const i = (y * target + x) * 4;
      for (let k = 0; k < 4; k++) out[i + k] = Math.round(sums[k] / (factor * factor));
    }
  }
  return out;
}

/**
 * @param inset   how far the artwork sits from the edge, as a fraction.
 *                Maskable icons need a wide margin because the platform crops
 *                to its own shape; ordinary icons look better nearly full.
 * @param rounded whether the field itself has rounded corners. Maskable icons
 *                must fill the square, so they do not.
 */
function drawMark(size, { inset = 0, rounded = true } = {}) {
  const c = canvas(size * SS);
  const S = size * SS;
  const u = (fraction) => fraction * S;

  fillRoundRect(c, 0, 0, S, S, rounded ? u(0.22) : 0, INK);

  // A page, and the lines on it.
  const pad = inset * S;
  const pw = S - pad * 2;
  const page = { x: pad + pw * 0.2, y: pad + pw * 0.14, w: pw * 0.6, h: pw * 0.72 };
  fillRoundRect(c, page.x, page.y, page.w, page.h, pw * 0.045, PAPER);

  const ruleX = page.x + page.w * 0.14;
  const ruleW = page.w * 0.72;
  const ruleH = page.h * 0.075;
  const gap = page.h * 0.155;
  const top = page.y + page.h * 0.18;

  for (let i = 0; i < 4; i++) {
    const lit = i === 1; // the line being prompted
    fillRoundRect(
      c,
      ruleX,
      top + gap * i,
      i === 3 ? ruleW * 0.55 : ruleW, // a short last line, as a page ends
      ruleH,
      ruleH / 2,
      lit ? ACCENT : RULE,
    );
  }

  return downsample(c, size);
}

// ---- output ----------------------------------------------------------------

const ICONS = [
  { file: 'icon-192.png', size: 192, options: { inset: 0.13 } },
  { file: 'icon-512.png', size: 512, options: { inset: 0.13 } },
  { file: 'icon-maskable-512.png', size: 512, options: { inset: 0.22, rounded: false } },
  { file: 'apple-touch-icon.png', size: 180, options: { inset: 0.13 } },
  { file: 'favicon-32.png', size: 32, options: { inset: 0.08 } },
];

mkdirSync(OUT, { recursive: true });
for (const { file, size, options } of ICONS) {
  writeFileSync(resolve(OUT, file), encodePng(size, size, drawMark(size, options)));
  console.log(`${file}  ${size}x${size}`);
}
