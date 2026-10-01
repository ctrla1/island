// Snippets: things the user pastes often (company details, emails, canned
// replies, commands). Stored only on this machine, encrypted with the Windows
// user's DPAPI key via Electron safeStorage.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { safeStorage } = require('electron');
const { EventEmitter } = require('events');

const MAX_SNIPPETS = 60;
const MAX_TITLE = 60;
const MAX_TEXT = 10000;
const COLORS = new Set(['none', 'blue', 'green', 'orange', 'pink', 'purple']);
const MAGIC = Buffer.from('ISN1');

function autoTitle(text) {
  const t = text.trim();
  try {
    if (/^(https?:\/\/|www\.)\S+$/i.test(t)) return new URL(/^www\./i.test(t) ? `https://${t}` : t).host.replace(/^www\./, '');
  } catch {}
  const line = t.split('\n')[0].replace(/\s+/g, ' ').trim();
  return line.length > 32 ? `${line.slice(0, 31).trimEnd()}…` : line;
}

class SnippetStore extends EventEmitter {
  constructor(dir) {
    super();
    this.file = path.join(dir, 'snippets.dat');
    this.items = [];
    this.readOnly = false;
  }

  load() {
    if (!fs.existsSync(this.file)) return;
    try {
      const raw = fs.readFileSync(this.file);
      if (!raw.subarray(0, 4).equals(MAGIC)) throw new Error('unknown format');
      const payload = raw.subarray(5);
      const json = raw[4] === 1 ? safeStorage.decryptString(payload) : payload.toString('utf8');
      this.items = JSON.parse(json).filter((s) => s && typeof s.text === 'string');
    } catch (err) {
      // Never overwrite a file we could not read — that would lose the user's data.
      this.readOnly = true;
      this.emit('log', `snippets: could not read ${this.file}: ${err.message}`);
    }
  }

  save() {
    if (this.readOnly) return;
    const json = JSON.stringify(this.items);
    const encrypted = safeStorage.isEncryptionAvailable();
    const payload = encrypted ? safeStorage.encryptString(json) : Buffer.from(json, 'utf8');
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, Buffer.concat([MAGIC, Buffer.from([encrypted ? 1 : 0]), payload]));
    fs.renameSync(tmp, this.file);
  }

  get(id) {
    return this.items.find((s) => s.id === id);
  }

  findByText(text) {
    return this.items.find((s) => s.text === text);
  }

  // Most used first; ties keep creation order.
  list() {
    return this.items
      .slice()
      .sort((a, b) => b.uses - a.uses || a.created - b.created)
      .map(({ id, title, text, color, hotkey, uses }) => ({ id, title, text, color, hotkey, uses }));
  }

  upsert(data) {
    const text = String(data.text || '').slice(0, MAX_TEXT);
    if (!text.trim()) throw new Error('empty');
    const title = String(data.title || '').trim().slice(0, MAX_TITLE) || autoTitle(text);
    const color = COLORS.has(data.color) ? data.color : 'none';
    const hotkey = typeof data.hotkey === 'string' && data.hotkey ? data.hotkey : null;
    let item = data.id && this.get(data.id);
    if (item) {
      Object.assign(item, { title, text, color, hotkey });
    } else {
      if (this.items.length >= MAX_SNIPPETS) throw new Error('limit');
      item = { id: crypto.randomUUID(), title, text, color, hotkey, uses: 0, created: Date.now() };
      this.items.push(item);
    }
    this.save();
    this.emit('change', 'edit');
    return item;
  }

  remove(id) {
    const before = this.items.length;
    this.items = this.items.filter((s) => s.id !== id);
    if (this.items.length === before) return false;
    this.save();
    this.emit('change', 'edit');
    return true;
  }

  use(id) {
    const item = this.get(id);
    if (!item) return null;
    item.uses += 1;
    item.lastUsed = Date.now();
    this.save();
    this.emit('change', 'use');
    return item;
  }
}

module.exports = { SnippetStore };
