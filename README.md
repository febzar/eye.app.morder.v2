# Morderx 🖥️

Aplikasi **screen sharing & remote control** lewat WiFi/LAN. Sejak versi WebRTC,
penangkapan layar dan encoding dilakukan oleh **engine browser** (akselerasi
hardware), sehingga lancar **30–60 FPS** dengan latensi rendah — bukan lagi
screenshot per-frame yang berat.

Dua cara pakai:

1. **Mode Browser** (`node server.js`) — host buka satu halaman, client cukup browser. Tanpa install di sisi client.
2. **Mode Desktop** (Electron) — aplikasi launcher dengan UI host & client terintegrasi.

Mendukung macOS, Windows, dan Linux.

---

## ✨ Fitur

- **Screen Sharing WebRTC** — video real-time 30–60 FPS, latensi rendah (peer-to-peer)
- **Remote Control** — kursor, klik, scroll, dan keyboard dari jarak jauh (robotjs)
- **Browser UI** — client hanya perlu buka browser, tanpa install apa pun
- **Multi Viewer** — banyak client terhubung sekaligus (satu peer connection per viewer)
- **Password Protection** — opsional, hash SHA-256
- **Background Server** — jalankan dengan `nohup`, terminal bisa ditutup
- **Statistik Live** — FPS & ping ditampilkan di viewer

---

## 🏗️ Cara Kerja (Arsitektur WebRTC)

```
            ┌──────────────────────── HOST (mesin yang dibagikan) ───────────────────────┐
            │                                                                             │
            │   Browser/Electron renderer                                                 │
            │   ├─ getDisplayMedia / desktopCapturer  → tangkap + encode layar (hardware) │
            │   └─ RTCPeerConnection (1 per viewer)                                        │
            │                         │  ▲                                                 │
            └─────────────────────────┼──┼─────────────────────────────────────────────── ┘
                                       │  │  sinyal SDP/ICE (WebSocket)
                      ┌────────────────▼──┴────────────────┐
                      │   server.js  —  SIGNALING RELAY     │   ← TIDAK menyentuh video
                      │   (merelay sinyal + teruskan input  │     hanya relay paket kecil
                      │    mouse/keyboard ke robotjs)       │
                      └────────────────▲──┬────────────────┘
                                       │  │  sinyal SDP/ICE (WebSocket)
            ┌─────────────────────────┼──┼─────────────────────────────────────────────── ┐
            │   Browser/Electron renderer                                                 │
            │   ├─ RTCPeerConnection  → terima video track                                 │
            │   └─ <video>            → render layar + tangkap input                       │
            │                                                                             │
            └──────────────────────── CLIENT (viewer) ─────────────────────────────────── ┘

           Video mengalir PEER-TO-PEER langsung host → viewer (tidak lewat server).
           Server hanya "mak comblang" (signaling) dan eksekutor input.
```

Inti perubahan dari versi lama: server **tidak lagi** menangkap/meng-encode/menyiarkan
frame JPEG (yang dulu menyebabkan ~1 FPS dan ping tinggi). Server kini hanya merelay
sinyal kecil; beban capture/encode pindah ke engine browser yang ber-akselerasi hardware.

---

## 🚀 Mode Browser (paling cepat dipakai)

### 1. Install dependensi (sekali saja)

```bash
npm install
```

> **Windows:** kontrol mouse/keyboard memakai `@jitsi/robotjs` yang sudah
> menyertakan prebuilt binary, jadi `npm install` **tidak** butuh Visual Studio
> Build Tools / Python. Agar input bisa menggerakkan aplikasi yang berjalan
> sebagai admin, jalankan host lewat terminal "Run as administrator" (installer
> build Windows sudah meminta hak admin otomatis). Semua perintah `npm run serve:*`
> berjalan lintas-platform (PowerShell/CMD) tanpa perlu Git Bash/WSL.

### 2. Jalankan server di HOST (mesin yang akan dibagikan layarnya)

**Foreground** (terminal tetap terbuka):
```bash
npm run serve
# atau dengan password:
node server.js --password=abc123
```

**Background** (terminal bisa ditutup):
```bash
npm run serve:bg
# atau dengan password:
nohup node server.js --password=abc123 > morderx.log 2>&1 & echo $! > morderx.pid
```

Server menampilkan:
```
╔══════════════════════════════════════════════╗
║        Morderx — Browser Server (WebRTC)     ║
╠══════════════════════════════════════════════╣
║  Port     : 3000                             ║
║  HOST   :   http://localhost:3000/host       ║
║  en0:         http://192.168.1.x:3000        ║
╚══════════════════════════════════════════════╝
```

