import { Slider } from './slider.js';
import { icon } from './icons.js';
import { t } from './i18n.js';
import { makeCover, accentFrom } from './artwork.js';
import { Equalizer } from './equalizer.js';

const DEMO_TRACKS = [
  { title: 'Afterglow', artist: 'Mira Solace', duration: 222000 },
  { title: 'Glass Highway', artist: 'Northbound Static', duration: 245000 },
  { title: 'Soft Machines', artist: 'Arden & Kei', duration: 198000 },
  { title: 'Low Orbit', artist: 'Halcyon Drift', duration: 177000 },
];

const APP_NAMES = [
  [/spotify/i, 'Spotify'],
  [/yandex.*music|desktop\.music/i, () => (document.documentElement.lang === 'ru' ? 'Яндекс Музыка' : 'Yandex Music')],
  [/zunemusic|mediaplayer/i, 'Media Player'],
  [/applemusic|itunes/i, 'Apple Music'],
  [/msedge/i, 'Edge'],
  [/chrome/i, 'Chrome'],
  [/firefox/i, 'Firefox'],
  [/opera/i, 'Opera'],
  [/brave/i, 'Brave'],
  [/vlc/i, 'VLC'],
  [/telegram/i, 'Telegram'],
  [/foobar/i, 'foobar2000'],
  [/aimp/i, 'AIMP'],
  [/soundcloud/i, 'SoundCloud'],
  [/youtube/i, 'YouTube Music'],
];

function appName(id = '') {
  for (const [re, name] of APP_NAMES) if (re.test(id)) return typeof name === 'function' ? name() : name;
  const base = id.split('!').pop().split(/[\\/]/).pop().replace(/\.exe$/i, '');
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : '';
}

