# Dokumentasi Teknis — Morderx

Dokumen ini menjelaskan bagaimana aplikasi **Morderx** dibangun: tujuan, teknologi yang dipakai, arsitektur, dan alur kerja antar komponen.

## 1. Apa Itu Morderx

Morderx adalah aplikasi **screen sharing dan remote control** ringan untuk jaringan lokal (LAN). Aplikasi ini melakukan streaming layar secara real-time (30–60 FPS) dengan latensi rendah menggunakan komunikasi **WebRTC peer-to-peer**, plus kemampuan mengendalikan mouse/keyboard komputer host dari jarak jauh.

Tersedia dalam dua mode penggunaan:

- **Mode Browser** — server HTTP + WebSocket sederhana, klien cukup buka browser tanpa instalasi apa pun.
- **Mode Desktop** — aplikasi native Electron dengan UI host/client terintegrasi.

## 2. Teknologi yang Digunakan

| Komponen | Teknologi | Fungsi |
|----------|-----------|--------|
| Desktop framework | **Electron** v28.3.3 | Aplikasi native lintas platform |
| Streaming video | **WebRTC** (native browser API) | Transfer video peer-to-peer |
| Signaling | **WebSocket** (`ws` ^8.20.0) | Relay SDP & ICE candidate |
| Input simulation | **@jitsi/robotjs** ^0.6.22 | Simulasi mouse & keyboard |
| Runtime server | **Node.js** | Server signaling & proses background |
| Packaging | **electron-builder** ^24.13.3 | Build installer Win/macOS/Linux |
| Lain-lain | `uuid`, `node-fetch`, `bonjour-service` | ID viewer, HTTP client, discovery LAN |

**Catatan pemilihan teknologi:**

- Memakai `@jitsi/robotjs` (bukan `robotjs` biasa) karena menyediakan **binary prebuilt** untuk Windows/macOS/Linux — pengguna tidak perlu compiler saat instalasi (penting terutama untuk Windows).
- Eksekusi input dijalankan di sisi **Node**, sedangkan capture layar di sisi **Electron/browser**, untuk menyiasati keterbatasan robotjs yang hanya jalan di satu runtime.

## 3. Arsitektur Umum

Morderx memisahkan tugas menjadi beberapa lapisan (separation of concerns):

1. **Lapisan Signaling** — `server.js` + WebSocket, sebagai relay stateless (hanya menyampaikan pesan SDP/ICE).
2. **Lapisan Capture** — engine browser (`getDisplayMedia`) atau Electron (`desktopCapturer`).
3. **Lapisan Input** — robotjs di proses Node (bukan di Electron, demi kompatibilitas).
4. **Lapisan UI** — proses renderer, diisolasi lewat preload bridge.

Poin kunci: **video TIDAK melewati server**. Server hanya menjadi perantara saat handshake; setelah koneksi terbentuk, video mengalir langsung host → viewer (peer-to-peer, terenkripsi DTLS-SRTP).

```
┌──────────────── HOST ─────────────────┐
│  Renderer (Browser / Electron)         │
│  ├─ getDisplayMedia / desktopCapturer  │  ← capture + encode (GPU, H.264/VP9)
│  └─ RTCPeerConnection (1 per viewer)   │
└──────────────┬─────────────────────────┘
               │  Video peer-to-peer (DTLS-SRTP) — TIDAK lewat server
               │
       ┌───────┴──────── server.js ───────────┐
       │  WebSocket.Server (mis. port 3000)    │
       │  ├─ Relay SDP / ICE                   │  ← signaling saja
       │  ├─ Autentikasi (SHA-256)             │
       │  └─ Eksekusi input (robotjs)          │
       └───────┬───────────────────────────────┘
               │  WebSocket (signaling + input)
               │
┌──────────────┴─────────────── CLIENT ──┐
│  Renderer (Browser / Electron)          │
│  ├─ RTCPeerConnection → terima track    │
│  └─ <video> → render + kirim input      │
└─────────────────────────────────────────┘
```

## 4. Struktur Proses Utama (Electron)

### Main Process — [src/main.js](src/main.js)

