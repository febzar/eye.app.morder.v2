#!/usr/bin/env node
/**
 * Morderx — Manajer server lintas-platform (Windows / macOS / Linux).
 *
 * Menggantikan npm scripts berbasis shell Unix (nohup/kill/tail/ps) yang tidak
 * jalan di Windows. Semua dilakukan dengan API Node bawaan.
 *
 * Perintah:
 *   node scripts/serve.js start [--no-open]   Jalankan "node server.js" di background.
 *   node scripts/serve.js auto                Jalankan server + Electron auto-host di background.
 *   node scripts/serve.js stop                Hentikan proses yang sedang berjalan.
 *   node scripts/serve.js status              Tampilkan status proses.
 *   node scripts/serve.js log                 Ikuti (tail -f) morderx.log.
 */
'use strict';

const { spawn, spawnSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const ROOT       = path.join(__dirname, '..');
const SERVER_LOG = path.join(ROOT, 'morderx.log');
const HOST_LOG   = path.join(ROOT, 'morderx-host.log');
const SERVER_PID = path.join(ROOT, 'morderx.pid');
const HOST_PID   = path.join(ROOT, 'morderx-host.pid');
const isWin      = process.platform === 'win32';

// ── Util ──────────────────────────────────────────────────────────────────────
function readPid(file) {
  try { return parseInt(fs.readFileSync(file, 'utf8').trim(), 10) || null; }
  catch { return null; }
}

function isAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; }   // signal 0 = cek keberadaan, lintas-platform
  catch (e) { return e.code === 'EPERM'; }      // EPERM = ada tapi beda owner
}

function killPid(pid) {
  if (!pid || !isAlive(pid)) return false;
  try {
    if (isWin) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(pid, 'SIGTERM');
    return true;
  } catch { return false; }
}

/** Jalankan perintah node/electron detached, arahkan output ke file log, tulis PID. */
function startDetached(cmd, cmdArgs, logFile, pidFile, label) {
  const out = fs.openSync(logFile, 'a');
  const err = fs.openSync(logFile, 'a');
  // Sejak perbaikan keamanan Node 18.20+/20+/22+ (CVE-2024-27980), me-spawn file
  // .cmd/.bat di Windows dengan shell:false melempar EINVAL. electron.cmd termasuk
  // di antaranya, jadi paksa shell:true untuk batch-file Windows dan kutip argumen.
  const isBatch = isWin && /\.(cmd|bat)$/i.test(cmd);
  const quote   = (s) => (isBatch && /[\s"&|<>^]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);
  const child = spawn(isBatch ? quote(cmd) : cmd, isBatch ? cmdArgs.map(quote) : cmdArgs, {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', out, err],
    shell: isBatch,
    windowsHide: true,
  });
  fs.writeFileSync(pidFile, String(child.pid));
  child.unref();
  console.log(`${label} berjalan di background. PID: ${child.pid} (log: ${path.basename(logFile)})`);
  return child.pid;
}

/** Path ke biner electron lokal, lintas-platform. */
function electronBin() {
  // require('electron') di konteks Node biasa mengembalikan path ke biner
  // electron asli (electron.exe), BUKAN wrapper electron.cmd. Menjalankan exe
  // langsung menghindari dua masalah di Windows: (1) EINVAL karena .cmd butuh
  // shell sejak Node 18.20+/20+/22+ (CVE-2024-27980), dan (2) jendela console
  // yang muncul karena .cmd dijalankan lewat cmd.exe (aplikasi console) — exe
  // GUI tidak punya console sehingga tidak ada terminal yang nongol.
  try {
    const exe = require('electron');
    if (typeof exe === 'string' && fs.existsSync(exe)) return exe;
  } catch { /* fallback di bawah */ }
  const bin = path.join(ROOT, 'node_modules', '.bin', isWin ? 'electron.cmd' : 'electron');
  return fs.existsSync(bin) ? bin : (isWin ? 'electron.cmd' : 'electron');
}

// ── Perintah ────────────────────────────────────────────────────────────────────
function cmdStart(extra = []) {
  const existing = readPid(SERVER_PID);
  if (isAlive(existing)) { console.log(`Server sudah berjalan (PID: ${existing}).`); return; }
  startDetached(process.execPath, [path.join(ROOT, 'server.js'), ...extra], SERVER_LOG, SERVER_PID, 'Server');
}

function cmdAuto() {
  cmdStart(['--no-open']);
  // Beri jeda singkat agar server siap sebelum broadcaster Electron terhubung.
  const wait = spawnSync(process.execPath, ['-e', 'setTimeout(()=>{}, 1000)']);
  if (wait.error) { /* abaikan */ }
  startDetached(electronBin(), ['.', '--auto-host'], HOST_LOG, HOST_PID, 'Auto-host (broadcaster)');
}

function cmdStop() {
  let any = false;
  for (const [file, name] of [[SERVER_PID, 'Server'], [HOST_PID, 'Auto-host']]) {
    const pid = readPid(file);
    if (killPid(pid)) { console.log(`${name} (PID: ${pid}) dihentikan.`); any = true; }
    try { fs.unlinkSync(file); } catch {}
  }
  console.log(any ? 'Selesai.' : 'Tidak ada proses yang berjalan.');
}

function cmdStatus() {
  for (const [file, name] of [[SERVER_PID, 'Server'], [HOST_PID, 'Auto-host']]) {
    const pid = readPid(file);
    if (isAlive(pid)) console.log(`✅ ${name} berjalan (PID: ${pid}).`);
    else console.log(`⚪ ${name} tidak berjalan.`);
  }
}

/** tail -f lintas-platform: cetak isi lalu pantau perubahan. */
function cmdLog() {
  if (!fs.existsSync(SERVER_LOG)) { console.log(`Log belum ada: ${SERVER_LOG}`); return; }
  let pos = fs.statSync(SERVER_LOG).size;
  process.stdout.write(fs.readFileSync(SERVER_LOG, 'utf8'));
  fs.watchFile(SERVER_LOG, { interval: 500 }, (cur) => {
    if (cur.size < pos) pos = 0;            // file dipangkas/dirotasi
    if (cur.size > pos) {
      const fd = fs.openSync(SERVER_LOG, 'r');
      const buf = Buffer.alloc(cur.size - pos);
      fs.readSync(fd, buf, 0, buf.length, pos);
      fs.closeSync(fd);
      process.stdout.write(buf.toString('utf8'));
      pos = cur.size;
    }
  });
  console.error('\n(Ctrl+C untuk berhenti mengikuti log)');
}

// ── Dispatch ────────────────────────────────────────────────────────────────────
const [, , command, ...rest] = process.argv;
switch (command) {
  case 'start':  cmdStart(rest.includes('--no-open') ? ['--no-open'] : []); break;
  case 'auto':   cmdAuto();   break;
  case 'stop':   cmdStop();   break;
  case 'status': cmdStatus(); break;
  case 'log':    cmdLog();    break;
  default:
    console.log('Penggunaan: node scripts/serve.js <start|auto|stop|status|log> [--no-open]');
    process.exit(1);
}
