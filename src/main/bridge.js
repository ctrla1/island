// Supervises the PowerShell system bridge: media session, master volume, network.
const { spawn } = require('child_process');
const path = require('path');
const { EventEmitter } = require('events');

const SCRIPT = path.join(__dirname, '..', 'bridge', 'system-bridge.ps1').replace('app.asar', 'app.asar.unpacked');

class SystemBridge extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.buffer = '';
    this.restarts = 0;
    this.stopped = false;
    this.lastData = 0;
    this.watchdog = null;
  }

  // The script reports in at least every few seconds. A WinRT call that never
  // returns would freeze it silently — media buttons and volume would stop
  // working — so a bridge that goes quiet is killed and started afresh.
  watch() {
    if (this.watchdog) return;
    this.watchdog = setInterval(() => {
      if (!this.proc || this.stopped) return;
      const quiet = Date.now() - this.lastData;
      if (quiet < 20000) return;
      this.emit('hung', quiet);
      this.restarts = 0;
      try { this.proc.kill(); } catch {}
    }, 5000);
  }

  start() {
    this.stopped = false;
    const proc = spawn('powershell.exe', ['-NoProfile', '-NoLogo', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc = proc;
    this.lastData = Date.now();
    this.watch();
    proc.stdin.on('error', () => {});
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => this.onData(chunk));
    proc.stderr.on('data', (d) => this.emit('log', String(d).trim()));
    proc.on('error', (err) => this.emit('log', `bridge error: ${err.message}`));
    proc.on('exit', (code) => {
      if (this.proc !== proc) return;
      this.proc = null;
      this.emit('down', code);
      if (this.stopped || this.restarts >= 5) return;
      this.restarts += 1;
      setTimeout(() => this.start(), 1500 * this.restarts);
    });
  }

  onData(chunk) {
    this.lastData = Date.now();
    this.buffer += chunk;
    let nl;
    while ((nl = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.type === 'ready') this.restarts = 0;
        // Never re-emit as 'error': an unhandled EventEmitter error would take down the app.
        if (msg.type === 'error') this.emit('log', `bridge command failed: ${msg.message}`);
        else this.emit(msg.type, msg);
      } catch {
        this.emit('log', `bridge: unparsable line (${line.length} chars)`);
      }
    }
  }

  send(cmd) {
    if (!this.proc || !this.proc.stdin.writable) return false;
    this.proc.stdin.write(JSON.stringify(cmd) + '\n');
    return true;
  }

  stop() {
    this.stopped = true;
    clearInterval(this.watchdog);
    this.watchdog = null;
    if (this.proc) {
      try { this.proc.stdin.end(); } catch {}
      const p = this.proc;
      setTimeout(() => { try { p.kill(); } catch {} }, 600);
    }
  }
}

module.exports = { SystemBridge };
