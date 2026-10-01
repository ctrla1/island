import { icon } from './icons.js';
import { t } from './i18n.js';

const COLLAPSED_COUNT = 4;
const COLORS = {
  none: '#8e8e93',
  blue: '#5e9eff',
  green: '#4cd07d',
  orange: '#ff9f43',
  pink: '#ff6b9a',
  purple: '#a78bfa',
};

// Layout-independent key names (KeyboardEvent.code), so a Russian layout still
// records "R" — which is also what Electron accelerators expect.
const CODE_KEYS = {
  Space: 'Space', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
};
const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta', 'AltGraph']);

function keyFromCode(code) {
  let m;
  if ((m = /^Key([A-Z])$/.exec(code))) return m[1];
  if ((m = /^Digit(\d)$/.exec(code))) return m[1];
  if ((m = /^Numpad(\d)$/.exec(code))) return `num${m[1]}`;
  if ((m = /^F(\d{1,2})$/.exec(code)) && +m[1] >= 1 && +m[1] <= 24) return `F${m[1]}`;
  return CODE_KEYS[code] || null;
}

function keycaps(accel) {
  return accel
    .split('+')
    .map((k) => `<kbd>${k.replace(/^num/, 'Num ').replace(/[<>&]/g, '')}</kbd>`)
    .join('');
}

// ── Tabs: Recent | Snippets ─────────────────────────────────────────────────
export class Shelf {
  constructor({ island }) {
    this.el = document.getElementById('shelf');
    this.seg = document.getElementById('shelf-seg');
    this.thumb = this.seg.querySelector('.seg-thumb');
    this.buttons = [...this.seg.querySelectorAll('.seg-btn')];
    this.listeners = [];

    let tab = 'recent';
    try {
      tab = localStorage.getItem('island.shelf') || 'recent';
    } catch {}
    this.buttons.forEach((b) => b.addEventListener('click', () => this.show(b.dataset.tab)));
    // Counts change the buttons' widths; keep the thumb under the active one.
    const ro = new ResizeObserver(() => this.placeThumb(false));
    this.buttons.forEach((b) => ro.observe(b));
    this.show(tab === 'snippets' ? 'snippets' : 'recent', false);
    island.onMode((mode) => mode === 'expanded' && requestAnimationFrame(() => this.placeThumb(false)));
  }

  onChange(fn) {
    this.listeners.push(fn);
  }

