#!/usr/bin/env node
/**
 * Morderx — Browser Server (WebRTC)
 *
 * Mode baru: server ini TIDAK lagi menangkap layar sendiri (yang dulu bikin 1 FPS).
 * Sekarang ia hanya:
 *   1. Menyajikan halaman host & viewer.
 *   2. Merelay sinyal WebRTC (SDP/ICE) antara host ↔ viewer.
 *   3. Meneruskan input mouse/keyboard dari viewer ke robotjs.
 *
 * Capture & encode layar dilakukan oleh browser engine di halaman host
 * (getDisplayMedia → WebRTC), sehingga ber-akselerasi hardware = 30-60 FPS.
 *
 * HOST   : buka  http://localhost:PORT/host  (di mesin yang dibagikan), klik "Bagikan Layar".
 * CLIENT : buka  http://HOST_IP:PORT         di browser.
 */
'use strict';

const { exec }       = require('child_process');
const { createWebServer } = require('./src/host/web-server');
const { getLocalIPs } = require('./src/host/signaling');

// ── CLI Args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (name, def) => {
  const f = args.find(a => a.startsWith(`--${name}=`));
  return f ? f.split('=').slice(1).join('=') : def;
};
const PORT     = parseInt(getArg('port', '3000'), 10);
const PASSWORD = getArg('password', '');
const NO_OPEN  = args.includes('--no-open');

function log(msg) {
  console.log(`[${new Date().toLocaleTimeString('id-ID', { hour12: false })}] ${msg}`);
}

// ── HTTP + Signaling Server ─────────────────────────────────────────────────────
const httpServer = createWebServer({ password: PASSWORD, log });

// ── Start ─────────────────────────────────────────────────────────────────────
httpServer.listen(PORT, '0.0.0.0', () => {
  const ips = getLocalIPs();
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║        Morderx — Browser Server (WebRTC)     ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║  Port     : ${String(PORT).padEnd(33)}║`);
  console.log(`║  Password : ${(PASSWORD ? '*** (set)' : '(none)').padEnd(33)}║`);
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║  HOST   :   http://localhost:${PORT}/host`.padEnd(47) + '║');
  ips.forEach(({ name, address }) => {
    console.log(`║  ${(name + ':').padEnd(12)} http://${address}:${PORT}`.padEnd(47) + '║');
  });
  console.log('╚══════════════════════════════════════════════╝');
  console.log('\n→ Di mesin ini: buka halaman HOST lalu klik "Bagikan Layar".');
  console.log('→ Bagikan link IP di atas ke client (browser).');
  console.log('→ Ctrl+C untuk berhenti.\n');

  if (!NO_OPEN) {
    const url = `http://localhost:${PORT}/host`;
    const cmd = process.platform === 'darwin' ? `open "${url}"` : process.platform === 'win32' ? `start "" "${url}"` : `xdg-open "${url}"`;
    exec(cmd);
  }
});

process.on('SIGINT',  () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
