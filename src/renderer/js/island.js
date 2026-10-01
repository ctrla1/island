import { Motion, clamp, lerp } from './spring.js';

export const COMPACT_H = 34;
export const EXPANDED_W = 624;
const NOTIFICATION_W = 384;
const ACTIVITY_H = 36;
const EXPANDED_PAD = { x: 18, y: 18 };
const HERO = { compact: 22, expanded: 60, rCompact: 7, rExpanded: 15 };

// [stiffness, damping] per axis. Width leads height slightly on open so the
// shape stretches, then drops — it reads as liquid rather than a box scaling.
const PRESETS = {
  open: { w: [400, 29], h: [290, 25], r: [300, 30] },
  close: { w: [420, 35], h: [460, 38], r: [440, 40] },
  pop: { w: [330, 21], h: [300, 21.5], r: [300, 26] },
  settle: { w: [380, 31], h: [380, 32], r: [380, 34] },
  boot: { w: [220, 17.5], h: [260, 21], r: [260, 23] },
};

// Pass-through: the pill sits right over browser tabs, so hovering it must not
// steal clicks. It turns to glass and lets clicks through; resting the cursor
// for DWELL ms (no click) means "I want the island" — it fills back in and opens.
const DWELL = 560;
const ARM_DELAY = 180;

export class Island {
  constructor({ el, layers, hero, api, renderNotification }) {
    this.el = el;
    this.layers = layers;
    this.hero = hero;
    this.api = api;
    this.renderNotification = renderNotification;
    this.listeners = [];

    this.mode = 'boot';
    this.compactW = 132;
    this.hasMedia = false;
    this.pinned = false;
    this.wantExpand = false;
    this.over = false;
    this.suppressed = false;
    this.dragging = false;
    this.suspended = false;
    this.passThrough = true;
    this.pressed = false;
    this.interactive = false;

    this.notification = null;
    this.queue = [];
    this.notifTimer = 0;
    this.notifRemaining = 0;
    this.notifStarted = 0;

    this.activity = null;
    this.activityTimer = 0;

    this.expandedH = 300;

    this.motion = new Motion(() => this.frame());
    this.w = this.motion.spring(COMPACT_H);
    this.h = this.motion.spring(COMPACT_H);
    this.r = this.motion.spring(COMPACT_H / 2);

    new ResizeObserver(() => this.relayout()).observe(layers.expanded);
    new ResizeObserver(() => this.relayout()).observe(layers.notification);

    // No DOM mouseleave here: while the window is click-through, Windows reports
    // a leave right after every forwarded move. Leaving is detected from the
    // coordinates themselves, and the main process reports leaving the window.
    document.addEventListener('mousemove', (e) => this.pointer(e.clientX, e.clientY));
    el.addEventListener('click', (e) => this.click(e));
  }

  onMode(fn) {
    this.listeners.push(fn);
  }

  boot() {
    this.frame();
    requestAnimationFrame(() => {
      this.el.classList.add('is-booted');
      this.setMode('compact', 'boot');
    });
  }

  // ── Geometry ────────────────────────────────────────────────────────────
  geometry(mode) {
    switch (mode) {
      case 'expanded':
        return { w: EXPANDED_W, h: this.layers.expanded.offsetHeight, r: 34 };
      case 'notification':
        return { w: NOTIFICATION_W, h: this.layers.notification.offsetHeight, r: 30 };
      case 'activity':
        return { w: this.activity.width, h: ACTIVITY_H, r: ACTIVITY_H / 2 };
      default:
        return { w: this.compactW, h: COMPACT_H, r: COMPACT_H / 2 };
    }
  }

  retarget(preset) {
    const g = this.geometry(this.mode);
    const p = preset && PRESETS[preset];
    this.w.to(g.w, p && { stiffness: p.w[0], damping: p.w[1] });
    this.h.to(g.h, p && { stiffness: p.h[0], damping: p.h[1] });
    this.r.to(g.r, p && { stiffness: p.r[0], damping: p.r[1] });
    this.motion.kick();
  }

  relayout() {
    this.expandedH = this.layers.expanded.offsetHeight || this.expandedH;
    if (this.mode === 'expanded' || this.mode === 'notification') this.retarget();
  }

  frame() {
    const w = this.w.x;
    const h = Math.max(1, this.h.x);
    const r = Math.max(0, Math.min(this.r.x, h / 2, w / 2));
    const s = this.el.style;
    s.width = `${w.toFixed(2)}px`;
    s.height = `${h.toFixed(2)}px`;
    s.borderRadius = `${r.toFixed(2)}px`;
    s.setProperty('--p', clamp((h - COMPACT_H) / (this.expandedH - COMPACT_H), 0, 1).toFixed(3));
    s.setProperty('--lift', clamp((h - COMPACT_H) / 70, 0, 1).toFixed(3));
    this.placeHero(w, h);
  }

