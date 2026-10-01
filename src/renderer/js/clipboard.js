import { icon } from './icons.js';
import { t } from './i18n.js';

const COLLAPSED_COUNT = 4;
const EXPANDED_COUNT = 8;

function ago(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 45) return t('now');
  const m = Math.round(s / 60);
  if (m < 60) return `${m} ${t('min')}`;
  return `${Math.round(m / 60)} ${t('hour')}`;
}

function splitUrl(text) {
  try {
    const u = new URL(/^www\./i.test(text) ? `https://${text}` : text);
    return { host: u.host.replace(/^www\./, ''), rest: `${u.pathname === '/' ? '' : u.pathname}${u.search}` };
  } catch {
    return { host: text, rest: '' };
  }
}

export class ClipboardPanel {
  constructor({ api, island, springEase }) {
    this.api = api;
    this.island = island;
    this.springEase = springEase;
    this.items = [];
    this.cards = new Map();
    this.showAll = false;

    const $ = (id) => document.getElementById(id);
    this.grid = $('clip-grid');
    this.count = $('clip-count');
    this.more = $('clip-more');
    this.clear = $('clip-clear');
    $('clip-title').textContent = t('clipboard');
    this.clear.textContent = t('clear');

    this.more.addEventListener('click', () => {
      this.showAll = !this.showAll;
      this.render();
    });
    this.clear.addEventListener('click', () => api.clearClips());

    island.onMode((mode) => {
      if (mode === 'expanded') this.refreshTimes();
      else if (this.showAll) {
        // Fold back once the island is gone so the next open starts compact.
        setTimeout(() => {
          if (this.island.mode !== 'expanded') {
            this.showAll = false;
            this.render();
          }
        }, 450);
      }
    });
    setInterval(() => this.island.mode === 'expanded' && this.refreshTimes(), 20000);
  }

  setItems(items) {
    this.items = items;
    this.render();
  }

  render() {
    const animate = this.island.mode === 'expanded';
    const first = new Map();
    if (animate) for (const [id, el] of this.cards) first.set(id, el.getBoundingClientRect());

    const limit = this.showAll ? EXPANDED_COUNT : COLLAPSED_COUNT;
    const visible = this.items.slice(0, limit);
    const keep = new Set(visible.map((it) => it.id));

    for (const [id, el] of this.cards) {
      if (!keep.has(id)) {
        el.remove();
        this.cards.delete(id);
      }
    }
    this.grid.querySelector('.clip-empty')?.remove();

    const fresh = [];
    for (const item of visible) {
      let el = this.cards.get(item.id);
      if (!el) {
        el = this.build(item);
        this.cards.set(item.id, el);
        fresh.push(el);
      }
      el.querySelector('.card-time').textContent = ago(item.ts);
      this.grid.appendChild(el);
    }

    if (!visible.length) {
      const empty = document.createElement('div');
      empty.className = 'clip-empty';
      empty.innerHTML = `${icon('clipboard')}<span></span>`;
      empty.lastElementChild.textContent = t('clipEmpty');
      this.grid.appendChild(empty);
    }

    this.count.textContent = this.items.length ? String(this.items.length) : '';
    this.count.hidden = !this.items.length;
    this.more.hidden = this.items.length <= COLLAPSED_COUNT;
    this.more.classList.toggle('is-open', this.showAll);
    this.more.firstElementChild.textContent = this.showAll ? t('showLess') : t('showAll');
    this.clear.hidden = !this.items.length;

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

  refreshTimes() {
    for (const item of this.items) {
      const el = this.cards.get(item.id);
      if (el) el.querySelector('.card-time').textContent = ago(item.ts);
    }
  }

  build(item) {
    const el = document.createElement('button');
    el.className = `card card-${item.kind}`;
    const kindIcon = { text: 'text', link: 'link', color: 'color', code: 'code', image: 'image', email: 'email' }[item.kind] || 'text';
    el.innerHTML = `
      <div class="card-top">${icon(kindIcon)}<span class="card-kind"></span><span class="card-time"></span></div>
      <div class="card-body"></div>
      <div class="card-done">${icon('check')}<span></span></div>`;
    el.querySelector('.card-kind').textContent = t(item.kind);
    el.querySelector('.card-done span').textContent = t('copied');
    const body = el.querySelector('.card-body');

    if (item.kind === 'link') {
      const { host, rest } = splitUrl(item.text.trim());
      body.innerHTML = '<span class="card-host"></span><span class="card-path"></span>';
      body.children[0].textContent = host;
      body.children[1].textContent = rest;
    } else if (item.kind === 'color') {
      body.innerHTML = '<span class="card-swatch"></span><span class="card-mono"></span>';
      body.children[0].style.background = item.text.trim();
      body.children[1].textContent = item.text.trim().toUpperCase();
    } else if (item.kind === 'image') {
      const img = document.createElement('img');
      img.className = 'card-thumb';
      img.src = item.thumb;
      img.alt = '';
      el.prepend(img);
      body.textContent = `${item.width} × ${item.height}`;
    } else {
      body.textContent = item.text.replace(/\s+/g, ' ').trim();
    }

    el.addEventListener('click', async (e) => {
      e.preventDefault();
      const ok = await this.api.copyClip(item.id);
      if (!ok) return;
      el.classList.remove('is-copied');
      void el.offsetWidth;
      el.classList.add('is-copied');
      clearTimeout(el._copiedTimer);
      el._copiedTimer = setTimeout(() => el.classList.remove('is-copied'), 1300);
    });
    return el;
  }

  // Compact "Copied" live activity shown when something new hits the clipboard.
  renderCopiedActivity(item) {
    const left = document.getElementById('a-left');
    const right = document.getElementById('a-right');
    left.className = 'a-left';
    left.innerHTML = `<span class="a-icon">${icon('clipboard')}</span><span></span>`;
    left.lastElementChild.textContent = t('copied');
    right.className = 'a-right';
    if (item.kind === 'image') {
      right.innerHTML = '<img class="a-thumb" alt="">';
      right.firstElementChild.src = item.thumb;
    } else if (item.kind === 'color') {
      right.innerHTML = '<span class="a-swatch"></span><span class="a-preview a-mono"></span>';
      right.firstElementChild.style.background = item.text.trim();
      right.lastElementChild.textContent = item.text.trim().toUpperCase();
    } else {
      right.innerHTML = '<span class="a-preview"></span>';
      const text = item.kind === 'link' ? splitUrl(item.text.trim()).host : item.text.replace(/\s+/g, ' ').trim();
      right.firstElementChild.textContent = text;
    }
  }
}