### 3. Mulai berbagi layar (DI MESIN HOST)

Buka **`http://localhost:3000/host`** (otomatis terbuka kecuali `--no-open`) →
masukkan password (jika ada) → klik **"Bagikan Layar"** → pilih layar yang dibagikan.

> ⚠️ Halaman host **wajib** dibuka via `localhost`. `getDisplayMedia` hanya bisa
> berjalan di *secure context*, dan `localhost` dianggap aman oleh browser.

### 4. Client terhubung (dari perangkat lain)

Buka browser → masuk ke alamat IP host:
```
http://192.168.1.x:3000
```
Masukkan password (jika ada) → klik **Hubungkan** → video layar host langsung tampil.

---

## 🤖 Mode Auto-Host (otomatis + background) — paling praktis

Berbagi layar **otomatis tanpa klik "Bagikan Layar"** dan **tanpa dialog pemilih layar**,
berjalan di **latar belakang**. Cocok untuk perangkat yang ingin selalu siap di-remote.

```bash
npm run serve:auto:bg     # jalankan server + broadcaster di background
npm run serve:log         # pantau log
npm run serve:stop        # hentikan keduanya
```

Lalu dari perangkat lain cukup buka `http://IP_HOST:3000` — layar langsung tampil.

**Cara kerjanya (arsitektur split):** dua proses ringan dijalankan sekaligus —
1. `node server.js` → HTTP + signaling + **input** (robotjs jalan di Node).
2. **Electron headless** (jendela tersembunyi) → **hanya** menangkap layar via
   `desktopCapturer` dan menyiarkannya otomatis. Tidak butuh robotjs.

Pemisahan ini disengaja: robotjs hanya bisa di-compile untuk satu runtime (Node *atau*
Electron), jadi input ditaruh di Node (tempat robotjs sudah jalan) dan capture di Electron.

> ⚠️ **Izin Screen Recording (sekali saja).** Pertama kali, macOS meminta izin Screen
> Recording untuk **Electron**. Berikan di *System Settings → Privacy & Security → Screen
> Recording*, lalu broadcaster akan **otomatis pulih** (ia retry tiap 3 detik) — tanpa
> perlu restart. Setelah itu tidak ada prompt lagi. Izin OS ini **tidak bisa dilewati**
> oleh metode capture mana pun.

Foreground (untuk debug, jalankan server di terminal lain dulu):
```bash
npm run serve:bg          # server dulu
npm run serve:auto        # broadcaster di foreground
```

---

## 🖥️ Mode Desktop (Electron)

Aplikasi launcher dengan UI host & client yang terintegrasi (tanpa perlu buka halaman host manual).

```bash
npm start                # buka launcher
npm run start:host       # langsung mode host
npm run start:client     # langsung mode client
npm run dev              # mode dev (DevTools terbuka)
```

Alur:
1. **Host:** pilih **Host** → atur port/password → **Mulai Hosting**
   (izinkan Screen Recording bila macOS meminta). Layar langsung dibagikan.
2. **Client:** pilih **Client** → isi `IP:port` host → **Hubungkan**.

Semua kombinasi kompatibel karena memakai protokol signaling yang sama:
Electron-host ↔ browser-client, browser-host ↔ Electron-client, dst.

### Build aplikasi
```bash
npm run build        # build sesuai OS
npm run build:win    # Windows
npm run build:mac    # macOS
```

---

## 🎛️ Perintah Server (Mode Browser)

| Perintah | Fungsi |
|---|---|
| `npm run serve` | Jalankan server (foreground) |
| `npm run serve:bg` | Jalankan di background (lintas-platform) |
| `npm run serve:stop` | Stop server background |
| `npm run serve:status` | Cek apakah server running |
| `npm run serve:log` | Lihat log real-time |
| `npm run pm2:start` | Jalankan via PM2 (opsional) |

### Opsi argumen server

```bash
node server.js --port=3000       # Ganti port (default: 3000)
node server.js --password=abc    # Set password
node server.js --no-open         # Jangan auto-buka halaman host
```

---

## 📁 Struktur Proyek