  // The artwork lives outside the layers and is interpolated along the same
  // spring as the shape, so it grows out of the pill into the card.
  placeHero(w, h) {
    const p = clamp((h - COMPACT_H) / (this.expandedH - COMPACT_H), 0, 1);
    const size = lerp(HERO.compact, HERO.expanded, p);
    const pillInset = (Math.min(h, ACTIVITY_H) - HERO.compact) / 2;
    // Ride the live left edge with a growing inset, so the art never slips
    // into the corner while the radius is opening up.
    const x = -w / 2 + lerp(pillInset, EXPANDED_PAD.x, p);
    const y = lerp(pillInset, EXPANDED_PAD.y, p);
    const hs = this.hero.style;
    hs.width = hs.height = `${size.toFixed(2)}px`;
    hs.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`;
    hs.borderRadius = `${lerp(HERO.rCompact, HERO.rExpanded, p).toFixed(2)}px`;
  }

  // ── Modes ───────────────────────────────────────────────────────────────
  setMode(mode, preset) {
    const prev = this.mode;
    if (mode === prev) {
      this.retarget(preset);
      return;
    }
    this.mode = mode;
    this.el.dataset.mode = mode;
    for (const [name, layer] of Object.entries(this.layers)) layer.classList.toggle('is-active', name === mode);
    if (mode === 'expanded') this.expandedH = this.layers.expanded.offsetHeight || this.expandedH;
    this.retarget(preset || this.presetFor(prev, mode));
    this.updateHero();
    this.api.setExpanded(mode === 'expanded');
    if (mode === 'notification') this.cancelDwell();
    this.syncPointerState();
    for (const fn of this.listeners) fn(mode, prev);
  }

  presetFor(prev, next) {
    if (next === 'expanded') return 'open';
    if (next === 'notification') return 'pop';
    if (next === 'activity') return prev === 'compact' ? 'pop' : 'settle';
    return 'close';
  }

  evaluate() {
    if (this.suspended) {
      this.setMode('compact');
      return;
    }
    let mode;
    if (this.pinned || this.wantExpand) {
      mode = 'expanded';
    } else {
      if (!this.notification && this.queue.length) this.startNotification(this.queue.shift());
      if (this.notification) mode = 'notification';
      else if (this.activity) mode = 'activity';
      else mode = 'compact';
    }
    this.setMode(mode);
  }

  updateHero() {
    const visible =
      this.mode === 'expanded' ||
      (this.mode === 'compact' && this.hasMedia) ||
      (this.mode === 'activity' && this.activity && this.activity.hero);
    this.hero.classList.toggle('is-visible', !!visible);
  }

  setCompact({ width, hasMedia }) {
    const changed = width !== this.compactW || hasMedia !== this.hasMedia;
    this.compactW = width;
    this.hasMedia = hasMedia;
    this.layers.compact.classList.toggle('is-media', hasMedia);
    this.updateHero();
    if (changed && this.mode === 'compact') this.retarget('settle');
  }

  setPinned(pinned) {
    this.pinned = pinned;
    if (!pinned && !this.over) this.wantExpand = false;
    this.evaluate();
  }

  // A game or full-screen video owns the screen; the window is hidden by the
  // main process. Fold up, stop reacting, and hold notifications for later.
  setSuspended(suspended) {
    if (suspended === this.suspended) return;
    this.suspended = suspended;
    clearTimeout(this.enterTimer);
    clearTimeout(this.leaveTimer);
    if (suspended) {
      this.over = false;
      this.wantExpand = false;
      this.dragging = false;
      this.pressed = false;
      this.cancelDwell();
      this.clearActivity();
      clearTimeout(this.notifTimer);
      this.notification = null;
      this.evaluate();
      // Nobody can see it: land on the final shape instead of animating.
      const g = this.geometry('compact');
      this.w.snap(g.w);
      this.h.snap(g.h);
      this.r.snap(g.r);
      this.frame();
    } else {
      const now = Date.now();
      this.queue = this.queue.filter((n) => now - n.at < 60000);
      this.evaluate();
    }
    for (const fn of this.listeners) fn(this.mode, this.mode);
  }

  escape() {
    if (this.pinned) this.api.unpin();
    this.pinned = false;
    this.wantExpand = false;
    this.suppressed = this.over;
    clearTimeout(this.enterTimer);
    clearTimeout(this.leaveTimer);
    this.evaluate();
  }

  // ── Pointer ─────────────────────────────────────────────────────────────
  pointer(x, y) {
    if (this.suspended) return;
    const r = this.el.getBoundingClientRect();
    const pad = 8;
    const over = x >= r.left - pad && x <= r.right + pad && y >= -1 && y <= r.bottom + pad;
    if (over === this.over) return;
    this.over = over;
    this.syncPointerState();
    if (over) this.enter();
    else this.leave();
  }

  // In the small states the pill gives way to whatever is underneath it.
  yields() {
    return this.passThrough && (this.mode === 'compact' || this.mode === 'activity');
  }

  syncPointerState() {
    const interactive = this.dragging || (this.over && !this.yields());
    if (interactive !== this.interactive) {
      this.interactive = interactive;
      this.api.setInteractive(interactive);
    }
    const ghost = this.over && this.yields();
    this.el.classList.toggle('is-ghost', ghost);
    if (!ghost) this.el.classList.remove('is-arming');
  }

  setPassThrough(enabled) {
    this.passThrough = enabled;
    this.cancelDwell();
    this.syncPointerState();
  }

  // A mouse button went down while the cursor was over us. In pass-through
  // states that click went to the app below — the user is busy there.
  press() {
    if (!this.over || !this.yields()) return;
    this.pressed = true;
    this.cancelDwell();
  }

  cancelDwell() {
    clearTimeout(this.enterTimer);
    clearTimeout(this.armTimer);
    this.el.classList.remove('is-arming');
  }

  setDragging(dragging) {
    this.dragging = dragging;
    this.syncPointerState();
    if (!dragging && !this.over) this.leave();
  }

  enter() {
    clearTimeout(this.leaveTimer);
    if (this.suppressed) return;
    if (this.notification) {
      this.pauseNotification();
      return;
    }
    clearTimeout(this.enterTimer);
    if (this.yields()) {
      if (this.pressed) return;
      this.armTimer = setTimeout(() => this.el.classList.add('is-arming'), ARM_DELAY);
      this.enterTimer = setTimeout(() => {
        this.wantExpand = true;
        this.evaluate();
      }, DWELL);
      return;
    }
    this.enterTimer = setTimeout(() => {
      this.wantExpand = true;
      this.evaluate();
    }, this.mode === 'expanded' ? 0 : 70);
  }

  leave() {
    this.cancelDwell();
    this.pressed = false;
    this.suppressed = false;
    if (this.notification) this.resumeNotification();
    if (this.dragging) return;
    clearTimeout(this.leaveTimer);
    this.leaveTimer = setTimeout(() => {
      this.wantExpand = false;
      this.evaluate();
    }, 380);
  }

  click(e) {
    if (this.mode === 'notification') {
      this.dismissNotification();
      if (this.over) {
        this.wantExpand = true;
        this.evaluate();
      }
    } else if (this.mode !== 'expanded' && !e.defaultPrevented) {
      this.suppressed = false;
      this.wantExpand = true;
      this.evaluate();
    }
  }

  // ── Notifications ───────────────────────────────────────────────────────
  notify(n) {
    n.at = Date.now();
    if (this.suspended || this.mode === 'expanded') {
      this.queue.push(n);
      if (this.queue.length > 5) this.queue.shift();
      return;
    }
    this.clearActivity();
    if (this.notification) {
      this.startNotification(n, true);
      return;
    }
    this.startNotification(n);
    this.evaluate();
  }

  startNotification(n, swap = false) {
    this.notification = n;
    this.el.style.setProperty('--tint', n.color || '#ffffff');
    this.renderNotification(n, swap);
    const len = (n.title || '').length + (n.body || '').length;
    this.notifRemaining = n.duration || clamp(3600 + len * 28, 4200, 7500);
    clearTimeout(this.notifTimer);
    if (this.over) return;
    this.armNotification();
  }

  armNotification() {
    clearTimeout(this.notifTimer);
    this.notifStarted = performance.now();
    this.notifTimer = setTimeout(() => this.dismissNotification(), this.notifRemaining);
  }

  pauseNotification() {
    clearTimeout(this.notifTimer);
    this.notifRemaining = Math.max(1200, this.notifRemaining - (performance.now() - this.notifStarted));
  }

  resumeNotification() {
    this.notifRemaining = Math.max(this.notifRemaining, 1600);
    this.armNotification();
  }

  dismissNotification() {
    clearTimeout(this.notifTimer);
    this.notification = null;
    this.evaluate();
  }

  // ── Live activities ─────────────────────────────────────────────────────
  // activity: { key, width, duration, hero?, render() }
  flash(activity) {
    if (this.suspended || this.mode === 'expanded' || this.notification) return false;
    const same = this.activity && this.activity.key === activity.key;
    const layer = this.layers.activity;
    clearTimeout(this.activityTimer);
    clearTimeout(this.swapTimer);

    if (this.mode === 'activity' && !same) {
      layer.classList.add('is-swapping');
      this.swapTimer = setTimeout(() => {
        this.activity = activity;
        this.el.dataset.activity = activity.key;
        activity.render();
        layer.classList.remove('is-swapping');
        this.updateHero();
        this.retarget('settle');
      }, 110);
    } else {
      this.activity = activity;
      this.el.dataset.activity = activity.key;
      activity.render();
      if (same) this.retarget();
      else this.evaluate();
      this.updateHero();
    }

    this.activityTimer = setTimeout(() => {
      this.activity = null;
      this.evaluate();
    }, activity.duration);
    return true;
  }

  activityKey() {
    return this.mode === 'activity' && this.activity ? this.activity.key : null;
  }

  clearActivity() {
    clearTimeout(this.activityTimer);
    this.activity = null;
  }
}
