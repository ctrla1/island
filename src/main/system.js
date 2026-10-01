// Lightweight system vitals: CPU load, memory, power. Network comes from the bridge.
const os = require('os');
const { EventEmitter } = require('events');
const { powerStatus } = require('./win32');

function cpuTimes() {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    const t = cpu.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

class SystemMonitor extends EventEmitter {
  constructor() {
    super();
    this.prev = cpuTimes();
    this.history = new Array(28).fill(0);
    this.network = { online: true, kind: 'none', name: '', bars: 0 };
    this.state = null;
    this.timer = null;
  }

  start() {
    this.sample();
    this.timer = setInterval(() => this.sample(), 1000);
  }

  stop() {
    clearInterval(this.timer);
  }

  setNetwork(net) {
    this.network = { online: net.online, kind: net.kind, name: net.name || '', bars: net.bars || 0 };
    if (this.state) {
      this.state.network = this.network;
      this.emit('update', this.state);
    }
  }

  sample() {
    const now = cpuTimes();
    const dIdle = now.idle - this.prev.idle;
    const dTotal = now.total - this.prev.total;
    this.prev = now;
    const cpu = dTotal > 0 ? Math.max(0, Math.min(1, 1 - dIdle / dTotal)) : 0;
    this.history.push(cpu);
    this.history.shift();

    const total = os.totalmem();
    const free = os.freemem();
    const prevPower = this.state && this.state.power;
    const power = powerStatus() || { present: false, ac: true, charging: false, percent: null };

    this.state = {
      cpu,
      cpuHistory: this.history.slice(),
      memUsed: total - free,
      memTotal: total,
      power,
      network: this.network,
    };
    this.emit('update', this.state);

    if (prevPower && power.present && power.ac && !prevPower.ac) this.emit('plugged', power);
  }
}

module.exports = { SystemMonitor };