  show(tab, animate = true) {
    const changed = tab !== this.tab;
    this.tab = tab;
    this.el.dataset.tab = tab;
    this.buttons.forEach((b) => b.classList.toggle('is-on', b.dataset.tab === tab));
    try {
      localStorage.setItem('island.shelf', tab);
    } catch {}
    this.placeThumb(animate);
    if (animate && changed) {
      this.el.querySelector(`[data-pane="${tab}"]`).animate(
        [
          { opacity: 0, transform: 'translateY(5px)', filter: 'blur(3px)' },
          { opacity: 1, transform: 'none', filter: 'blur(0)' },
        ],
        { duration: 300, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      );
    }
    for (const fn of this.listeners) fn(tab);
  }

  placeThumb(animate) {
    const btn = this.buttons.find((b) => b.dataset.tab === this.tab);
    if (!btn || !btn.offsetWidth) return;
    this.thumb.classList.toggle('no-anim', !animate);
    this.thumb.style.width = `${btn.offsetWidth}px`;
    this.thumb.style.transform = `translateX(${btn.offsetLeft}px)`;
  }
}

// ── Snippets ────────────────────────────────────────────────────────────────
export class SnippetsPanel {
  constructor({ api, island, shelf, springEase, getSettings, onList }) {
    this.api = api;
    this.island = island;
    this.shelf = shelf;
    this.springEase = springEase;
    this.getSettings = getSettings;
    this.onList = onList;
    this.list = [];
    this.pending = null;
    this.cards = new Map();
    this.showAll = false;
    this.editingId = null;
    this.draft = null;
    this.hotkey = null;
    this.color = 'none';
    this.recording = false;
    this.recordedAt = 0;

    const $ = (id) => document.getElementById(id);
    this.grid = $('snip-grid');
    this.count = $('snip-count');
    this.more = $('snip-more');
    this.add = $('snip-add');
    this.form = $('snip-editor');
    this.heading = $('ed-heading');
    this.nameInput = $('ed-name');
    this.textInput = $('ed-text');
    this.keyBtn = $('ed-key');
    this.keyClear = $('ed-key-clear');
    this.error = $('ed-error');
    this.deleteBtn = $('ed-delete');

    $('snip-title').textContent = t('snippets');
    this.add.lastElementChild.textContent = t('newSnippet');
    $('ed-name-label').textContent = t('fieldName');
    $('ed-text-label').textContent = t('fieldText');
    $('ed-key-label').textContent = t('fieldHotkey');
    this.nameInput.placeholder = t('namePlaceholder');
    this.textInput.placeholder = t('textPlaceholder');
    this.deleteBtn.textContent = t('delete');
    $('ed-cancel').textContent = t('cancel');
    $('ed-save').textContent = t('save');

    const colors = $('ed-colors');
    for (const [name, value] of Object.entries(COLORS)) {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'ed-color';
      dot.dataset.color = name;
      dot.style.setProperty('--dot', value);
      dot.addEventListener('click', () => this.pickColor(name));
      colors.appendChild(dot);
    }

    this.more.addEventListener('click', () => {
      this.showAll = !this.showAll;
      this.render();
    });
    this.add.addEventListener('click', () => this.openEditor(null));
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.save();
    });
    this.form.addEventListener('keydown', (e) => this.formKey(e));
    $('ed-cancel').addEventListener('click', () => this.closeEditor());
    this.deleteBtn.addEventListener('click', () => this.remove());
    this.keyBtn.addEventListener('click', () => {
      // Space/Enter that finished a recording must not immediately start a new one.
      if (performance.now() - this.recordedAt < 400) return;
      if (this.recording) this.stopRecording();
      else this.startRecording();
    });
    this.keyBtn.addEventListener('keydown', (e) => this.recordKey(e));
    this.keyBtn.addEventListener('blur', () => this.stopRecording());
    this.keyClear.addEventListener('click', () => {
      this.hotkey = null;
      this.renderKey();
    });

