// Hand-tuned 24px glyphs. Filled transport glyphs, 1.75px strokes elsewhere.
const stroke = (body, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" ${extra}>${body}</svg>`;
const fill = (body) => `<svg viewBox="0 0 24 24" fill="currentColor">${body}</svg>`;

export const icons = {
  play: fill('<path d="M7.2 5.35v13.3c0 1.02 1.1 1.66 1.99 1.15l11.36-6.65c.87-.51.87-1.79 0-2.3L9.19 4.2c-.89-.51-1.99.13-1.99 1.15z"/>'),
  pause: fill('<rect x="6" y="4.6" width="4.4" height="14.8" rx="1.35"/><rect x="13.6" y="4.6" width="4.4" height="14.8" rx="1.35"/>'),
  next: fill('<path d="M2.6 7.06v9.88c0 .82.92 1.3 1.6.83l7.04-4.94a1 1 0 0 0 0-1.66L4.2 6.23c-.68-.47-1.6.01-1.6.83z"/><path d="M11.6 7.06v9.88c0 .82.92 1.3 1.6.83l7.04-4.94a1 1 0 0 0 0-1.66L13.2 6.23c-.68-.47-1.6.01-1.6.83z"/>'),
  prev: fill('<path d="M21.4 7.06v9.88c0 .82-.92 1.3-1.6.83l-7.04-4.94a1 1 0 0 1 0-1.66l7.04-4.94c.68-.47 1.6.01 1.6.83z"/><path d="M12.4 7.06v9.88c0 .82-.92 1.3-1.6.83L3.76 12.83a1 1 0 0 1 0-1.66l7.04-4.94c.68-.47 1.6.01 1.6.83z"/>'),
  note: stroke('<path d="M9 18.2V6.4l10-2v11.4"/><circle cx="6.6" cy="18.2" r="2.4"/><circle cx="16.6" cy="15.8" r="2.4"/>'),
  speaker: (level = 1, muted = false) => {
    const waves = muted
      ? '<path d="M16.5 9.5l5 5M21.5 9.5l-5 5"/>'
      : `<path d="M16 9.2a4 4 0 0 1 0 5.6" opacity="${level > 0.02 ? 1 : 0.25}"/><path d="M18.6 6.6a7.6 7.6 0 0 1 0 10.8" opacity="${level > 0.5 ? 1 : 0.25}"/>`;
    return stroke(`<path d="M4 9.6v4.8c0 .5.4.9.9.9h2.6l4.1 3.4c.6.5 1.4.1 1.4-.7V6c0-.8-.8-1.2-1.4-.7L7.5 8.7H4.9c-.5 0-.9.4-.9.9z" fill="currentColor" stroke="none"/>${waves}`);
  },
  battery: (level = 1, charging = false) => {
    const w = Math.max(0, Math.min(1, level)) * 18.6;
    const bolt = charging
      ? '<path d="M14.6 3.4 10.1 10h3.2l-1.7 4.6 4.6-6.7H13z" fill="#000" stroke="#000" stroke-width="2.2" stroke-linejoin="round"/><path d="M14.6 3.4 10.1 10h3.2l-1.7 4.6 4.6-6.7H13z" fill="currentColor"/>'
      : '';
    return `<svg viewBox="0 0 27 18" fill="none"><rect x=".75" y="3.25" width="22.5" height="11.5" rx="3.6" stroke="currentColor" stroke-opacity=".45" stroke-width="1.3"/><rect x="24.4" y="7" width="1.9" height="4" rx=".95" fill="currentColor" fill-opacity=".45"/><rect x="2.7" y="5.2" width="${w.toFixed(2)}" height="7.6" rx="2" class="battery-fill" fill="currentColor"/>${bolt}</svg>`;
  },
  bolt: fill('<path d="M13.4 2.6 5.6 13.2c-.36.5 0 1.2.62 1.2H11l-1.3 6.36c-.13.66.72 1.03 1.12.48l7.6-10.6c.36-.5 0-1.2-.62-1.2H13l1.5-6.08c.16-.67-.7-1.06-1.1-.5z"/>'),
  plug: stroke('<path d="M9 3v4.5M15 3v4.5"/><path d="M6.5 7.5h11v3.2a5.5 5.5 0 0 1-11 0z"/><path d="M12 16.2V21"/>'),
  wifi: (bars = 3, online = true) => {
    const o = (n) => (bars >= n ? 1 : 0.25);
    const slash = online ? '' : '<path d="M4 4l16 16" stroke-width="1.9"/>';
    return stroke(`<path d="M2.9 9.2a13.2 13.2 0 0 1 18.2 0" opacity="${o(3)}"/><path d="M6.1 12.6a8.6 8.6 0 0 1 11.8 0" opacity="${o(2)}"/><path d="M9.3 15.9a4 4 0 0 1 5.4 0" opacity="${o(1)}"/><circle cx="12" cy="19" r="1.1" fill="currentColor" stroke="none"/>${slash}`);
  },
  ethernet: stroke('<rect x="3.5" y="4" width="17" height="13" rx="2.6"/><path d="M8 17v3h8v-3"/><path d="M8.5 8.5v3M12 8.5v3M15.5 8.5v3"/>'),
  globe: stroke('<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.3 3.6 5.1 3.6 8.5s-1.2 6.2-3.6 8.5c-2.4-2.3-3.6-5.1-3.6-8.5s1.2-6.2 3.6-8.5z"/>'),
  clipboard: stroke('<rect x="5" y="4.5" width="14" height="16.5" rx="3"/><path d="M9 4.5V4a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 4v.5a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 9 4.5z" fill="currentColor"/>'),
  text: stroke('<path d="M5 6.5h14M5 11h14M5 15.5h9"/>'),
  link: stroke('<path d="M10.2 13.8a4 4 0 0 0 5.66 0l3.06-3.06a4 4 0 0 0-5.66-5.66l-1.1 1.1"/><path d="M13.8 10.2a4 4 0 0 0-5.66 0l-3.06 3.06a4 4 0 0 0 5.66 5.66l1.1-1.1"/>'),
  color: stroke('<path d="M12 3.2s6 6.1 6 10.6a6 6 0 0 1-12 0C6 9.3 12 3.2 12 3.2z"/>'),
  code: stroke('<path d="m8.5 7.5-4.5 4.5 4.5 4.5M15.5 7.5l4.5 4.5-4.5 4.5"/>'),
  image: stroke('<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="9.6" r="1.6"/><path d="m4 17 4.6-4.4a1.6 1.6 0 0 1 2.2 0l5.7 5.4M14.5 15l1.6-1.5a1.6 1.6 0 0 1 2.2 0l2.2 2"/>'),
  email: stroke('<circle cx="12" cy="12" r="3.6"/><path d="M15.6 12v1.4a2.6 2.6 0 0 0 5.2 0V12a8.8 8.8 0 1 0-3.5 7"/>'),
  check: stroke('<path d="m5.5 12.5 4.2 4.2 8.8-9.4"/>', 'stroke-width="2.2"'),
  chevron: stroke('<path d="m7 10 5 5 5-5"/>', 'stroke-width="2"'),
  cpu: stroke('<rect x="6" y="6" width="12" height="12" rx="2.6"/><path d="M9.5 3v3M14.5 3v3M9.5 18v3M14.5 18v3M3 9.5h3M3 14.5h3M18 9.5h3M18 14.5h3"/>'),
  memory: stroke('<rect x="3" y="7" width="18" height="10" rx="2.2"/><path d="M7 7v10M11 7v10M15 7v10M3 17v2M21 17v2"/>'),
  wave: stroke('<path d="M4 12h1.5M8 8v8M11.5 5v14M15 9v6M18.5 11v2"/>'),

  // Notification app glyphs (white on tinted squircles)
  messages: fill('<path d="M12 4.2c-4.86 0-8.8 3.25-8.8 7.26 0 2.3 1.3 4.35 3.34 5.68-.13 1.06-.62 2.05-1.37 2.83 1.6.06 3.15-.44 4.38-1.43.78.17 1.6.26 2.45.26 4.86 0 8.8-3.25 8.8-7.34S16.86 4.2 12 4.2z"/>'),
  mail: stroke('<rect x="3.2" y="5.5" width="17.6" height="13" rx="2.6"/><path d="m4 7.2 7.06 5.3a1.6 1.6 0 0 0 1.88 0L20 7.2"/>', 'stroke-width="1.9"'),
  reminders: stroke('<circle cx="6" cy="7" r="1.4" fill="currentColor"/><circle cx="6" cy="12" r="1.4" fill="currentColor"/><circle cx="6" cy="17" r="1.4" fill="currentColor"/><path d="M10 7h9M10 12h9M10 17h6"/>', 'stroke-width="2"'),
  box: stroke('<path d="M12 3.2 20 7.4v9.2L12 20.8 4 16.6V7.4z"/><path d="m4 7.4 8 4.2 8-4.2M12 11.6v9.2"/>', 'stroke-width="1.9"'),
  bell: stroke('<path d="M6.2 16.5V11a5.8 5.8 0 0 1 11.6 0v5.5l1.6 1.8H4.6z" fill="currentColor"/><path d="M10 20.2a2.2 2.2 0 0 0 4 0"/>', 'stroke-width="1.9"'),
  build: stroke('<path d="m5.5 12.5 4.2 4.2 8.8-9.4"/>', 'stroke-width="2.4"'),
};

export function icon(name, ...args) {
  const v = icons[name];
  if (!v) return '';
  return typeof v === 'function' ? v(...args) : v;
}

export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    el.innerHTML = icon(el.dataset.icon);
  });
}
