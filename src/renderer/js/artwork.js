// Procedural album covers for the demo player, and accent extraction for any artwork.

const PALETTES = [
  { bg: '#16081d', blobs: [['#ff7a45', 0.28, 0.78, 0.62], ['#ff3d7f', 0.78, 0.4, 0.55], ['#5b3cff', 0.18, 0.12, 0.5]], motif: 'sun' },
  { bg: '#031219', blobs: [['#1fb5c9', 0.75, 0.75, 0.6], ['#2a5bd7', 0.2, 0.3, 0.6], ['#8ef0d6', 0.62, 0.18, 0.35]], motif: 'lines' },
  { bg: '#2a1a14', blobs: [['#f2b28a', 0.3, 0.3, 0.6], ['#d9646c', 0.8, 0.75, 0.55], ['#f6e3c5', 0.75, 0.2, 0.4]], motif: 'rings' },
  { bg: '#06060c', blobs: [['#6f5bff', 0.7, 0.3, 0.55], ['#2e2380', 0.25, 0.8, 0.6], ['#c9bcff', 0.32, 0.25, 0.28]], motif: 'orbit' },
];

export function makeCover(index) {
  const p = PALETTES[index % PALETTES.length];
  const size = 360;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');

  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, size, size);

  const blur = document.createElement('canvas');
  blur.width = blur.height = size;
  const b = blur.getContext('2d');
  b.globalCompositeOperation = 'screen';
  for (const [color, x, y, r] of p.blobs) {
    const g = b.createRadialGradient(x * size, y * size, 0, x * size, y * size, r * size);
    g.addColorStop(0, color);
    g.addColorStop(1, 'transparent');
    b.fillStyle = g;
    b.fillRect(0, 0, size, size);
  }
  ctx.filter = 'blur(18px) saturate(1.15)';
  ctx.drawImage(blur, -20, -20, size + 40, size + 40);
  ctx.filter = 'none';

  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 1.5;
  if (p.motif === 'sun') {
    const g = ctx.createLinearGradient(0, size * 0.42, 0, size * 0.78);
    g.addColorStop(0, 'rgba(255,236,214,0.95)');
    g.addColorStop(1, 'rgba(255,170,120,0.2)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(size * 0.5, size * 0.66, size * 0.2, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = 'rgba(22,8,29,0.55)';
    for (let i = 0; i < 4; i++) ctx.fillRect(0, size * (0.6 + i * 0.022), size, 2 + i);
  } else if (p.motif === 'lines') {
    for (let i = 0; i < 9; i++) {
      ctx.globalAlpha = 0.12 + i * 0.05;
      ctx.beginPath();
      ctx.moveTo(size * 0.12, size * (0.3 + i * 0.05));
      ctx.lineTo(size * 0.88, size * (0.22 + i * 0.07));
      ctx.stroke();
    }
  } else if (p.motif === 'rings') {
    for (let i = 0; i < 5; i++) {
      ctx.globalAlpha = 0.65 - i * 0.11;
      ctx.beginPath();
      ctx.arc(size * 0.5, size * 0.52, size * (0.08 + i * 0.055), 0, Math.PI * 2);
      ctx.stroke();
    }
  } else if (p.motif === 'orbit') {
    ctx.globalAlpha = 0.9;
    const g = ctx.createRadialGradient(size * 0.44, size * 0.42, 2, size * 0.5, size * 0.5, size * 0.16);
    g.addColorStop(0, '#f1ecff');
    g.addColorStop(1, '#5d4bd8');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(size * 0.5, size * 0.5, size * 0.14, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.ellipse(size * 0.5, size * 0.5, size * 0.3, size * 0.07, -0.35, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  // Film grain keeps the gradients from banding and reads as printed artwork.
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 18;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL('image/jpeg', 0.92);
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h, s, l) {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const hue = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue(p, q, h + 1 / 3) * 255, hue(p, q, h) * 255, hue(p, q, h - 1 / 3) * 255];
}

// Picks the most characterful colour, then tames it so it reads as a quiet
// accent on black rather than a highlighter.
export function accentFrom(src) {
  return new Promise((resolve) => {
    const fallback = [235, 235, 245];
    if (!src) return resolve(fallback);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = 24;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, 24, 24);
      const d = ctx.getImageData(0, 0, 24, 24).data;
      let r = 0, g = 0, b = 0, w = 0;
      for (let i = 0; i < d.length; i += 4) {
        const [, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
        const weight = s * s * (1 - Math.abs(l - 0.55) * 1.6) + 0.002;
        if (weight <= 0) continue;
        r += d[i] * weight; g += d[i + 1] * weight; b += d[i + 2] * weight; w += weight;
      }
      if (!w) return resolve(fallback);
      const [h, s] = rgbToHsl(r / w, g / w, b / w);
      if (s < 0.12) return resolve(fallback);
      resolve(hslToRgb(h, Math.min(0.72, Math.max(0.35, s)), 0.7).map(Math.round));
    };
    img.onerror = () => resolve(fallback);
    img.src = src;
  });
}