    island.onMode((mode) => {
      if (mode === 'expanded') return;
      if (this.pending) {
        this.list = this.pending;
        this.pending = null;
        this.render();
      }
      if (this.showAll) {
        this.showAll = false;
        this.render();
      }
    });
  }

  // ── List ──────────────────────────────────────────────────────────────────
  setList(list, reason) {
    this.onList?.(list);
    // Usage reorders the list; don't shuffle cards under the cursor mid-use.
    if (reason === 'use' && this.island.mode === 'expanded') {
      this.pending = list;
      return;
    }
    this.pending = null;
    this.list = list;
    this.render();
  }

  render() {
    const animate = this.island.mode === 'expanded' && this.grid.offsetParent !== null;
    const first = new Map();
    if (animate) for (const [id, el] of this.cards) first.set(id, el.getBoundingClientRect());

    const visible = this.showAll ? this.list : this.list.slice(0, COLLAPSED_COUNT);
    const keep = new Set(visible.map((s) => s.id));
    for (const [id, el] of this.cards) {
      if (!keep.has(id)) {
        el.remove();
        this.cards.delete(id);
      }
    }
    this.grid.querySelector('.clip-empty')?.remove();

    const fresh = [];
    for (const s of visible) {
      let el = this.cards.get(s.id);
      if (!el) {
        el = this.build(s.id);
        this.cards.set(s.id, el);
        fresh.push(el);
      }
      this.fill(el, s);
      this.grid.appendChild(el);
    }

    if (!visible.length) {
      const empty = document.createElement('div');
      empty.className = 'clip-empty snip-empty';
      empty.innerHTML = `<span></span><button type="button" class="chip chip-add">${icon('plus')}<span></span></button>`;
      empty.firstElementChild.textContent = t('snipEmpty');
      empty.querySelector('.chip span').textContent = t('addSnippet');
      empty.querySelector('.chip').addEventListener('click', () => this.openEditor(null));
      this.grid.appendChild(empty);
    }

    this.count.textContent = this.list.length ? String(this.list.length) : '';
    this.count.hidden = !this.list.length;
    this.more.hidden = this.list.length <= COLLAPSED_COUNT;
    this.more.classList.toggle('is-open', this.showAll);
    this.more.firstElementChild.textContent = this.showAll ? t('showLess') : t('showAll');
    requestAnimationFrame(() => this.grid.classList.toggle('is-scrollable', this.grid.scrollHeight > this.grid.clientHeight + 1));

    if (!animate) return;
    for (const [id, el] of this.cards) {
      const f = first.get(id);
      if (!f) continue;
      const l = el.getBoundingClientRect();
      const dx = f.left - l.left;
      const dy = f.top - l.top;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }], {
          duration: 620,
          easing: this.springEase,
        });
      }
    }
    fresh.forEach((el, i) => {
      el.animate(
        [
          { opacity: 0, transform: 'scale(0.86)', filter: 'blur(6px)' },
          { opacity: 1, transform: 'scale(1)', filter: 'blur(0px)' },
        ],
        { duration: 560, delay: i * 35, easing: this.springEase, fill: 'backwards' },
      );
    });
  }

  build(id) {
    const el = document.createElement('button');
    el.className = 'card snip-card';
    el.innerHTML = `
      <div class="card-top"><span class="snip-dot"></span><span class="snip-title"></span><span class="snip-edit" role="button">${icon('pencil')}</span></div>
      <div class="card-body snip-body"></div>
      <span class="snip-key"></span>
      <div class="card-done">${icon('check')}<span></span></div>`;
    el.addEventListener('click', (e) => {
      e.preventDefault();
      this.use(id, el);
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.openEditor(this.find(id));
    });
    el.querySelector('.snip-edit').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.openEditor(this.find(id));
    });
    return el;
  }

  fill(el, s) {
    el.style.setProperty('--dot', COLORS[s.color] || COLORS.none);
    el.querySelector('.snip-title').textContent = s.title;
    el.querySelector('.snip-body').textContent = s.text.replace(/\s+/g, ' ').trim();
    const key = el.querySelector('.snip-key');
    key.innerHTML = s.hotkey ? keycaps(s.hotkey) : '';
    el.classList.toggle('has-key', !!s.hotkey);
  }

  find(id) {
    return this.list.find((s) => s.id === id) || (this.pending || []).find((s) => s.id === id);
  }

  async use(id, el) {
    const r = await this.api.useSnippet(id);
    if (!r || !r.ok) return;
    el.querySelector('.card-done span').textContent = r.pasted ? t('pasted') : t('copied');
    el.classList.remove('is-copied');
    void el.offsetWidth;
    el.classList.add('is-copied');
    clearTimeout(el._copiedTimer);
    el._copiedTimer = setTimeout(() => el.classList.remove('is-copied'), 1300);
  }

  // Live activity after a hotkey paste, when the island is folded.
  renderUsedActivity({ title, pasted }) {
    const left = document.getElementById('a-left');
    const right = document.getElementById('a-right');
    left.className = 'a-left';
    left.innerHTML = `<span class="a-icon">${icon('snippet')}</span><span></span>`;
    left.lastElementChild.textContent = pasted ? t('pasted') : t('copied');
    right.className = 'a-right';
    right.innerHTML = '<span class="a-preview"></span>';
    right.firstElementChild.textContent = title;
  }

  // ── Editor ────────────────────────────────────────────────────────────────
  get isEditing() {
    return this.editingId !== null;
  }

  openEditor(snippet) {
    if (this.isEditing) this.closeEditor({ keepDraft: true, silent: true });
    const key = snippet ? snippet.id : 'new';
    const src = this.draft && this.draft.key === key ? this.draft : snippet || {};
    this.editingId = key;
    this.nameInput.value = src.title || '';
    this.textInput.value = src.text || '';
    this.hotkey = src.hotkey || null;
    this.pickColor(src.color || 'none');
    this.heading.textContent = snippet ? t('editSnippetHeading') : t('newSnippetHeading');
    this.deleteBtn.hidden = !snippet;
    this.setError('');
    this.renderKey();

    this.shelf.el.classList.add('is-editing');
    this.form.hidden = false;
    this.form.animate(
      [
        { opacity: 0, transform: 'translateY(6px)', filter: 'blur(4px)' },
        { opacity: 1, transform: 'none', filter: 'blur(0)' },
      ],
      { duration: 320, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    );
    this.island.setLocked(true);
    this.api.setEditing(true);
    // The main process hands the window keyboard focus; then the caret can land.
    setTimeout(() => (snippet ? this.textInput : this.nameInput).focus(), 90);
  }

  closeEditor({ keepDraft = false, silent = false } = {}) {
    if (!this.isEditing) return;
    this.draft = keepDraft
      ? { key: this.editingId, title: this.nameInput.value, text: this.textInput.value, hotkey: this.hotkey, color: this.color }
      : null;
    this.stopRecording();
    this.editingId = null;
    this.form.hidden = true;
    this.shelf.el.classList.remove('is-editing');
    if (silent) return;
    this.api.setEditing(false);
    this.island.setLocked(false);
  }

  async save() {
    const text = this.textInput.value;
    if (!text.trim()) {
      this.setError(t('errEmpty'));
      this.textInput.focus();
      return;
    }
    const id = this.editingId === 'new' ? undefined : this.editingId;
    const r = await this.api.saveSnippet({ id, title: this.nameInput.value, text, color: this.color, hotkey: this.hotkey });
    if (!r || !r.ok) {
      const messages = {
        reserved: t('errReserved'),
        'taken-snippet': t('errTakenSnippet').replace('{title}', (r && r.title) || ''),
        'taken-system': t('errTakenSystem'),
        invalid: t('errInvalid'),
        empty: t('errEmpty'),
        limit: t('errLimit'),
      };
      this.setError(messages[r && r.error] || t('errInvalid'));
      return;
    }
    this.closeEditor();
    if (this.shelf.tab !== 'snippets') this.shelf.show('snippets');
  }

  async remove() {
    if (!this.isEditing || this.editingId === 'new') return;
    await this.api.deleteSnippet(this.editingId);
    this.closeEditor();
  }

  pickColor(name) {
    this.color = COLORS[name] ? name : 'none';
    for (const dot of this.form.querySelectorAll('.ed-color')) dot.classList.toggle('is-on', dot.dataset.color === this.color);
  }

  setError(message) {
    this.error.textContent = message;
    this.error.hidden = !message;
  }

  formKey(e) {
    if (this.recording) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      this.closeEditor();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      this.save();
    }
  }

  // ── Hotkey recorder ───────────────────────────────────────────────────────
  startRecording() {
    this.recording = true;
    this.keyBtn.classList.add('is-recording');
    this.keyBtn.textContent = t('hotkeyRecording');
    this.setError('');
  }

  stopRecording() {
    if (!this.recording) return;
    this.recording = false;
    this.recordedAt = performance.now();
    this.keyBtn.classList.remove('is-recording');
    this.renderKey();
  }

  recordKey(e) {
    if (!this.recording) return;
    e.preventDefault();
    e.stopPropagation();
    const mods = e.ctrlKey || e.altKey || e.shiftKey || e.metaKey;
    if (e.key === 'Escape' && !mods) return this.stopRecording();
    if ((e.key === 'Backspace' || e.key === 'Delete') && !mods) {
      this.hotkey = null;
      return this.stopRecording();
    }
    if (MODIFIER_KEYS.has(e.key)) {
      const held = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter(Boolean);
      this.keyBtn.innerHTML = held.length ? `${keycaps(held.join('+'))}<span class="ed-key-wait">…</span>` : t('hotkeyRecording');
      return;
    }
    const key = keyFromCode(e.code);
    if (!key) return;
    if (!e.ctrlKey && !e.altKey) {
      this.setError(t('hotkeyNeedMod'));
      return;
    }
    this.hotkey = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', key].filter(Boolean).join('+');
    this.setError('');
    this.stopRecording();
  }

  renderKey() {
    if (this.recording) return;
    this.keyBtn.innerHTML = this.hotkey ? keycaps(this.hotkey) : `<span class="ed-key-none"></span>`;
    if (!this.hotkey) this.keyBtn.firstElementChild.textContent = t('hotkeyNone');
    this.keyBtn.classList.toggle('has-key', !!this.hotkey);
    this.keyClear.hidden = !this.hotkey;
  }
}
