// Renders build/icon.png (1024²): a graphite tile carrying the island pill.
// Pure Node — signed-distance shapes with analytic anti-aliasing, no deps.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const S = 1024;
const px = new Float32Array(S * S * 4); // straight RGBA, 0..1

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const mix = (a, b, t) => a + (b - a) * t;
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

function roundRectSDF(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - (hw - r);
  const qy = Math.abs(y - cy) - (hh - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function blend(i, r, g, b, a) {
  if (a <= 0) return;
  const da = px[i + 3];
  const oa = a + da * (1 - a);
  px[i] = (r * a + px[i] * da * (1 - a)) / oa;
  px[i + 1] = (g * a + px[i + 1] * da * (1 - a)) / oa;
  px[i + 2] = (b * a + px[i + 2] * da * (1 - a)) / oa;
  px[i + 3] = oa;
}

// Paint a shape given its SDF; colour(x, y) returns [r, g, b, a].
function paint(sdf, colour, soft = 1) {
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const d = sdf(x + 0.5, y + 0.5);
      const cover = clamp(0.5 - d / soft);
      if (cover <= 0) continue;
      const [r, g, b, a] = colour(x + 0.5, y + 0.5);
      blend((y * S + x) * 4, r, g, b, a * cover);
    }
  }
}

const tile = { cx: S / 2, cy: S / 2, hw: S * 0.44, hh: S * 0.44, r: S * 0.2 };
const tileSDF = (x, y) => roundRectSDF(x, y, tile.cx, tile.cy, tile.hw, tile.hh, tile.r);

// Tile: graphite with a soft light from the top.
const top = hex('#34343b');
const bottom = hex('#0d0d10');
paint(tileSDF, (x, y) => {
  const t = clamp((y - (tile.cy - tile.hh)) / (tile.hh * 2));
  const glow = Math.exp(-(((x - S * 0.32) / (S * 0.42)) ** 2 + ((y - S * 0.12) / (S * 0.32)) ** 2)) * 0.08;
  return [mix(top[0], bottom[0], t) + glow, mix(top[1], bottom[1], t) + glow, mix(top[2], bottom[2], t) + glow, 1];
});
// Hairline rim.
paint((x, y) => Math.abs(tileSDF(x, y) + 2) - 1.5, (x, y) => [1, 1, 1, 0.1 * (1 - clamp((y - S * 0.1) / (S * 0.8)))]);

// Pill shadow, pill, inner rim.
const pill = { cx: S / 2, cy: S * 0.5, hw: S * 0.31, hh: S * 0.1 };
const pillSDF = (x, y) => roundRectSDF(x, y, pill.cx, pill.cy, pill.hw, pill.hh, pill.hh);
paint((x, y) => pillSDF(x, y - S * 0.02), () => [0, 0, 0, 0.55], S * 0.045);
paint(pillSDF, () => [0, 0, 0, 1]);
paint((x, y) => Math.abs(pillSDF(x, y) + 2.5) - 1.6, (x, y) => [1, 1, 1, 0.07 + 0.08 * clamp((pill.cy - y) / pill.hh)]);

// Album art: warm gradient tile on the left.
const art = { cx: pill.cx - pill.hw + pill.hh, cy: pill.cy, h: pill.hh * 0.62 };
const c1 = hex('#ff8a4c');
const c2 = hex('#e8457f');
const c3 = hex('#6d4bff');
paint(
  (x, y) => roundRectSDF(x, y, art.cx, art.cy, art.h, art.h, art.h * 0.34),
  (x, y) => {
    const t = clamp((x - art.cx + art.h + (y - art.cy + art.h)) / (art.h * 4));
    const c = t < 0.5 ? c1.map((v, i) => mix(c3[i], v, t * 2)) : c1.map((v, i) => mix(v, c2[i], (t - 0.5) * 2));
    return [...c, 1];
  },
);

// Equalizer bars on the right.
const heights = [0.42, 0.78, 0.56, 0.95];
const barW = S * 0.026;
const gap = S * 0.018;
const startX = pill.cx + pill.hw - pill.hh * 0.95 - (heights.length * barW + (heights.length - 1) * gap);
heights.forEach((h, i) => {
  const cx = startX + i * (barW + gap) + barW / 2;
  const hh = pill.hh * 0.6 * h;
  paint((x, y) => roundRectSDF(x, y, cx, pill.cy, barW / 2, hh, barW / 2), () => [...hex('#ff9a7a'), 1]);
});

// Encode PNG.
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0;
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    const o = y * (S * 4 + 1) + 1 + x * 4;
    raw[o] = Math.round(clamp(px[i]) * 255);
    raw[o + 1] = Math.round(clamp(px[i + 1]) * 255);
    raw[o + 2] = Math.round(clamp(px[i + 2]) * 255);
    raw[o + 3] = Math.round(clamp(px[i + 3]) * 255);
  }
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body));
  return Buffer.concat([len, body, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
const out = path.join(__dirname, '..', 'build', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log(`wrote ${out} (${(png.length / 1024).toFixed(0)} KB)`);
