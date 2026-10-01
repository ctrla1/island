// Tray icon drawn at runtime: a small black capsule with a soft white rim,
// legible on both light and dark taskbars.
const { nativeImage } = require('electron');

function capsuleBitmap(size) {
  const buf = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const halfW = size * 0.44;
  const halfH = size * 0.2;
  const r = halfH;
  const rim = Math.max(1, size / 18);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = Math.abs(x + 0.5 - cx) - (halfW - r);
      const py = Math.abs(y + 0.5 - cy) - (halfH - r);
      const outside = Math.hypot(Math.max(px, 0), Math.max(py, 0)) + Math.min(Math.max(px, py), 0) - r;
      const cover = Math.max(0, Math.min(1, 0.5 - outside));
      const rimMix = Math.max(0, Math.min(1, outside + rim + 0.5));
      // Skia bitmaps are premultiplied.
      const shade = Math.round((255 * rimMix * 0.92 + 10 * (1 - rimMix)) * cover);
      const i = (y * size + x) * 4;
      buf[i] = shade;
      buf[i + 1] = shade;
      buf[i + 2] = shade;
      buf[i + 3] = Math.round(255 * cover);
    }
  }
  return buf;
}

function trayIcon() {
  const img = nativeImage.createEmpty();
  for (const [size, scale] of [[16, 1], [24, 1.5], [32, 2]]) {
    img.addRepresentation({ scaleFactor: scale, width: size, height: size, buffer: capsuleBitmap(size) });
  }
  return img;
}

module.exports = { trayIcon };
