#!/usr/bin/env node
/**
 * Morderx — Host CLI
 * Menjalankan screen sharing server tanpa Electron.
 * Usage: node src/host-cli.js [--port=7420] [--password=abc]
 */

'use strict';

const os   = require('os');
const path = require('path');
const { startHostServer } = require('./host/server-cli');

// ────────────────────────────────────────────────────────────────────────────
// Parse argumen CLI
// ────────────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

function getArg(name, defaultVal) {
  const found = args.find(a => a.startsWith(`--${name}=`));
  return found ? found.split('=').slice(1).join('=') : defaultVal;
}

const port     = parseInt(getArg('port', '7420'), 10);
const password = getArg('password', '');

// ────────────────────────────────────────────────────────────────────────────
// Tampilkan info jaringan lokal
// ────────────────────────────────────────────────────────────────────────────
function getLocalIPs() {
  const nets = os.networkInterfaces();
  const ips  = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push({ name, address: net.address });
      }
    }
  }
  return ips;
}

// ────────────────────────────────────────────────────────────────────────────
// Banner
// ────────────────────────────────────────────────────────────────────────────
function printBanner() {
  const ips = getLocalIPs();
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║           Morderx — HOST MODE            ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  Port     : ${String(port).padEnd(29)}║`);
  console.log(`║  Password : ${(password ? '*** (set)' : '(none)').padEnd(29)}║`);
  console.log('╠══════════════════════════════════════════╣');
  if (ips.length === 0) {
    console.log('║  IP       : (tidak terdeteksi)           ║');
  } else {
    ips.forEach(ip => {
      console.log(`║  ${ip.name.padEnd(10)}: ${ip.address.padEnd(31)}║`);
    });
  }
  console.log('╚══════════════════════════════════════════╝');
  console.log('');
  console.log('→ Bagikan salah satu IP di atas ke client.');
  console.log('→ Tekan Ctrl+C untuk menghentikan server.');
  console.log('');
}

// ────────────────────────────────────────────────────────────────────────────
// Event callback pengganti mainWindow.webContents.send
// ────────────────────────────────────────────────────────────────────────────
function onHostEvent(event) {
  const time = new Date().toLocaleTimeString('id-ID', { hour12: false });
  switch (event.type) {
    case 'server-started':
      console.log(`[${time}] ✅ Server aktif pada port ${event.port}`);
      break;
    case 'client-connected':
      console.log(`[${time}] 🔗 Client terhubung: ${event.ip} (total: ${event.count})`);
      break;
    case 'client-disconnected':
      console.log(`[${time}] ⚡ Client terputus: ${event.ip} (tersisa: ${event.count})`);
      break;
    case 'server-stopped':
      console.log(`[${time}] 🛑 Server dihentikan`);
      break;
    case 'error':
      console.error(`[${time}] ❌ Error: ${event.message}`);
      break;
    default:
      break;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Start
// ────────────────────────────────────────────────────────────────────────────
printBanner();

startHostServer({ port, password, onEvent: onHostEvent })
  .then(() => {
    console.log(`[HOST] Server berjalan. Menunggu client...\n`);
  })
  .catch(err => {
    console.error('[HOST] Gagal memulai server:', err.message);
    process.exit(1);
  });

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[HOST] Menerima SIGINT — menghentikan server...');
  process.exit(0);
});
process.on('SIGTERM', () => {
  console.log('\n[HOST] Menerima SIGTERM — menghentikan server...');
  process.exit(0);
});
