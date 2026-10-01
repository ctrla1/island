// Damped harmonic spring, integrated with fixed sub-steps so behaviour does not
// depend on frame rate. Retargeting keeps velocity, which is what makes
// interrupted morphs feel continuous instead of restarting.
export class Spring {
  constructor(value = 0) {
    this.x = value;
    this.v = 0;
    this.target = value;
    this.stiffness = 300;
    this.damping = 30;
    this.mass = 1;
  }

  to(target, opts = {}) {
    this.target = target;
    if (opts.stiffness) this.stiffness = opts.stiffness;
    if (opts.damping) this.damping = opts.damping;
    if (opts.mass) this.mass = opts.mass;
    if (opts.velocity !== undefined) this.v = opts.velocity;
  }

  snap(value) {
    this.x = this.target = value;
    this.v = 0;
  }

  step(dt) {
    const h = 1 / 480;
    let remaining = dt;
    while (remaining > 1e-6) {
      const s = Math.min(h, remaining);
      const a = (-this.stiffness * (this.x - this.target) - this.damping * this.v) / this.mass;
      this.v += a * s;
      this.x += this.v * s;
      remaining -= s;
    }
    if (this.resting) {
      this.x = this.target;
      this.v = 0;
    }
  }

  get resting() {
    return Math.abs(this.v) < 0.01 && Math.abs(this.x - this.target) < 0.01;
  }
}

// Shared rAF driver: runs only while something is moving.
export class Motion {
  constructor(onFrame) {
    this.springs = [];
    this.onFrame = onFrame;
    this.raf = 0;
    this.last = 0;
    this.tick = this.tick.bind(this);
  }

  spring(value) {
    const s = new Spring(value);
    this.springs.push(s);
    return s;
  }

  kick() {
    if (this.raf) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  tick(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    let moving = false;
    for (const s of this.springs) {
      s.step(dt);
      if (!s.resting) moving = true;
    }
    this.onFrame();
    this.raf = moving ? requestAnimationFrame(this.tick) : 0;
  }
}

// Bake a spring into a CSS linear() easing so plain CSS transitions get real
// spring motion (overshoot included) without a JS loop.
export function springEasing({ stiffness = 200, damping = 18, mass = 1 } = {}, duration = 0.8, samples = 48) {
  const s = new Spring(0);
  s.to(1, { stiffness, damping, mass });
  const points = ['0'];
  const dt = duration / samples;
  for (let i = 1; i < samples; i++) {
    s.step(dt);
    points.push(s.x.toFixed(4));
  }
  points.push('1');
  return `linear(${points.join(', ')})`;
}

export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
