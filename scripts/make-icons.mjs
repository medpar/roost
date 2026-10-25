// Renders the Roost icon (orange tile, white bookmark ribbon with a perched
// bird silhouette) to PNGs without any dependencies. Run: node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const ORANGE = [210, 74, 18];
const WHITE = [255, 255, 255];

// Shapes in a 0..1 unit square.
function insideTile(x, y) {
  const r = 0.22;
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Bookmark ribbon with a notch at the bottom.
const ribbon = [[0.3, 0.2], [0.7, 0.2], [0.7, 0.82], [0.5, 0.66], [0.3, 0.82]];

function insideRibbon(x, y) {
  const r = 0.05;
  if (y < 0.2 + r) {
    if (x < 0.3 + r) return (x - 0.3 - r) ** 2 + (y - 0.2 - r) ** 2 <= r * r;
    if (x > 0.7 - r) return (x - 0.7 + r) ** 2 + (y - 0.2 - r) ** 2 <= r * r;
  }
  return pointInPoly(x, y, ribbon);
}

// Small orange dot (the "bird") inside the ribbon.
const insideDot = (x, y) => (x - 0.5) ** 2 + (y - 0.4) ** 2 <= 0.075 ** 2;

function color(x, y, maskable = false) {
  if (maskable) {
    // Full-bleed tile, ribbon shrunk into the 80% safe zone.
    const s = 0.72;
    const u = (x - 0.5) / s + 0.5;
    const v = (y - 0.5) / s + 0.5;
    return insideRibbon(u, v) && !insideDot(u, v) ? WHITE : ORANGE;
  }
  if (!insideTile(x, y)) return null;
  if (insideRibbon(x, y) && !insideDot(x, y)) return WHITE;
  return ORANGE;
}

function render(size, maskable = false) {
  const ss = 4;
  const px = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let pxl = 0; pxl < size; pxl++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = color((pxl + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size, maskable);
          if (!c) continue;
          r += c[0]; g += c[1]; b += c[2]; a++;
        }
      }
      const i = (py * size + pxl) * 4;
      if (a) {
        px[i] = Math.round(r / a); px[i + 1] = Math.round(g / a); px[i + 2] = Math.round(b / a);
        px[i + 3] = Math.round((a / (ss * ss)) * 255);
      }
    }
  }
  return png(size, size, px);
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const out = new URL('../extension/icons/', import.meta.url);
mkdirSync(out, { recursive: true });
for (const s of [16, 32, 48, 128]) writeFileSync(new URL(`icon${s}.png`, out), render(s));
writeFileSync(new URL('../docs/icon.png', import.meta.url), render(256));

const web = new URL('../web/public/icons/', import.meta.url);
mkdirSync(web, { recursive: true });
writeFileSync(new URL('icon-192.png', web), render(192));
writeFileSync(new URL('icon-512.png', web), render(512));
writeFileSync(new URL('maskable-512.png', web), render(512, true));
writeFileSync(new URL('apple-touch-icon.png', web), render(180, true));
writeFileSync(
  new URL('logo.svg', web),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="#d24a12"/><path d="M30 25a5 5 0 0 1 5-5h30a5 5 0 0 1 5 5v57L50 66 30 82z" fill="#fff"/><circle cx="50" cy="40" r="7.5" fill="#d24a12"/></svg>\n`,
);
console.log('icons written');