- **Manajemen window** — membuat window frameless dengan titlebar custom (`frame: false`). Ada tiga ukuran: launcher (520×420), host (480×600), dan client (responsif).
- **Mode Auto-Host** (headless) — membuat window Electron tersembunyi (`show: false`) dengan `backgroundThrottling: false`, lalu menangkap layar via `desktopCapturer` dan menyiarkannya. Server (`node server.js`) berjalan terpisah untuk signaling + input.
- **Penyesuaian Windows** — menonaktifkan hardware acceleration untuk mencegah masalah frame hitam pada GPU hybrid.
- **IPC Handlers** — antara lain `host-start`, `client-connect`, `get-desktop-sources`, `check-permissions`, `generate-remapp-file` (ekspor file koneksi `.remapp`).

### Preload Bridge — [src/preload.js](src/preload.js)

Menjembatani IPC Electron ke renderer secara aman lewat `contextBridge.exposeInMainWorld('morderx', {...})`. Mengekspos: kontrol window (minimize/maximize/close), navigasi mode, kontrol host/client, cek izin, dan listener event (`onHostEvent`, `onClientEvent`, dll).

## 5. Sisi Host (Server & Signaling)

### Signaling Relay — [src/host/signaling.js](src/host/signaling.js)

Inti protokol pesan WebSocket. State yang dikelola:

```javascript
let host = null;            // satu WebSocket broadcaster
const viewers = new Map();  // viewerId -> ws (banyak klien)
let nextViewerId = 1;       // ID auto-increment
```

**Alur signaling:**

1. Client connect → server kirim `{ type: 'auth-required' }`.
2. Client/host balas `{ type: 'auth', role: 'host'|'viewer', password }`.
3. Server verifikasi hash SHA-256 → kirim `{ type: 'auth-ok', role, ips, hostname }`.
4. Host menerima `{ type: 'viewer-join', viewerId }` untuk tiap viewer baru.
5. Host ↔ Viewer saling tukar `{ type: 'signal', viewerId, signal: {sdp|candidate} }` lewat server.
6. Input diteruskan: `{ type: 'input', data }` → dijalankan robotjs.

### Eksekusi Input — [src/host/input.js](src/host/input.js)

Menjalankan event mouse/keyboard yang dikirim viewer:

- **Mouse**: `mousemove`, `mousedown`, `mouseup`, `click`, `scroll`.
- **Keyboard**: `keydown`, `keyup`, `keypress`, `type`.
- **Normalisasi koordinat** — koordinat viewer dipetakan ke resolusi layar host yang sebenarnya, supaya posisi kursor tetap akurat meski resolusi berbeda.

### Web Server & Server Wrapper

- [src/host/web-server.js](src/host/web-server.js) — server HTTP gabungan: menyajikan file renderer statis + signaling WebSocket. Route `/` → `viewer.html`, `/host` → `host.html`. Dipakai oleh mode browser dan mode auto-host.
- [src/host/server.js](src/host/server.js) — membungkus signaling WebSocket untuk mode host Electron, dan mengirim event status ke window utama (`server-started`, `viewer-count`, `error`, `server-stopped`).

## 6. Sisi Renderer (UI & WebRTC)

### Host Broadcaster (Browser) — [src/renderer/host.js](src/renderer/host.js)

Menangkap layar lewat `getDisplayMedia` (30–60 FPS, cursor selalu tampil). Untuk **tiap viewer** dibuat `RTCPeerConnection` terpisah, menambahkan track video, lalu menegosiasikan SDP & ICE melalui server signaling.

### Client Viewer (Browser) — [src/renderer/viewer.js](src/renderer/viewer.js)

- Auth WebSocket dengan password → terima `auth-ok`.
- Set `pc.ontrack` → tampilkan stream pada elemen `<video>`.
- **FPS meter** memakai `requestVideoFrameCallback()` (fallback ke `getSettings().frameRate`).
- **Ping latensi** setiap 3 detik.
- Meneruskan event mouse/keyboard/scroll ke host via `{ type: 'input', data }`.

### Auto-Host Headless — [src/renderer/autohost.js](src/renderer/autohost.js)

Window Electron tersembunyi yang otomatis capture (`desktopCapturer` via `getUserMedia` dengan `chromeMediaSource: 'desktop'`) dan menyiarkan. Jika capture gagal (mis. izin Screen Recording belum diberi), ia **retry tiap 3 detik** dan pulih otomatis tanpa restart.

### Electron App Terintegrasi — [src/renderer/app.js](src/renderer/app.js)

UI launcher/host/client dalam satu antarmuka. State utama:

