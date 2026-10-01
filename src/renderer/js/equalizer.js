// Equalizer bars driven at a capped frame rate. CSS keyframes tick at the
// display refresh rate (144 Hz on many desktops) and would keep the GPU
// process busy around the clock for a 14px widget. 24 fps of smooth noise
// reads the same and costs a fraction; when no bars are on screen, nothing runs.
const FPS = 24;

export class Equalizer {
  constructor(visibleTargets) {
    this.visibleTargets = visibleTargets;
    this.playing = false;
    this.timer = 0;
  }

  setPlaying(playing) {
    this.playing = playing;
    this.sync();
  }

  sync() {
    const active = this.playing && this.visibleTargets().length > 0;
    if (active && !this.timer) {
      this.tick();
      this.timer = setInterval(() => this.tick(), 1000 / FPS);
    } else if (!active && this.timer) {
      clearInterval(this.timer);
      this.timer = 0;
    }
  }

  tick() {
    const targets = this.visibleTargets();
    if (!targets.length) {
      this.sync();
      return;
    }
    const t = performance.now() / 1000;
    for (const eq of targets) {
      const bars = eq.querySelectorAll('b');
      bars.forEach((bar, i) => {
        const v =
          0.56 +
          0.26 * Math.sin(t * (5.3 + i * 1.9) + i * 2.4) +
          0.18 * Math.sin(t * (9.1 + i * 0.8) + i * 0.9);
        bar.style.transform = `scaleY(${Math.max(0.18, Math.min(1, v)).toFixed(3)})`;
      });
    }
  }
}
