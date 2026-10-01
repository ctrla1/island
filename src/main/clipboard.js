// Clipboard history: watches the Win32 clipboard sequence number and keeps
// the last few entries in memory only (never written to disk).
// Electron 44 exposes the async, W3C-style clipboard API.
const { clipboard, ClipboardItem, nativeImage } = require('electron');
const { EventEmitter } = require('events');
const { clipboardSequence } = require('./win32');

const MAX_ITEMS = 10;
const MAX_IMAGES = 4;
const MAX_TEXT = 4000;

const COLOR_RE = /^(#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|rgba?\([^)]+\)|hsla?\([^)]+\))$/i;
const URL_RE = /^(https?:\/\/|www\.)[^\s]+$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const CODE_RE = /(^\s*(const|let|var|function|import|export|def|class|return|if|for|SELECT|<\w+)[\s(])|[{};]\s*$|=>|\)\s*\{/m;

const RAW = (format) => `electron application/osclipboard;format="${format}"`;

function classify(text) {
  const t = text.trim();
  if (COLOR_RE.test(t)) return 'color';
  if (URL_RE.test(t)) return 'link';
  if (EMAIL_RE.test(t)) return 'email';
  if (t.includes('\n') && CODE_RE.test(t)) return 'code';
  if (!t.includes(' ') && CODE_RE.test(t) && t.length > 12) return 'code';
  return 'text';
}

class ClipboardHistory extends EventEmitter {
  constructor() {
    super();
    this.items = [];
    this.seq = clipboardSequence();
    this.selfSeq = -1;
    this.nextId = 1;
    this.timer = null;
    this.busy = false;
  }

  start() {
    this.timer = setInterval(() => this.poll(), 220);
  }

  stop() {
    clearInterval(this.timer);
  }

  poll() {
    if (this.busy || this.muted) return;
    const seq = clipboardSequence();
    if (seq === this.seq) return;
    this.seq = seq;
    const own = seq === this.selfSeq;
    this.busy = true;
    // Give the owning app a beat to finish writing every format.
    setTimeout(() => {
      this.capture(own)
        .catch((err) => this.emit('log', `clipboard: ${err.message}`))
        .finally(() => { this.busy = false; });
    }, 40);
  }

  // Password managers flag secrets with these registered formats.
  async isExcluded(items) {
    try {
      if (await clipboard.has(RAW('ExcludeClipboardContentFromMonitorProcessing'))) return true;
      const flag = RAW('CanIncludeInClipboardHistory');
      const item = items.find((it) => it.types.includes(flag));
      if (item) {
        const buf = Buffer.from(await (await item.getType(flag)).arrayBuffer());
        if (buf.length >= 4 && buf.readUInt32LE(0) === 0) return true;
      }
    } catch {}
    return false;
  }

  async capture(own) {
    const items = await clipboard.read().catch(() => []);
    if (await this.isExcluded(items)) return;

    let entry = null;
    const text = await clipboard.readText().catch(() => '');
    if (text && text.trim()) {
      const clipped = text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text;
      entry = { kind: classify(clipped), text: clipped };
    } else {
      const imageItem = items.find((it) => it.types.includes('image/png'));
      if (!imageItem) return;
      const png = Buffer.from(await (await imageItem.getType('image/png')).arrayBuffer());
      const image = nativeImage.createFromBuffer(png);
      if (image.isEmpty()) return;
      const size = image.getSize();
      const thumb = image.resize({ height: Math.min(160, size.height), quality: 'good' });
      entry = { kind: 'image', png, thumb: thumb.toDataURL(), width: size.width, height: size.height };
    }

    const dupe = this.items.findIndex((it) =>
      entry.kind === 'image'
        ? it.kind === 'image' && it.width === entry.width && it.height === entry.height && it.thumb === entry.thumb
        : it.text === entry.text);
    let item;
    if (dupe !== -1) {
      item = this.items.splice(dupe, 1)[0];
      item.ts = Date.now();
    } else {
      item = { id: this.nextId++, ts: Date.now(), ...entry };
    }
    this.items.unshift(item);
    this.trim();
    this.emit('change', this.list());
    if (!own) this.emit('captured', this.serialize(item));
  }

  trim() {
    let images = 0;
    this.items = this.items.filter((it) => (it.kind !== 'image' || ++images <= MAX_IMAGES)).slice(0, MAX_ITEMS);
  }

  async restore(id) {
    const item = this.items.find((it) => it.id === id);
    if (!item) return false;
    if (item.kind === 'image') {
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([item.png], { type: 'image/png' }) })]);
    } else {
      await clipboard.writeText(item.text);
    }
    this.selfSeq = clipboardSequence();
    return true;
  }

  // Put text on the clipboard without it showing up in history (used for
  // snippets, which already live in their own list).
  async writeQuiet(text) {
    this.muted = true;
    try {
      await clipboard.writeText(text);
    } finally {
      this.seq = clipboardSequence();
      this.muted = false;
    }
  }

  textOf(id) {
    const item = this.items.find((it) => it.id === id);
    return item && item.kind !== 'image' ? item.text : null;
  }

  clear() {
    this.items = [];
    this.emit('change', this.list());
  }

  serialize(it) {
    return { id: it.id, kind: it.kind, ts: it.ts, text: it.text, thumb: it.thumb, width: it.width, height: it.height };
  }

  list() {
    return this.items.map((it) => this.serialize(it));
  }
}

module.exports = { ClipboardHistory };
