#!/usr/bin/env node
/**
 * Morderx — Client CLI
 * Terhubung ke host dan menyimpan frame ke file / menampilkan status.
 * Usage: node src/client-cli.js --host=192.168.1.x [--port=7420] [--password=abc] [--save-frames]
 *
 * Opsi:
 *   --host=IP        IP address host (wajib)
 *   --port=NUM       Port (default: 7420)
 *   --password=STR   Password (default: kosong)
 *   --save-frames    Simpan frame JPEG ke folder ./frames/ (opsional)
 */

'use strict';

const WebSocket = require('ws');
const fs        = require('fs');
const path      = require('path');
const os        = require('os');

// ────────────────────────────────────────────────────────────────────────────
// Parse argumen CLI
// ────────────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

function getArg(name, defaultVal) {
  const found = args.find(a => a.startsWith(`--${name}=`));
  return found ? found.split('=').slice(1).join('=') : defaultVal;
}

const hostIP    = getArg('host', '');
const port      = parseInt(getArg('port', '7420'), 10);
const password  = getArg('password', '');
const saveFrames = args.includes('--save-frames');

if (!hostIP) {
  console.error('');
  console.error('❌ Error: --host wajib diisi.');
  console.error('');
  console.error('Penggunaan:');
  console.error('  node src/client-cli.js --host=192.168.1.x [--port=7420] [--password=abc] [--save-frames]');
  console.error('');
  process.exit(1);
}

// ────────────────────────────────────────────────────────────────────────────
// Setup folder frames (jika --save-frames)
// ────────────────────────────────────────────────────────────────────────────
const framesDir = path.join(process.cwd(), 'frames');
if (saveFrames) {
  if (!fs.existsSync(framesDir)) fs.mkdirSync(framesDir, { recursive: true });
  console.log(`[CLIENT] Frame akan disimpan di: ${framesDir}`);
}

// ────────────────────────────────────────────────────────────────────────────
// Banner
// ────────────────────────────────────────────────────────────────────────────
console.log('');
console.log('╔══════════════════════════════════════════╗');
console.log('║          Morderx — CLIENT MODE           ║');
console.log('╠══════════════════════════════════════════╣');
console.log(`║  Host     : ${hostIP.padEnd(29)}║`);
console.log(`║  Port     : ${String(port).padEnd(29)}║`);
console.log(`║  Password : ${(password ? '*** (set)' : '(none)').padEnd(29)}║`);
console.log(`║  Frames   : ${(saveFrames ? `disimpan → ./frames/` : 'tidak disimpan').padEnd(29)}║`);
console.log('╚══════════════════════════════════════════╝');
console.log('');

// ────────────────────────────────────────────────────────────────────────────
// Koneksi WebSocket
// ────────────────────────────────────────────────────────────────────────────
const url = `ws://${hostIP}:${port}`;
console.log(`[CLIENT] Menghubungkan ke ${url} ...`);

const ws = new WebSocket(url, { handshakeTimeout: 8000 });

let connected    = false;
let pingInterval = null;
let frameCount   = 0;
let lastFpsTime  = Date.now();
let frameIndex   = 0;

ws.on('open', () => {
  console.log('[CLIENT] Terhubung, menunggu autentikasi...');
});

ws.on('message', (raw) => {
  try {
    const msg = JSON.parse(raw.toString());

    switch (msg.type) {

      // ── Auth ──────────────────────────────────────────────────────────────
      case 'auth-required':
        ws.send(JSON.stringify({ type: 'auth', password }));
        break;

      case 'auth-ok':
        connected = true;
        console.log(`✅ Autentikasi berhasil! Client aktif: ${msg.clientCount}`);
        console.log('   Menerima frame dari host...');
        console.log('   Tekan Ctrl+C untuk keluar.\n');

        // Mulai ping untuk latency
        pingInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
          }
        }, 5000);
        break;

      case 'auth-failed':
        console.error('❌ Autentikasi gagal — password salah.');
        ws.close();
        process.exit(1);
        break;

      // ── Frame ─────────────────────────────────────────────────────────────
      case 'frame': {
        frameCount++;
        const now = Date.now();

        // Hitung & tampilkan FPS tiap 3 detik
        if (now - lastFpsTime >= 3000) {
          const fps = (frameCount / ((now - lastFpsTime) / 1000)).toFixed(1);
          frameCount = 0;
          lastFpsTime = now;
          process.stdout.write(`\r[FRAME] ~${fps} fps — frame #${frameIndex}   `);
        }

        // Simpan frame ke file jika --save-frames
        if (saveFrames) {
          const buf      = Buffer.from(msg.data, 'base64');
          const filename = path.join(framesDir, `frame_${String(frameIndex).padStart(6, '0')}.jpg`);
          fs.writeFile(filename, buf, () => {}); // async, non-blocking
        }
        frameIndex++;
        break;
      }

      // ── Pong (latency) ────────────────────────────────────────────────────
      case 'pong': {
        const latency = Date.now() - msg.ts;
        process.stdout.write(`\r[PING ] Latency: ${latency} ms — frame #${frameIndex}   `);
        break;
      }

      default:
        console.log('[CLIENT] Pesan tidak dikenal:', msg.type);
    }
  } catch (err) {
    console.error('[CLIENT] Parse error:', err.message);
  }
});

ws.on('close', (code, reason) => {
  if (pingInterval) clearInterval(pingInterval);
  console.log(`\n[CLIENT] Koneksi terputus (code: ${code})`);
  process.exit(0);
});

ws.on('error', (err) => {
  if (!connected) {
    console.error(`\n❌ Gagal terhubung ke ${url}`);
    console.error(`   ${err.message}`);
    console.error('\nPastikan:');
    console.error('  • Host sudah menjalankan: node src/host-cli.js');
    console.error('  • IP dan port benar');
    console.error('  • Kedua perangkat dalam jaringan yang sama (WiFi/LAN)');
  } else {
    console.error('\n[CLIENT] Error:', err.message);
  }
  process.exit(1);
});

// ────────────────────────────────────────────────────────────────────────────
// Timeout koneksi (10 detik)
// ────────────────────────────────────────────────────────────────────────────
setTimeout(() => {
  if (!connected && ws.readyState !== WebSocket.OPEN) {
    ws.terminate();
    console.error(`\n❌ Timeout — tidak bisa terhubung ke ${url} dalam 10 detik.`);
    process.exit(1);
  }
}, 10000);

// ────────────────────────────────────────────────────────────────────────────
// Graceful shutdown
// ────────────────────────────────────────────────────────────────────────────
process.on('SIGINT', () => {
  console.log('\n\n[CLIENT] Memutuskan koneksi...');
  if (pingInterval) clearInterval(pingInterval);
  if (ws.readyState === WebSocket.OPEN) {
    ws.close(1000, 'Client disconnecting');
  }
  process.exit(0);
});
