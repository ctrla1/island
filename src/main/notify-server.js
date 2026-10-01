// Local endpoint so scripts and other tools can push notifications into the island:
//   POST http://127.0.0.1:47800/notify  {"app":"Build","title":"Done","body":"All green","icon":"check"}
// Requests must be application/json, which keeps browser pages from posting without a CORS preflight.
const http = require('http');

const PORT = 47800;

function startNotifyServer(onNotify, onLog) {
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/notify' || !String(req.headers['content-type'] || '').startsWith('application/json')) {
      res.writeHead(404).end();
      return;
    }
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 8192) req.destroy();
    });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
        const payload = {
          app: str(data.app, 40) || 'Notification',
          title: str(data.title, 120),
          body: str(data.body, 280),
          icon: str(data.icon, 20) || 'bell',
          color: /^#[0-9a-f]{6}$/i.test(data.color || '') ? data.color : null,
        };
        if (!payload.title && !payload.body) throw new Error('empty');
        onNotify(payload);
        res.writeHead(204).end();
      } catch {
        res.writeHead(400).end();
      }
    });
  });
  server.on('error', (err) => onLog(`notify server: ${err.message}`));
  server.listen(PORT, '127.0.0.1');
  return server;
}

module.exports = { startNotifyServer, PORT };
