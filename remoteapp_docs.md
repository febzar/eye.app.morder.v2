# Morderx — Dokumentasi Lengkap

Aplikasi screen sharing & remote control berbasis **Node.js + WebSocket + Browser**. Tidak memerlukan Electron — host menjalankan server Node.js, client cukup buka browser.

---

## 📁 Struktur File

```
remoting_apps/
├── server.js                     ← Entry point utama (HTTP + WebSocket)
├── morderx.log                   ← Log server background (auto-generated)
├── morderx.pid                   ← PID proses background (auto-generated)
├── package.json                  ← Konfigurasi npm & scripts
├── README.md                     ← Dokumentasi singkat
└── src/
    ├── host-cli.js               ← CLI host (tanpa UI, opsional)
    ├── client-cli.js             ← CLI client (tanpa UI, opsional)
    ├── host/
    │   ├── server-cli.js         ← WebSocket server logic (tanpa Electron)
    │   ├── capture.js            ← screenshot-desktop + Jimp JPEG compress
    │   └── input.js              ← robotjs mouse/keyboard executor
    └── renderer/
        ├── viewer.html           ← UI browser (auth overlay + canvas viewer)
        ├── viewer.js             ← WebSocket client, frame render, input forwarder
        └── style.css             ← Dark premium CSS (Inter font, animasi)
```

---

## 🚀 Cara Menjalankan

### Install dependensi (sekali saja)
```bash
npm install
```

### Jalankan server — Foreground
```bash
npm run serve

# dengan password:
node server.js --password=abc123

# ganti port:
node server.js --port=8080
```

### Jalankan server — Background (terminal bisa ditutup)
```bash
npm run serve:bg

# dengan opsi:
nohup node server.js --password=abc123 > morderx.log 2>&1 & echo $! > morderx.pid
```

### Perintah manajemen background

| Perintah | Fungsi |
|---|---|
| `npm run serve:bg` | Jalankan di background |
| `npm run serve:stop` | Stop server background |
| `npm run serve:status` | Cek apakah running |
| `npm run serve:log` | Lihat log real-time (`tail -f`) |

---

## 🔌 Cara Penggunaan

### HOST (perangkat yang layarnya di-share)

1. Pastikan izin **Screen Recording** sudah diberikan ke Terminal (lihat bagian Permission)
2. Jalankan server:
   ```bash
   npm run serve:bg
   ```
3. Catat URL yang tampil, contoh: `http://192.168.1.6:3000`
4. Bagikan URL tersebut ke client

### CLIENT (pengontrol, dari perangkat lain)

1. Buka browser (Chrome/Safari/Firefox)
2. Masuk ke `http://IP_HOST:3000`
3. Masukkan password → klik **Hubungkan**
4. Layar host tampil di canvas browser
5. Gerakkan mouse di canvas = mengontrol kursor host
6. Klik, scroll, keyboard semua diteruskan ke host

### Kontrol di UI Browser

| Tombol | Fungsi |
|--------|--------|
| **Kontrol Aktif** | Toggle on/off input mouse & keyboard |
| **Fullscreen** | Layar penuh |
| FPS counter | Menampilkan frame rate real-time |
| Ping counter | Menampilkan latency WebSocket |

---

## 🌐 Arsitektur Teknis

```
┌──────────────────────────────────────────────────┐
│  HOST — node server.js                           │
│  ├── HTTP Server (port 3000)                     │
│  │   └── Serve viewer.html, viewer.js, style.css │
│  ├── WebSocket Server (same port)                │
│  │   ├── Auth (SHA-256 password)                 │
│  │   ├── Broadcast frame JPEG ~15fps             │
│  │   └── Receive & execute input events          │
│  ├── screenshot-desktop → capture layar          │
│  └── robotjs → eksekusi mouse/keyboard           │
└──────────────────────────────────────────────────┘
              ↕ WebSocket ws://HOST_IP:3000
┌──────────────────────────────────────────────────┐
│  CLIENT — Browser                                │
│  ├── viewer.html — UI dark premium               │
│  ├── viewer.js — WebSocket + canvas render       │
│  └── Input forwarding — mouse, keyboard          │
└──────────────────────────────────────────────────┘
```

### Protokol WebSocket

| Arah | Pesan | Keterangan |
|------|-------|------------|
| Server → Client | `{ type: "auth-required" }` | Challenge auth |
| Client → Server | `{ type: "auth", password }` | Kirim password |
| Server → Client | `{ type: "auth-ok", ips, hostname }` | Auth berhasil |
| Server → Client | `{ type: "auth-failed" }` | Password salah |
| Server → Client | `{ type: "frame", data, format, ts }` | JPEG base64 frame |
| Client → Server | `{ type: "input", data }` | Mouse/keyboard event |
| Client → Server | `{ type: "ping", ts }` | Heartbeat |
| Server → Client | `{ type: "pong", ts }` | Respons ping |

### Kompresi Frame
- Capture: `screenshot-desktop` → PNG buffer
- Resize: 75% dari resolusi asli (Jimp)
- Format: JPEG quality 60 (bandwidth efisien)
- Skip frame jika MD5 hash sama (tidak ada perubahan layar)

---

## ⚙️ Konfigurasi

| Setting | Default | Cara Ubah |
|---------|---------|-----------|
| Port | `3000` | `node server.js --port=8080` |
| Password | kosong | `node server.js --password=abc` |
| FPS target | `15` | Edit `TARGET_FPS` di `server.js` |
| Scale capture | `75%` | Edit `CAPTURE_SCALE` di `src/host/capture.js` |
| JPEG Quality | `60` | Edit `CAPTURE_QUALITY` di `src/host/capture.js` |

---

## ⚠️ Permission

### macOS — Wajib sebelum pertama kali dijalankan

Node.js perlu izin **Screen Recording** untuk menangkap layar:

1. Buka: **System Preferences → Privacy & Security → Screen Recording**
2. Klik **`+`** → pilih **Terminal** (atau iTerm2 yang dipakai)
3. Centang ✓ hingga aktif
4. **Restart Terminal**
5. Jalankan server lagi

Shortcut buka pengaturan:
```bash
open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
```

### Windows

- Jalankan Terminal sebagai **Administrator**
- Izinkan port `3000` di Windows Defender Firewall
- Untuk build `robotjs`: install Python 3.x + Visual Studio Build Tools

---

## 🔒 Keamanan

- Password di-hash **SHA-256** sebelum diverifikasi (tidak dikirim plain text)
- Server hanya bisa diakses dari jaringan lokal (bind ke `0.0.0.0`)
- Setiap viewer wajib autentikasi sebelum menerima frame apapun
- Koneksi tidak di-expose ke internet

---

## 🔧 Troubleshooting

| Masalah | Solusi |
|---------|--------|
| `could not create image from display` | Aktifkan izin Screen Recording di macOS untuk Terminal |
| `EADDRINUSE: port 3000` | Port sudah dipakai — jalankan `npm run serve:stop` lalu coba lagi |
| Viewer terhubung tapi layar kosong | Izin Screen Recording belum aktif |
| `robotjs not available` | Install build tools, lalu `npm install robotjs` |
| Client tidak bisa terhubung | Pastikan satu WiFi/LAN, cek firewall host |
| FPS sangat rendah | Turunkan `CAPTURE_SCALE` atau `TARGET_FPS` di `capture.js` |
| Password salah padahal benar | Perhatikan spasi atau karakter khusus di password |
