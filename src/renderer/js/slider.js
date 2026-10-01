// Thin capsule slider: grows on hover/drag, no knob — the bar itself is the control.
export class Slider {
  constructor(el, { onInput, onCommit, onDrag } = {}) {
    this.el = el;
    this.onInput = onInput;
    this.onCommit = onCommit;
    this.onDrag = onDrag;
    this.value = 0;
    this.dragging = false;
    this.enabled = true;

    el.innerHTML = '<div class="slider-track"><div class="slider-fill"></div></div>';
    this.track = el.firstElementChild;
    this.fill = this.track.firstElementChild;

    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointercancel', (e) => this.up(e));
  }

  valueAt(e) {
    const r = this.track.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  }

  down(e) {
    if (!this.enabled || e.button !== 0) return;
    this.dragging = true;
    this.el.setPointerCapture(e.pointerId);
    this.el.classList.add('is-dragging');
    this.onDrag?.(true);
    this.render(this.valueAt(e));
    this.onInput?.(this.value);
  }

  move(e) {
    if (!this.dragging) return;
    this.render(this.valueAt(e));
    this.onInput?.(this.value);
  }

  up(e) {
    if (!this.dragging) return;
    this.dragging = false;
    this.el.classList.remove('is-dragging');
    try { this.el.releasePointerCapture(e.pointerId); } catch {}
    this.onDrag?.(false);
    this.onCommit?.(this.value);
  }

  set(v) {
    if (!this.dragging) this.render(v);
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    this.el.classList.toggle('is-disabled', !enabled);
  }

  render(v) {
    this.value = Math.max(0, Math.min(1, v || 0));
    this.fill.style.width = `${(this.value * 100).toFixed(3)}%`;
  }
}
