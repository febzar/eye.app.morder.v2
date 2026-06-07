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

## 📋 Persyaratan Sistem

| Komponen | Minimum | Catatan |
|---|---|---|
| **Node.js** | **≥ 20.19 atau ≥ 22.12** (disarankan **24 LTS**) | Installer Electron memuat `@electron/get` yang berformat **ESM**. Node lama (mis. 18, atau 22.9) gagal dengan `ERR_REQUIRE_ESM` saat mengunduh binary Electron. Cek: `node -v`. |
| **OS host** | Windows 10/11, macOS 11+, Linux (Chromium) | Input (robotjs) & capture berjalan di sisi host. |
| **Capture app "mode kiosk"/fullscreen (Windows)** | **Windows 11 24H2 — build ≥ 26100** | Wajib agar Chromium memakai **Windows Graphics Capture (WGC)** yang menangkap konten hardware-overlay/fullscreen. Versi lebih lama → viewer **hitam/freeze**. Cek dengan `winver`. |
| **Browser klien** | Chromium-based (Chrome/Edge) | Halaman host butuh secure context (`localhost`). |

> ⚠️ **Penyebab error instalasi #1 adalah versi Node terlalu lama.** Jalankan
> `node -v` sebelum `npm install`. Kalau di bawah 20.19 / 22.12, update dari
> <https://nodejs.org> (pilih **LTS**) lebih dulu.

> ℹ️ **Mode Browser tidak butuh Electron sama sekali** (cukup `node server.js`).
> Binary Electron hanya diperlukan untuk **Mode Desktop** dan **Auto-Host**. Jika
> hanya memakai mode browser, masalah unduhan Electron di bawah tidak relevan.

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

> **Cek dulu:** `node -v` harus **≥ 20.19 / ≥ 22.12** (disarankan **24 LTS**).
> Node lebih lama gagal memasang binary Electron (`ERR_REQUIRE_ESM`). Lihat
> [Persyaratan Sistem](#-persyaratan-sistem).

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
| `Error [ERR_REQUIRE_ESM]` saat install/menjalankan | Node terlalu lama. Update ke **Node ≥ 22.12 / 24 LTS** (`node -v`), lalu `npm install` ulang. |
| `Downloading Electron binary...` berulang, broadcaster tak jalan, `morderx-host.log` kosong | `electron.exe` gagal terpasang. Lihat **[Masalah instalasi Electron](#-masalah-instalasi-electron-mode-desktop--auto-host)**. |
| Viewer hitam/freeze saat host buka app kiosk/fullscreen | Host harus **Windows 11 24H2+** (WGC). Lihat **[Viewer hitam saat app kiosk](#-viewer-hitamfreeze-saat-host-membuka-aplikasi-mode-kiosk)**. |
| Auto-host: viewer "menunggu host membagikan layar" | Broadcaster tidak capture. Cek `morderx-host.log` — biasanya `electron.exe` tak terpasang atau capture gagal. |

---

### 🔧 Masalah instalasi Electron (Mode Desktop / Auto-Host)

> Hanya relevan untuk **Mode Desktop** & **Auto-Host**. Mode Browser tidak butuh Electron.

**Gejala:** `npm run serve:auto*` / `npm start` menampilkan `Downloading Electron
binary...` berulang, broadcaster tak pernah hidup, `Get-Process electron` kosong,
dan `morderx-host.log` kosong. **Akar masalah:** `electron.exe` tidak ada di
`node_modules/electron/dist`.

**1. Pastikan Node cukup baru** (penyebab paling sering):
```bash
node -v   # harus >= 20.19 atau >= 22.12 (disarankan 24 LTS)
```
Node 18 / 22.9 → `ERR_REQUIRE_ESM` saat unduh binary. Update Node, lalu `npm install` ulang.

**2. Verifikasi binary benar-benar ada:**
```powershell
Test-Path node_modules\electron\dist\electron.exe   # harus True
node_modules\electron\dist\electron.exe --version    # harus cocok dgn package.json
```

**3. Cache unduhan korup** (gejala: `dist` cuma berisi folder `locales`) → bersihkan & unduh ulang:
```powershell
Remove-Item -Recurse -Force node_modules\electron\dist -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\electron\Cache" -ErrorAction SilentlyContinue
node node_modules\electron\install.js
Test-Path node_modules\electron\dist\electron.exe
```

**4. Antivirus / Windows Defender mengkarantina `electron.exe`** (sering — `electron.exe` kerap salah-deteksi). Konfirmasi:
```powershell
Get-MpThreatDetection | Sort-Object InitialDetectionTime | Select-Object -Last 5 InitialDetectionTime, Resources
```
Jika muncul `electron.exe`, kecualikan folder (PowerShell **Run as administrator**):
```powershell
Add-MpPreference -ExclusionPath "C:\path\ke\proyek"
Add-MpPreference -ExclusionPath "$env:LOCALAPPDATA\electron"
(Get-MpPreference).ExclusionPath   # verifikasi terdaftar
```
lalu ulangi langkah 3.

**5. Unduh manual** (paling andal bila jaringan/AV rewel):
1. Unduh lewat browser: `https://github.com/electron/electron/releases/download/vX.Y.Z/electron-vX.Y.Z-win32-x64.zip`
   (ganti `X.Y.Z` dengan versi `electron` di `package.json` → `devDependencies`).
2. Jika Defender mengkarantina unduhan, **Allow/Restore** via *Windows Security → Protection history*.
3. Ekstrak **seluruh isi** zip ke `node_modules\electron\dist\` (hingga ada `dist\electron.exe`).
4. `Test-Path node_modules\electron\dist\electron.exe` → `True`.

> Diagnostik broadcaster ditulis ke **`morderx-host.log`** (via `fs.appendFileSync`,
> bukan `console.log`, karena output GUI Electron tidak ter-flush ke file di Windows).
> Isinya menampilkan versi Electron, jumlah sumber layar, status capture, dan crash GPU/renderer.

---

### 🖥️ Viewer hitam/freeze saat host membuka aplikasi "mode kiosk"

Aplikasi kiosk/fullscreen berbasis Chromium merender lewat **hardware overlay**
(DirectComposition / Multiplane Overlay) yang **dilewati** capturer layar biasa
(DXGI Desktop Duplication) → viewer dapat frame **hitam**; saat fullscreen-exclusive,
komposisi desktop berhenti di-update → **freeze**.

- **Solusi utama (host Windows):** pakai **Windows 11 24H2 (build ≥ 26100)**. Sejak
  **Electron 42**, Chromium memakai **Windows Graphics Capture (WGC)** yang menangkap
  konten overlay/fullscreen dengan benar. Cek build via `winver`. Berlaku untuk
  auto-host **maupun** share manual (WGC pada browser/Electron yang sama).
- **WGC butuh GPU** → di Windows 11 24H2 aplikasi **tidak** mematikan akselerasi
  hardware (lihat logika versi-OS di [src/main.js](src/main.js)); di Windows lama
  akselerasi tetap dimatikan demi menghindari frame hitam DXGI pada GPU hybrid.
- **Windows < 24H2 (fallback):** jalankan aplikasi kiosknya dengan flag
  `--disable-direct-composition` (atau matikan "hardware acceleration" di setelan app
  tsb), **atau** matikan Multiplane Overlay global: registry
  `HKLM\SOFTWARE\Microsoft\Windows\Dwm` → DWORD `OverlayTestMode` = `5`, lalu reboot.

---

*Dibuat dengan Node.js, WebSocket (signaling), WebRTC (video), robotjs (input), dan Electron.*
