import { Island } from './island.js';
import { NowPlaying } from './nowplaying.js';
import { QuickInfo } from './quickinfo.js';
import { ClipboardPanel } from './clipboard.js';
import { Shelf, SnippetsPanel } from './snippets.js';
import { createNotificationRenderer } from './notifications.js';
import { springEasing } from './spring.js';
import { hydrateIcons, icon } from './icons.js';
import { setLocale, t, demoNotifications, demoClips } from './i18n.js';

const api = window.island;

// Real spring curves for CSS-driven micro-interactions.
const root = document.documentElement.style;
const SPRING_POP = springEasing({ stiffness: 230, damping: 15 }, 1.0);
const SPRING_SOFT = springEasing({ stiffness: 200, damping: 21 }, 0.9);
const SPRING_PRESS = springEasing({ stiffness: 420, damping: 24 }, 0.6);
root.setProperty('--spring-pop', SPRING_POP);
root.setProperty('--spring-soft', SPRING_SOFT);
root.setProperty('--spring-press', SPRING_PRESS);

document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('wheel', (e) => e.ctrlKey && e.preventDefault(), { passive: false });
document.addEventListener('dragstart', (e) => e.preventDefault());

async function start() {
  const init = await api.init();
  setLocale(init.locale);
  hydrateIcons();

  let settings = init.settings;
  const $ = (id) => document.getElementById(id);

  const island = new Island({
    el: $('island'),
    hero: $('hero'),
    api,
    layers: {
      compact: $('layer-compact'),
      activity: $('layer-activity'),
      notification: $('layer-notification'),
      expanded: $('layer-expanded'),
    },
    renderNotification: createNotificationRenderer($('layer-notification')),
  });
  island.setPassThrough(settings.passThrough !== false);
  island.setAppBelow(init.appBelow !== false);

  const quick = new QuickInfo({ island, forceDemo: init.forceDemo });
  const shelf = new Shelf({ island });
  const clips = new ClipboardPanel({ api, island, springEase: SPRING_SOFT });
  const snippets = new SnippetsPanel({
    api,
    island,
    shelf,
    springEase: SPRING_SOFT,
    getSettings: () => settings,
    onList: (list) => clips.setSnippets(list),
  });
  const player = new NowPlaying({ island, api, settings, forceDemo: init.forceDemo });

  if (init.system) quick.update(init.system);
  const realClips = init.clips || [];
  clips.setItems(init.forceDemo && !realClips.length ? demoClips() : realClips);
  snippets.setList(init.snippets || [], 'init');
  if (init.media && init.media.active) player.setSystem(init.media);
  else player.refresh();
  if (init.volume) player.onSystemVolume(init.volume);

  api.on('media', (msg) => player.setSystem(msg));
  api.on('volume', (msg) => player.onSystemVolume(msg));
  api.on('system', (state) => quick.update(state));
  api.on('clips', (list) => clips.setItems(list));
  api.on('clip:captured', (item) => {
    if (!settings.copyIndicator) return;
    island.flash({
      key: 'copied',
      width: item.kind === 'image' ? 236 : 300,
      duration: 1700,
      render: () => clips.renderCopiedActivity(item),
    });
  });
  api.on('snippets', ({ list, reason }) => snippets.setList(list, reason));
  api.on('snippet:used', (used) => {
    island.flash({ key: 'snippet', width: 300, duration: 1700, render: () => snippets.renderUsedActivity(used) });
  });
  api.on('editor:blur', () => snippets.closeEditor({ keepDraft: true }));
  api.on('notify', (n) => island.notify(n));
  api.on('charging', (power) => showCharging(power));
  api.on('escape', () => island.escape());
  api.on('pin', (pinned) => island.setPinned(pinned));
  api.on('fullscreen', (active) => island.setSuspended(active));
  api.on('appBelow', (below) => island.setAppBelow(below));
  // The main process also reports where the cursor is: a second source next to
  // the mouse events forwarded into this click-through window, which Windows can
  // silently stop delivering.
  api.on('pointer', ({ inside, press, x, y }) => {
    if (!inside) island.pointer(-1e4, -1e4);
    else if (typeof x === 'number') island.pointer(x, y);
    if (press) island.press();
  });
  api.on('settings', (next) => {
    settings = next;
    player.setSettings(next);
    island.setPassThrough(next.passThrough !== false);
  });

  let demoIndex = 0;
  api.on('demo', (kind) => {
    if (kind === 'notification') {
      const list = demoNotifications();
      island.notify({ ...list[demoIndex % list.length] });
      demoIndex += 1;
    } else if (kind === 'charging') {
      const p = (quick.state && quick.state.power) || {};
      showCharging({ percent: p.present && p.percent !== null ? p.percent : 76 });
    }
  });

  function showCharging(power) {
    const pct = power.percent ?? 0;
    island.flash({
      key: 'charging',
      width: 280,
      duration: 3200,
      render: () => {
        const left = $('a-left');
        const right = $('a-right');
        left.className = 'a-left';
        left.innerHTML = `<span class="a-icon a-green a-bolt">${icon('bolt')}</span><span></span>`;
        left.lastElementChild.textContent = t('charging');
        right.className = 'a-right a-green';
        right.innerHTML = `<span class="a-pct">${pct}%</span><span class="a-battery">${icon('battery', pct / 100, false)}</span>`;
      },
    });
  }

  if (init.pinned) island.setPinned(true);
  if (init.fullscreen) island.setSuspended(true);
  island.boot();

  // Handy for poking at states from DevTools.
  window.__island = { island, player, clips, quick, showCharging, snippets, shelf };
}

start();
