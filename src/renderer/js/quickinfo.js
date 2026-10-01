import { icon } from './icons.js';
import { t, intlLocale } from './i18n.js';

function sparkPath(values) {
  const n = values.length;
  const pts = values.map((v, i) => [(i / (n - 1)) * 100, 38 - Math.max(0.02, Math.min(1, v)) * 30]);
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < n; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const cx = (x0 + x1) / 2;
    d += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`;
  }
  return { line: d, area: `${d} L100,40 L0,40 Z` };
}

export class QuickInfo {
  constructor({ island, forceDemo = false }) {
    this.island = island;
    this.forceDemo = forceDemo;
    this.state = null;
    const $ = (id) => document.getElementById(id);
    this.el = {
      time: $('qi-time'),
      date: $('qi-date'),
      compactTime: $('c-time'),
      compactStatus: $('c-status'),
      power: $('tile-power'),
      net: $('tile-net'),
      cpu: $('tile-cpu'),
      mem: $('tile-mem'),
    };
    this.el.cpu.querySelector('.tile-label').textContent = t('cpu');
    this.el.mem.querySelector('.tile-label').textContent = t('memory');

    this.timeFmt = new Intl.DateTimeFormat(intlLocale(), { hour: '2-digit', minute: '2-digit', hour12: false });
    this.dateFmt = new Intl.DateTimeFormat(intlLocale(), { weekday: 'short', day: 'numeric', month: 'short' });
    this.clock();
    const msToMinute = 60000 - (Date.now() % 60000);
    setTimeout(() => {
      this.clock();
      setInterval(() => this.clock(), 60000);
    }, msToMinute + 20);
  }

  clock() {
    const now = new Date();
    const time = this.timeFmt.format(now);
    const date = this.dateFmt.format(now).replace(/\.$/, '');
    this.el.time.textContent = time;
    this.el.compactTime.textContent = time;
    this.el.date.textContent = date.charAt(0).toUpperCase() + date.slice(1);
  }

  update(state) {
    if (!state) return;
    this.state = state;
    this.renderPower(state.power);
    this.renderNetwork(state.network);
    this.renderCpu(state);
    this.renderMemory(state);
    this.renderCompactStatus(state);
  }

  setTile(tile, { label, icon: glyph, value, sub, cls }) {
    if (label !== undefined) tile.querySelector('.tile-label').textContent = label;
    if (glyph !== undefined) {
      const holder = tile.querySelector('.tile-icon');
      if (holder.dataset.glyph !== glyph) {
        holder.innerHTML = glyph;
        holder.dataset.glyph = glyph;
      }
    }
    if (value !== undefined) {
      const v = tile.querySelector('.tile-value');
      if (v.innerHTML !== value) v.innerHTML = value;
    }
    if (sub !== undefined) tile.querySelector('.tile-sub').textContent = sub;
    if (cls !== undefined) tile.dataset.state = cls;
  }

  renderPower(power) {
    if (power && power.present && power.percent !== null) {
      const pct = power.percent;
      const cls = power.charging || power.ac ? 'charging' : pct <= 20 ? 'low' : 'normal';
      this.setTile(this.el.power, {
        label: power.charging ? t('charging') : t('battery'),
        icon: icon('battery', pct / 100, power.charging || power.ac),
        value: `${pct}<small>%</small>`,
        cls,
      });
    } else {
      this.setTile(this.el.power, { label: t('power'), icon: icon('plug'), value: `<span class="tile-text">${t('onAC')}</span>`, cls: 'normal' });
    }
  }

  renderNetwork(net) {
    // Recording mode keeps the real network name off camera.
    if (this.forceDemo) net = { kind: 'wifi', name: 'Studio 5G', online: true, bars: 5 };
    if (!net || net.kind === 'none' || !net.name) {
      this.setTile(this.el.net, { label: t('offline'), icon: icon('wifi', 0, false), value: '<span class="tile-text">—</span>', cls: 'offline' });
      return;
    }
    const label = net.kind === 'wifi' ? t('wifi') : net.kind === 'cellular' ? t('cellular') : t('ethernet');
    const glyph = net.kind === 'wifi' ? icon('wifi', Math.min(3, Math.ceil((net.bars || 3) * 0.6)), net.online) : net.online ? icon('ethernet') : icon('wifi', 0, false);
    const name = net.name.replace(/[<>&]/g, '');
    this.setTile(this.el.net, {
      label: net.online ? label : t('noInternet'),
      icon: glyph,
      value: `<span class="tile-text"></span>`,
      cls: net.online ? 'normal' : 'offline',
    });
    this.el.net.querySelector('.tile-text').textContent = name;
  }

  renderCpu(state) {
    const pct = Math.round(state.cpu * 100);
    this.setTile(this.el.cpu, { value: `${pct}<small>%</small>`, sub: '' });
    if (this.island.mode !== 'expanded' && this.sparkDrawn) return;
    const { line, area } = sparkPath(state.cpuHistory);
    this.el.cpu.querySelector('.spark-line').setAttribute('d', line);
    this.el.cpu.querySelector('.spark-area').setAttribute('d', area);
    this.sparkDrawn = true;
  }

  renderMemory(state) {
    const ratio = state.memUsed / state.memTotal;
    const used = (state.memUsed / 1024 ** 3).toFixed(1);
    this.setTile(this.el.mem, { value: `${Math.round(ratio * 100)}<small>%</small>`, sub: `${used} ${t('gb')}` });
  }

  renderCompactStatus(state) {
    const p = state.power;
    let glyph;
    let cls = '';
    if (p && p.present && p.percent !== null) {
      glyph = icon('battery', p.percent / 100, p.charging);
      cls = p.charging ? 'is-charging' : p.percent <= 20 ? 'is-low' : '';
    } else {
      const n = state.network;
      glyph = !n || !n.online ? icon('wifi', 0, false) : n.kind === 'wifi' ? icon('wifi', 3, true) : icon('globe');
    }
    const el = this.el.compactStatus;
    if (el.dataset.glyph !== glyph) {
      el.innerHTML = glyph;
      el.dataset.glyph = glyph;
    }
    el.className = `c-status ${cls}`;
  }
}