```
remoting_apps/
├── server.js                 ← Mode Browser: HTTP + signaling (pakai web-server.js)
├── src/
│   ├── main.js               ← Electron main: window, IPC, desktopCapturer, --auto-host
│   ├── preload.js            ← Bridge IPC aman ke renderer
│   ├── host/
│   │   ├── signaling.js      ← ★ Relay signaling WebRTC bersama (auth/relay/input)
│   │   ├── web-server.js     ← ★ HTTP static + signaling (dipakai server.js & auto-host)
│   │   ├── server.js         ← Electron host mode: signaling relay
│   │   └── input.js          ← Eksekusi mouse/keyboard (robotjs)
│   └── renderer/
│       ├── host.html / host.js         ← Halaman HOST mode browser (getDisplayMedia)
│       ├── viewer.html / viewer.js     ← Halaman CLIENT mode browser (video → <video>)
│       ├── autohost.html / autohost.js ← ★ Broadcaster headless auto-host (desktopCapturer)
│       ├── index.html / app.js         ← UI aplikasi Electron (launcher + host + client)
│       └── style.css                   ← Dark premium CSS
├── morderx.log               ← Log server (dibuat saat serve:bg)
├── morderx.pid               ← PID server background
└── package.json
```

> Catatan: `src/host/capture.js`, `src/host/server-cli.js`, `src/client/connection.js`,
> `src/host-cli.js`, dan `src/client-cli.js` adalah peninggalan arsitektur lama
> (capture JPEG via WebSocket) dan **tidak lagi dipakai** oleh jalur WebRTC.

---

## 🔌 Protokol Signaling (ringkas)

Semua lewat satu WebSocket. Pesan berupa JSON `{ type, ... }`.

| Arah | Pesan | Keterangan |
|---|---|---|
| server → klien | `auth-required` | minta autentikasi saat connect |
| klien → server | `auth` `{role:'host'\|'viewer', password}` | identifikasi peran |
| server → klien | `auth-ok` / `auth-failed` | hasil auth |
| server → host | `viewer-join` / `viewer-leave` `{viewerId}` | viewer masuk/keluar |
| host ↔ viewer | `signal` `{viewerId?, signal:{sdp\|candidate}}` | relay SDP/ICE (server menempelkan `viewerId`) |
| viewer → server | `input` `{data}` | diteruskan ke robotjs |
| dua arah | `ping`/`pong` `{ts}` | ukur latensi |
| server → klien | `viewer-count` `{count}` | jumlah viewer |
| server → viewer | `no-host` | host belum membagikan layar |

---

## ⚠️ Izin macOS (Wajib untuk HOST)

Capture layar butuh izin **Screen Recording**:

1. **System Settings → Privacy & Security → Screen Recording**
2. Tambahkan aplikasi yang memulai capture:
   - Mode Browser: **browser** yang membuka `localhost/host` (Chrome/Edge)
   - Mode Desktop: **Morderx** (atau Terminal saat `npm start`)
3. Aktifkan ✓, lalu **restart** aplikasi tersebut.

Buka panel langsung:
```bash
open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
```

### Windows / Linux
- Izinkan port `3000` (atau port pilihan) di firewall jika diminta.
- Linux: pakai browser berbasis Chromium agar `getDisplayMedia` tersedia.

---

## 🔑 Keamanan

- Password di-hash **SHA-256** sebelum diverifikasi.
- Video mengalir **peer-to-peer** dan dienkripsi oleh WebRTC (DTLS-SRTP).
- Dirancang untuk jaringan lokal (tidak di-expose ke internet secara default).
- Setiap viewer wajib lolos autentikasi sebelum sinyal direlay.

---

## 🔧 Troubleshooting

| Masalah | Solusi |
|---|---|
| Klik "Bagikan Layar" tidak muncul dialog | Pastikan halaman host dibuka via `http://localhost:PORT/host` (bukan IP) |
| Host pakai IP, share gagal | `getDisplayMedia` butuh secure context → wajib `localhost` |
| Viewer connect tapi layar kosong | Pastikan host sudah klik "Bagikan Layar"; cek izin Screen Recording |
| Video diam / tidak konek di jaringan ketat | Beberapa LAN memblok kandidat ICE; pastikan host & client satu subnet |
| `EADDRINUSE: port 3000` | Port dipakai — `npm run serve:stop` lalu coba lagi |
| `robotjs not available` | Install build tools lalu `npm install robotjs` |
| Tidak bisa konek dari client | Pastikan satu WiFi/LAN dan cek firewall |
| FPS rendah / patah-patah | Tutup aplikasi berat; turunkan `maxFrameRate`/resolusi di sumber capture |

---

*Dibuat dengan Node.js, WebSocket (signaling), WebRTC (video), robotjs (input), dan Electron.*
