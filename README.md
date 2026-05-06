# Morderx 🖥️

Aplikasi screen sharing & remote control lokal via WiFi/LAN. Tidak memerlukan Electron — cukup Node.js dan browser. Mendukung macOS, Windows, dan Linux.

## ✨ Fitur

- **Screen Sharing** — Tampilkan layar host secara real-time (~15fps)
- **Remote Control** — Kontrol kursor, klik, scroll, dan keyboard dari jarak jauh
- **Browser UI** — Client hanya perlu buka browser, tanpa install apapun
- **Password Protection** — Opsional password SHA-256
- **Background Server** — Jalankan dengan `nohup`, terminal bisa ditutup
- **Multi Viewer** — Banyak client bisa terhubung sekaligus
- **Dark UI Premium** — Interface modern di browser

---

## 🚀 Cara Menjalankan

### 1. Install dependensi (sekali saja)

```bash
npm install
```

### 2. Jalankan server di HOST (perangkat yang akan di-share layarnya)

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

Server akan menampilkan:
```
╔══════════════════════════════════════════════╗
║        Morderx — Browser Server              ║
╠══════════════════════════════════════════════╣
║  Port     : 3000                             ║
║  en0:         http://192.168.1.x:3000        ║
╚══════════════════════════════════════════════╝
```

### 3. Client terhubung (dari perangkat lain)

Buka browser → masuk ke alamat yang ditampilkan server:
```
http://192.168.1.x:3000
```

Masukkan password (jika ada) → klik **Hubungkan** → layar host tampil di canvas.

---

## 🎛️ Perintah Server

| Perintah | Fungsi |
|---|---|
| `npm run serve` | Jalankan server (foreground) |
| `npm run serve:bg` | Jalankan di background (nohup) |
| `npm run serve:stop` | Stop server background |
| `npm run serve:status` | Cek apakah server running |
| `npm run serve:log` | Lihat log real-time |

### Opsi argumen server

```bash
node server.js --port=3000       # Ganti port (default: 3000)
node server.js --password=abc    # Set password
node server.js --no-open         # Jangan auto-buka browser
```

---

## 📖 Cara Penggunaan di Browser

### Di sisi HOST
1. Pastikan izin **Screen Recording** sudah diberikan ke Terminal
2. Jalankan `npm run serve:bg`
3. Bagikan URL (`http://IP_HOST:3000`) ke client

### Di sisi CLIENT
1. Buka browser → masuk URL host
2. Masukkan password → klik **Hubungkan**
3. Layar host muncul di canvas
4. Gerakkan mouse di canvas = kontrol kursor host
5. Tombol **Kontrol Aktif/Nonaktif** untuk toggle input
6. Tombol **Fullscreen** untuk layar penuh

---

## 📁 Struktur Proyek

```
remoting_apps/
├── server.js             ← Entry point utama (HTTP + WebSocket server)
├── src/
│   ├── host/
│   │   ├── server-cli.js ← WebSocket server logic (tanpa Electron)
│   │   ├── capture.js    ← Screen capture (screenshot-desktop + Jimp)
│   │   └── input.js      ← Mouse/keyboard execution (robotjs)
│   ├── host-cli.js       ← CLI entry untuk host (tanpa UI)
│   ├── client-cli.js     ← CLI entry untuk client (tanpa UI)
│   └── renderer/
│       ├── viewer.html   ← UI browser (auth + canvas viewer)
│       ├── viewer.js     ← WebSocket client logic di browser
│       └── style.css     ← Dark premium CSS
├── morderx.log           ← Log server (dibuat otomatis saat serve:bg)
├── morderx.pid           ← PID server background
└── package.json
```

---

## ⚠️ Izin macOS (Wajib)

Node.js perlu izin **Screen Recording** untuk bisa menangkap layar:

1. Buka **System Preferences → Privacy & Security → Screen Recording**
2. Klik **`+`** → pilih **Terminal** (atau iTerm2)
3. Centang hingga aktif ✓
4. **Restart Terminal**, lalu jalankan server lagi

Atau buka langsung via terminal:
```bash
open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
```

### Windows
- Jalankan Terminal sebagai **Administrator**
- Izinkan port `3000` di Windows Firewall jika diminta

---

## 🔑 Keamanan

- Password di-hash dengan **SHA-256** sebelum diverifikasi
- Koneksi hanya bisa dibuat di jaringan lokal (tidak expose ke internet)
- Setiap viewer harus autentikasi sebelum menerima frame

---

## 🔧 Troubleshooting

| Masalah | Solusi |
|---------|--------|
| `could not create image from display` | Aktifkan izin Screen Recording di macOS |
| `EADDRINUSE: port 3000` | Port sudah dipakai — `npm run serve:stop` lalu coba lagi |
| Viewer terhubung tapi layar kosong | Cek izin Screen Recording Terminal |
| `robotjs not available` | Install build tools lalu `npm install robotjs` |
| Tidak bisa konek dari client | Pastikan satu WiFi/LAN, cek firewall |
| FPS rendah | Turunkan `CAPTURE_SCALE` di `src/host/capture.js` |

---

*Dibuat dengan Node.js, WebSocket, robotjs, dan screenshot-desktop*