```javascript
const state = {
  currentMode: 'launcher',  // launcher | host | client
  hostRunning: false,
  clientConnected: false,
  inputEnabled: true,
  lastHostIP: null,
  lastHostPort: 7420,
};
```

## 7. Entry Point & Manajemen Proses

### Server Browser Standalone — [server.js](server.js)

Entry point mode browser. Argumen CLI: `--port=3000`, `--password=abc` (opsional, di-hash SHA-256), `--no-open` (jangan buka browser otomatis). Menampilkan URL host (`localhost:PORT/host`) dan URL client (`IP:PORT`).

### Manajer Proses Lintas Platform — [scripts/serve.js](scripts/serve.js)

Mengelola proses background di Windows/macOS/Linux. Perintah:

| Perintah | Fungsi |
|----------|--------|
| `node scripts/serve.js start` | Jalankan `server.js` di background |
| `node scripts/serve.js auto` | Jalankan server + Electron auto-host |
| `node scripts/serve.js stop` | Hentikan proses background |
| `node scripts/serve.js status` | Cek status berjalan |
| `node scripts/serve.js log` | Pantau log (seperti `tail -f`) |

Penanganan Windows: deteksi file `.cmd`/`.bat` (`shell: true`), pakai `taskkill` untuk cleanup, sembunyikan jendela konsol (`windowsHide: true`). PID disimpan ke `morderx.pid` / `morderx-host.pid`.

## 8. Alur WebRTC (Handshake)

1. Host membuat offer: `pc.createOffer()` → kirim SDP ke viewer via signaling.
2. Viewer terima offer → `pc.setRemoteDescription(offer)` → buat answer.
3. Viewer kirim answer balik lewat server.
4. Host terima → `pc.setRemoteDescription(answer)`.
5. Kedua sisi mengumpulkan ICE candidate dan menukarnya lewat server.

**STUN server** untuk NAT traversal:

```javascript
const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
```

Karena koneksi di LAN, tidak diperlukan TURN relay.

## 9. Keamanan

Autentikasi memakai hashing SHA-256 di kedua sisi; server tidak pernah menyimpan password plaintext:

```javascript
function verifyPassword(provided, actual) {
  if (!actual) return true; // tanpa password
  const h = (s) => createHash('sha256').update(s).digest('hex');
  return h(provided) === h(actual);
}
```

Renderer diisolasi dengan **context isolation** + preload bridge, sehingga renderer tidak punya akses langsung ke Node/Electron API.

## 10. Mengapa Arsitektur Ini

| Aspek | Pendekatan Lama | Pendekatan Morderx (Sekarang) |
|-------|-----------------|-------------------------------|
| Capture | Server tangkap frame JPEG → kompres → kirim via WebSocket | Browser capture & encode (H.264/VP9, GPU) |
| Transfer | Lewat server (1 FPS, CPU tinggi) | Peer-to-peer WebRTC (30–60 FPS, CPU rendah) |
| Latensi | Tinggi | Rendah |

Hasilnya: screen sharing dengan latensi rendah dan akselerasi hardware, dibangun dari standar web modern (WebRTC, WebSocket) yang dipadukan dengan kemampuan OS native (desktopCapturer, robotjs).

## 11. Ringkasan File Penting

| File | Peran |
|------|-------|
| [src/main.js](src/main.js) | Main Electron: window, IPC, auto-host |
| [src/preload.js](src/preload.js) | Bridge IPC aman ke renderer |
| [src/host/signaling.js](src/host/signaling.js) | Relay WebSocket + autentikasi |
| [src/host/input.js](src/host/input.js) | Eksekusi input robotjs |
| [src/host/web-server.js](src/host/web-server.js) | Server HTTP + WS (mode browser) |
| [src/host/server.js](src/host/server.js) | Wrapper host server Electron |
| [src/renderer/host.js](src/renderer/host.js) | Host browser: capture + broadcast |
| [src/renderer/viewer.js](src/renderer/viewer.js) | Viewer browser: terima video + kirim input |
| [src/renderer/autohost.js](src/renderer/autohost.js) | Broadcaster Electron headless |
| [src/renderer/app.js](src/renderer/app.js) | UI Electron: launcher, host, client |
| [server.js](server.js) | Entry point server browser |
| [scripts/serve.js](scripts/serve.js) | Manajer proses background lintas platform |
