#!/usr/bin/env node
/**
 * Morderx — Browser Server
 * HOST  : node server.js [--port=3000] [--password=abc] [--no-open]
 * CLIENT: buka http://HOST_IP:3000 di browser
 */
'use strict';

const http           = require('http');
const fs             = require('fs');
const path           = require('path');
const os             = require('os');
const { exec }       = require('child_process');
const WebSocket      = require('ws');
const { createHash } = require('crypto');
const { captureScreen } = require('./src/host/capture');
const { executeInput }  = require('./src/host/input');

// ── CLI Args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (name, def) => {
  const f = args.find(a => a.startsWith(`--${name}=`));
  return f ? f.split('=').slice(1).join('=') : def;
};
const PORT     = parseInt(getArg('port', '3000'), 10);
const PASSWORD = getArg('password', '');
const NO_OPEN  = args.includes('--no-open');

// ── HTTP Server ───────────────────────────────────────────────────────────────
const RENDERER_DIR = path.join(__dirname, 'src', 'renderer');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.png':  'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
};

const httpServer = http.createServer((req, res) => {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/viewer.html';

  const filePath = path.resolve(RENDERER_DIR, urlPath.slice(1));
  if (!filePath.startsWith(RENDERER_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

// ── WebSocket Server ──────────────────────────────────────────────────────────
const wss     = new WebSocket.Server({ server: httpServer });
const viewers = new Set();

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress || 'unknown';
  let authed = false;

  ws.send(JSON.stringify({ type: 'auth-required' }));

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (!authed) {
        if (msg.type === 'auth' && verifyPassword(msg.password, PASSWORD)) {
          authed = true;
          viewers.add(ws);
          ws.send(JSON.stringify({ type: 'auth-ok', viewerCount: viewers.size, ips: getLocalIPs(), hostname: os.hostname() }));
          log(`✅ Viewer terhubung: ${ip} (total: ${viewers.size})`);
        } else {
          ws.send(JSON.stringify({ type: 'auth-failed' }));
          ws.close();
        }
        return;
      }

      if (msg.type === 'input')      executeInput(msg.data);
      else if (msg.type === 'ping')  ws.send(JSON.stringify({ type: 'pong', ts: msg.ts }));
    } catch (e) { /* ignore */ }
  });

  ws.on('close', () => { viewers.delete(ws); log(`⚡ Viewer terputus: ${ip} (sisa: ${viewers.size})`); });
  ws.on('error', () => viewers.delete(ws));
});

const broadcast = (data) => {
  const msg = typeof data === 'string' ? data : JSON.stringify(data);
  for (const ws of viewers) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg, (err) => { if (err) viewers.delete(ws); });
  }
};

// ── Capture Loop ──────────────────────────────────────────────────────────────
const FRAME_MS = Math.round(1000 / 15);
let lastHash = null;
let captureLoop = null;

function startCapture() {
  captureLoop = setInterval(async () => {
    if (viewers.size === 0) return;
    try {
      const buf = await captureScreen();
      if (!buf) return;
      const hash = createHash('md5').update(buf.slice(0, 1000)).digest('hex');
      if (hash === lastHash) return;
      lastHash = hash;
      broadcast({ type: 'frame', data: buf.toString('base64'), format: 'jpeg', ts: Date.now() });
    } catch (e) { /* ignore */ }
  }, FRAME_MS);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getLocalIPs() {
  const result = [];
  for (const [name, nets] of Object.entries(os.networkInterfaces())) {
    for (const net of nets) {
      if (net.family === 'IPv4' && !net.internal) result.push({ name, address: net.address });
    }
  }
  return result;
}

function verifyPassword(provided, actual) {
  if (!actual) return true;
  if (!provided) return false;
  const h = (s) => createHash('sha256').update(s).digest('hex');
  return h(provided) === h(actual);
}

function log(msg) {
  console.log(`[${new Date().toLocaleTimeString('id-ID', { hour12: false })}] ${msg}`);
}

// ── Start ─────────────────────────────────────────────────────────────────────
httpServer.listen(PORT, '0.0.0.0', () => {
  const ips = getLocalIPs();
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║        Morderx — Browser Server              ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║  Port     : ${String(PORT).padEnd(33)}║`);
  console.log(`║  Password : ${(PASSWORD ? '*** (set)' : '(none)').padEnd(33)}║`);
  console.log('╠══════════════════════════════════════════════╣');
  ips.forEach(({ name, address }) => {
    console.log(`║  ${(name + ':').padEnd(12)} http://${address}:${PORT}`.padEnd(47) + '║');
  });
  console.log(`║  Local  :   http://localhost:${PORT}`.padEnd(47) + '║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('\n→ Bagikan link IP di atas ke client (browser).');
  console.log('→ Ctrl+C untuk berhenti.\n');

  startCapture();

  if (!NO_OPEN) {
    const url = `http://localhost:${PORT}`;
    const cmd = process.platform === 'darwin' ? `open "${url}"` : process.platform === 'win32' ? `start "${url}"` : `xdg-open "${url}"`;
    exec(cmd);
  }
});

process.on('SIGINT',  () => { clearInterval(captureLoop); process.exit(0); });
process.on('SIGTERM', () => { clearInterval(captureLoop); process.exit(0); });
