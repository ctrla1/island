import { icon } from './icons.js';
import { t, intlLocale } from './i18n.js';

function appIcon(n) {
  const wrap = document.createElement('div');
  wrap.className = 'n-icon';
  if (n.icon === 'calendar') {
    const now = new Date();
    wrap.classList.add('is-calendar');
    wrap.innerHTML = '<span class="cal-day"></span><span class="cal-num"></span>';
    wrap.children[0].textContent = new Intl.DateTimeFormat(intlLocale(), { weekday: 'short' }).format(now).replace(/\.$/, '').toUpperCase();
    wrap.children[1].textContent = String(now.getDate());
    return wrap;
  }
  wrap.style.setProperty('--c', n.color || '#636366');
  wrap.innerHTML = icon(n.icon) || icon('bell');
  return wrap;
}

export function createNotificationRenderer(layer) {
  return function render(n, swap) {
    const old = layer.querySelector('.n-card:not(.is-leaving)');
    const card = document.createElement('div');
    card.className = 'n-card is-entering';
    card.appendChild(appIcon(n));

    const text = document.createElement('div');
    text.className = 'n-text';
    text.innerHTML = `
      <div class="n-line n-meta"><span class="n-app"></span><span class="n-when"></span></div>
      <div class="n-line n-title"></div>
      <div class="n-line n-body"></div>`;
    text.querySelector('.n-app').textContent = n.app;
    text.querySelector('.n-when').textContent = t('now');
    text.querySelector('.n-title').textContent = n.title || '';
    const body = text.querySelector('.n-body');
    body.textContent = n.body || '';
    if (!n.body) body.remove();
    if (!n.title) text.querySelector('.n-title').remove();
    card.appendChild(text);

    if (old) {
      if (swap) {
        old.classList.add('is-leaving');
        setTimeout(() => old.remove(), 260);
      } else {
        old.remove();
      }
    }
    layer.querySelectorAll('.n-card.is-leaving').forEach((el) => {
      if (el !== old) el.remove();
    });
    layer.appendChild(card);
    setTimeout(() => card.classList.remove('is-entering'), 1200);
  };
}