export function formatTime(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

const COMPACT_IDLE_W = 132;
const COMPACT_MEDIA_W = 196;

export class NowPlaying {
  constructor({ island, api, settings, forceDemo = false }) {
    this.island = island;
    this.api = api;
    this.settings = settings;
    this.forceDemo = forceDemo;

    this.system = null;
    this.systemArt = null;
    this.systemArtKey = null;
    this.demo = { index: 0, playing: true, position: 38000, updated: Date.now() };
    this.demoCovers = [];
    this.volume = { level: 0.6, muted: false, known: false };
    this.lastVolumeInput = 0;
    this.shownKey = null;
    this.shownArt = undefined;
    this.state = null;
    this.seekPreview = null;

    const $ = (id) => document.getElementById(id);
    this.el = {
      title: $('np-title'),
      titleText: $('np-title').firstElementChild,
      artist: $('np-artist'),
      eq: $('np-eq'),
      compactEq: $('c-eq'),
      elapsed: $('np-elapsed'),
      remaining: $('np-remaining'),
      source: $('np-source'),
      prev: $('np-prev'),
      play: $('np-play'),
      next: $('np-next'),
      mute: $('np-mute'),
      ambient: $('ambient-img'),
      hero: island.hero,
      heroImgs: [...island.hero.querySelectorAll('.hero-img')],
    };
    this.heroFront = 0;

    this.equalizer = new Equalizer(() => {
      const { mode, hasMedia, activity, suspended } = island;
      if (suspended) return [];
      if (mode === 'expanded') return [this.el.eq];
      if (mode === 'compact' && hasMedia) return [this.el.compactEq];
      if (mode === 'activity' && activity && activity.key === 'track') return [...document.querySelectorAll('#a-right .eq')];
      return [];
    });

    this.seek = new Slider($('np-seek'), {
      onDrag: (d) => island.setDragging(d),
      onInput: (v) => {
        this.seekPreview = v;
        this.renderProgress();
      },
      onCommit: (v) => {
        this.seekPreview = null;
        this.seekTo(v);
      },
    });

    this.vol = new Slider($('np-volume'), {
      onDrag: (d) => island.setDragging(d),
      onInput: (v) => this.setVolume(v),
      onCommit: (v) => this.setVolume(v, true),
    });

    this.el.play.addEventListener('click', () => this.toggle());
    this.el.prev.addEventListener('click', () => this.skip(-1));
    this.el.next.addEventListener('click', () => this.skip(1));
    this.el.mute.addEventListener('click', () => this.toggleMute());

    // Scrolling anywhere on the island nudges the system volume.
    island.el.addEventListener('wheel', (e) => {
      if (e.ctrlKey) return;
      // Scrolling a long snippet list or the editor's text must stay scrolling.
      if (e.target.closest('.snip-editor, .clip-grid.is-scrollable')) return;
      e.preventDefault();
      const step = (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 0.01 : 0.04);
      const base = this.volume.muted ? 0 : this.volume.level;
      this.setVolume(Math.round(Math.max(0, Math.min(1, base + step)) * 100) / 100, true);
      if (island.mode !== 'expanded' && this.settings.volumeHud) this.flashVolume();
    }, { passive: false });

    island.onMode((mode) => {
      // Let the outgoing layer fade before its bars stop moving.
      setTimeout(() => this.equalizer.sync(), 0);
      if (mode === 'expanded') {
        this.renderProgress();
        requestAnimationFrame(() => this.updateMarquee());
      } else {
        this.el.title.classList.remove('is-scrolling');
      }
    });

    setInterval(() => this.tick(), 250);
    this.renderVolume();
  }

  // ── Sources ─────────────────────────────────────────────────────────────
  setSystem(msg) {
    if (!msg.active) {
      this.system = null;
    } else {
      if ('art' in msg) {
        this.systemArt = msg.art || null;
        this.systemArtKey = msg.artKey;
      }
      this.system = { ...msg, received: Date.now() };
    }
    this.refresh();
  }

  setSettings(settings) {
    this.settings = settings;
    this.refresh();
  }

  demoCover(i) {
    if (!this.demoCovers[i]) this.demoCovers[i] = makeCover(i);
    return this.demoCovers[i];
  }

  normalized() {
    const s = this.system;
    if (s && !this.forceDemo && (s.title || s.artist)) {
      // Some players report a zero/ancient timestamp — fall back to arrival time.
      const updated = s.updated && s.updated > Date.now() - 864e5 * 30 ? s.updated : s.received;
      return {
        source: 'system',
        key: `${s.app}|${s.title}|${s.artist}`,
        title: s.title || '—',
        artist: s.artist || '',
        app: appName(s.app),
        art: this.systemArtKey === s.artKey || !s.artKey ? this.systemArt : null,
        playing: s.status === 'Playing',
        position: s.position,
        duration: s.duration,
        updated,
        canSeek: s.canSeek && s.duration > 0,
        canPrev: s.canPrev,
        canNext: s.canNext,
      };
    }
    if (this.forceDemo || this.settings.demoMedia) {
      const i = this.demo.index;
      const tr = DEMO_TRACKS[i];
      return {
        source: 'demo',
        key: `demo:${i}`,
        title: tr.title,
        artist: tr.artist,
        app: t('demo'),
        art: this.demoCover(i),
        playing: this.demo.playing,
        position: this.demo.position,
        duration: tr.duration,
        updated: this.demo.updated,
        canSeek: true,
        canPrev: true,
        canNext: true,
      };
    }
    return null;
  }

  position(st = this.state) {
    if (!st) return 0;
    if (!st.playing) return st.position;
    const p = st.position + (Date.now() - st.updated);
    return st.duration > 0 ? Math.min(st.duration, p) : p;
  }

  // ── Rendering ───────────────────────────────────────────────────────────
  refresh() {
    const prev = this.state;
    const st = this.normalized();
    this.state = st;
    const el = this.el;

    const trackChanged = (prev && prev.key) !== (st && st.key);
    if (trackChanged || !prev || (prev && st && prev.title !== st.title)) {
      el.titleText.textContent = st ? st.title : t('notPlaying');
      el.titleText.dataset.text = el.titleText.textContent;
      el.artist.textContent = st ? st.artist : t('notPlayingHint');
      el.title.classList.remove('is-scrolling');
      if (this.island.mode === 'expanded') requestAnimationFrame(() => this.updateMarquee());
    }

    this.setArt(st ? st.art : null);

    const playing = !!(st && st.playing);
    el.play.classList.toggle('is-playing', playing);
    el.eq.classList.toggle('is-paused', !playing);
    el.eq.classList.toggle('is-hidden', !st);
    el.compactEq.classList.toggle('is-paused', !playing);

    el.source.innerHTML = st ? `${icon('wave')}<span></span>` : '';
    if (st) el.source.lastElementChild.textContent = st.app;

    el.play.classList.toggle('is-disabled', !st);
    el.prev.classList.toggle('is-disabled', !st || !st.canPrev);
    el.next.classList.toggle('is-disabled', !st || !st.canNext);
    this.seek.setEnabled(!!(st && st.canSeek));

    this.island.setCompact({ width: playing ? COMPACT_MEDIA_W : COMPACT_IDLE_W, hasMedia: playing });
    this.equalizer.setPlaying(playing);
    this.renderProgress();

    // A new track while idle gets a short peek, like a live activity.
    if (prev && st && trackChanged && playing && this.island.mode !== 'expanded') {
      this.island.flash({
        key: 'track',
        width: 330,
        hero: true,
        duration: 3200,
        render: () => this.renderTrackActivity(),
      });
    }
  }

  setArt(src) {
    if (src === this.shownArt) return;
    this.shownArt = src;
    const { hero, heroImgs, ambient } = this.el;
    hero.classList.toggle('is-empty', !src);
    this.island.el.classList.toggle('has-art', !!src);
    if (!src) {
      heroImgs.forEach((img) => img.classList.remove('is-shown'));
      this.island.el.style.setProperty('--accent', '235 235 245');
      return;
    }
    const back = heroImgs[1 - this.heroFront];
    const front = heroImgs[this.heroFront];
    back.onload = () => {
      if (this.shownArt !== src) return;
      back.classList.add('is-shown');
      front.classList.remove('is-shown');
      this.heroFront = 1 - this.heroFront;
    };
    back.src = src;
    ambient.src = src;
    accentFrom(src).then((rgb) => {
      if (this.shownArt === src) this.island.el.style.setProperty('--accent', rgb.join(' '));
    });
  }

  renderProgress() {
    const st = this.state;
    const dur = st ? st.duration : 0;
    const pos = this.seekPreview !== null ? this.seekPreview * dur : this.position();
    const ratio = dur > 0 ? pos / dur : 0;
    this.seek.set(ratio);
    const elapsed = formatTime(pos);
    const remaining = dur > 0 ? `-${formatTime(dur - pos)}` : '--:--';
    if (this.el.elapsed.textContent !== elapsed) this.el.elapsed.textContent = elapsed;
    if (this.el.remaining.textContent !== remaining) this.el.remaining.textContent = remaining;
  }

  updateMarquee() {
    const box = this.el.title;
    const text = this.el.titleText;
    box.classList.remove('is-scrolling');
    text.textContent = text.dataset.text || text.textContent;
    const overflow = text.scrollWidth - box.clientWidth;
    if (overflow <= 2) return;
    const gap = 36;
    const shift = text.scrollWidth + gap;
    // Duplicate the title so the loop is seamless.
    text.innerHTML = '';
    const a = document.createElement('span');
    const b = document.createElement('span');
    a.textContent = b.textContent = text.dataset.text;
    b.style.paddingLeft = `${gap}px`;
    text.append(a, b);
    box.style.setProperty('--marquee-shift', `${-shift}px`);
    box.style.setProperty('--marquee-duration', `${(shift / 28 + 2.4).toFixed(2)}s`);
    box.classList.add('is-scrolling');
  }

  renderTrackActivity() {
    const st = this.state;
    const left = document.getElementById('a-left');
    const right = document.getElementById('a-right');
    left.className = 'a-left a-track';
    left.innerHTML = '<span class="a-title"></span><span class="a-sub"></span>';
    left.children[0].textContent = st ? st.title : '';
    left.children[1].textContent = st ? st.artist : '';
    right.className = 'a-right';
    right.innerHTML = '<div class="eq eq-sm"><i><b></b></i><i><b></b></i><i><b></b></i><i><b></b></i></div>';
    setTimeout(() => this.equalizer.sync(), 0);
  }

  tick() {
    const st = this.state;
    if (!st) return;
    if (st.source === 'demo' && st.playing && this.position() >= st.duration) {
      this.skip(1);
      return;
    }
    if (this.island.mode === 'expanded') this.renderProgress();
  }

  // ── Transport ───────────────────────────────────────────────────────────
  toggle() {
    const st = this.state;
    if (!st) return;
    if (st.source === 'system') {
      this.api.media({ cmd: 'toggle' });
      // Optimistic flip; the bridge confirms a moment later.
      this.system = { ...this.system, status: st.playing ? 'Paused' : 'Playing', position: this.position(), updated: Date.now() };
    } else {
      this.demo = { ...this.demo, position: this.position(), updated: Date.now(), playing: !this.demo.playing };
    }
    this.refresh();
  }

  skip(dir) {
    const st = this.state;
    if (!st) return;
    if (st.source === 'system') {
      if (dir < 0 && this.position() > 4000 && st.canSeek) {
        this.seekTo(0);
        return;
      }
      this.api.media({ cmd: dir > 0 ? 'next' : 'prev' });
      return;
    }
    if (dir < 0 && this.position() > 4000) {
      this.demo = { ...this.demo, position: 0, updated: Date.now() };
    } else {
      const n = DEMO_TRACKS.length;
      this.demo = { index: (this.demo.index + dir + n) % n, playing: true, position: 0, updated: Date.now() };
    }
    this.refresh();
  }

  seekTo(ratio) {
    const st = this.state;
    if (!st || !st.canSeek) return;
    const ms = ratio * st.duration;
    if (st.source === 'system') {
      this.api.media({ cmd: 'seek', value: Math.round(ms) });
      this.system = { ...this.system, position: ms, updated: Date.now() };
    } else {
      this.demo = { ...this.demo, position: ms, updated: Date.now() };
    }
    this.refresh();
  }

  // ── Volume ──────────────────────────────────────────────────────────────
  setVolume(v, final = false) {
    this.volume.level = v;
    this.volume.muted = false;
    this.lastVolumeInput = Date.now();
    const now = performance.now();
    if (final || now - (this.lastVolumeSend || 0) > 40) {
      this.lastVolumeSend = now;
      this.api.media({ cmd: 'volume', value: Math.round(v * 1000) / 1000 });
    }
    this.renderVolume();
  }

  toggleMute() {
    this.volume.muted = !this.volume.muted;
    this.lastVolumeInput = Date.now();
    this.api.media({ cmd: 'mute', value: this.volume.muted });
    this.renderVolume();
  }

  onSystemVolume(msg) {
    const first = !this.volume.known;
    const changed = Math.abs(msg.level - this.volume.level) > 0.004 || msg.muted !== this.volume.muted;
    this.volume = { level: msg.level, muted: msg.muted, known: true };
    if (!this.vol.dragging) this.renderVolume();
    const external = Date.now() - this.lastVolumeInput > 900;
    if (!first && changed && external && this.settings.volumeHud && this.island.mode !== 'expanded') this.flashVolume();
  }

  flashVolume() {
    this.island.flash({
      key: 'volume',
      width: 220,
      duration: 1600,
      render: () => this.renderVolumeActivity(),
    });
  }

  renderVolume() {
    const { level, muted } = this.volume;
    this.vol.set(muted ? 0 : level);
    const glyph = icon('speaker', level, muted || level < 0.005);
    if (this.el.mute.dataset.glyph !== glyph) {
      this.el.mute.innerHTML = glyph;
      this.el.mute.dataset.glyph = glyph;
    }
  }

  renderVolumeActivity() {
    const { level, muted } = this.volume;
    const left = document.getElementById('a-left');
    const right = document.getElementById('a-right');
    const bar = right.querySelector('.a-bar i');
    if (bar && this.island.activityKey() === 'volume') {
      // Already on screen: glide the bar instead of rebuilding.
      bar.style.width = `${muted ? 0 : (level * 100).toFixed(1)}%`;
      left.firstElementChild.outerHTML = icon('speaker', level, muted || level < 0.005);
      left.lastElementChild.textContent = muted ? t('muted') : `${Math.round(level * 100)}`;
      return;
    }
    left.className = 'a-left';
    left.innerHTML = `${icon('speaker', level, muted || level < 0.005)}<span class="a-muted"></span>`;
    left.lastElementChild.textContent = muted ? t('muted') : `${Math.round(level * 100)}`;
    right.className = 'a-right';
    right.innerHTML = `<div class="a-bar"><i style="width:${muted ? 0 : (level * 100).toFixed(1)}%"></i></div>`;
  }
}
