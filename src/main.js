const { app, BrowserWindow, ipcMain, dialog, shell, screen, systemPreferences, Notification, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Parse command line arguments
const args = process.argv.slice(2);
const getArg = (name, def) => {
  const f = args.find(a => a.startsWith(`--${name}=`));
  return f ? f.split('=').slice(1).join('=') : def;
};
const modeArg = args.find(a => a.startsWith('--mode='));
let appMode = modeArg ? modeArg.split('=')[1] : null; // 'host' | 'client' | null (show launcher)
const isDev = args.includes('--dev');

// Penanganan capture di Windows — bergantung versi OS:
//
// • Windows 11 24H2+ (build 26100+): Chromium memakai Windows Graphics Capture
//   (WGC) yang menangkap konten hardware-overlay/fullscreen-exclusive dengan
//   benar — termasuk aplikasi "mode kiosk" berbasis Chromium yang sebelumnya
//   tampil hitam/freeze di viewer. WGC butuh GPU/Direct3D, jadi akselerasi
//   hardware JANGAN dimatikan di sini.
// • Windows lama: capturer DXGI Desktop Duplication sering meng-capture adapter
//   yang salah pada GPU hybrid (Intel + NVIDIA) → frame hitam. Untuk itu tetap
//   matikan akselerasi hardware agar capture konsisten.
//
// disableHardwareAcceleration() wajib dipanggil sebelum app ready.
if (process.platform === 'win32') {
  const winBuild = parseInt(os.release().split('.')[2] || '0', 10);
  const isWin11_24H2 = winBuild >= 26100; // WGC default sejak build ini
  if (!isWin11_24H2) app.disableHardwareAcceleration();
}

// Auto-host: jalankan headless — server + capture + broadcast otomatis.
const isAutoHost   = args.includes('--auto-host');
const autoPort     = parseInt(getArg('port', '3000'), 10);
const autoPassword = getArg('password', '');

// Store reference to main window
let mainWindow = null;
let hostServer = null;
let clientConnection = null;

// ────────────────────────────────────────────────────────────────────────────
// App Lifecycle
// ────────────────────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  // Register .remapp file association handler
  app.setAsDefaultProtocolClient('morderx');

  // Mode auto-host: tanpa launcher/UI, langsung server + broadcast.
  if (isAutoHost) {
    startAutoHost();
    return;
  }

  // Handle .remapp file open on startup
  const remappFile = args.find(a => a.endsWith('.remapp'));
  if (remappFile) {
    appMode = 'client';
    createMainWindow(appMode);
    mainWindow.webContents.once('did-finish-load', () => {
      try {
        const data = JSON.parse(fs.readFileSync(remappFile, 'utf8'));
        mainWindow.webContents.send('load-remapp-file', data);
      } catch (e) {
        console.error('Failed to read .remapp file:', e);
      }
    });
  } else {
    createMainWindow(appMode || 'launcher');
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow(appMode || 'launcher');
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ────────────────────────────────────────────────────────────────────────────
// Auto-Host Mode (headless broadcaster: capture + broadcast saja)
//
// Server signaling + eksekusi input ditangani oleh "node server.js" terpisah
// (robotjs jalan di Node, bukan di Electron). Proses ini HANYA menangkap layar
// via desktopCapturer lalu menyiarkannya sebagai host peer ke localhost:PORT.
// ────────────────────────────────────────────────────────────────────────────
function startAutoHost() {
  if (process.platform === 'darwin' && app.dock) app.dock.hide();

  const ips = getLocalIPs();
  console.log('\n=== Morderx Auto-Host Broadcaster (WebRTC) ===');
  console.log(`Menyiarkan ke server signaling di port ${autoPort}`);
  ips.forEach(({ address }) => console.log(`Client : http://${address}:${autoPort}`));
  console.log('Pastikan "node server.js" berjalan (server + input).\n');

  // Jendela tersembunyi yang menangkap layar & menyiarkan.
  const win = new BrowserWindow({
    width: 320, height: 200, show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Jendela tersembunyi (show:false) di-throttle Chromium → desktopCapturer
      // bisa hasilkan frame hitam. Nonaktifkan throttling agar capture jalan.
      backgroundThrottling: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'autohost.html'), {
    query: { port: String(autoPort), password: autoPassword },
  });
  if (isDev) win.webContents.openDevTools({ mode: 'detach' });
}

// ────────────────────────────────────────────────────────────────────────────
// Window Creation
// ────────────────────────────────────────────────────────────────────────────
function createMainWindow(mode) {
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.workAreaSize;

  let winWidth, winHeight;
  if (mode === 'launcher') {
    winWidth = 520;
    winHeight = 420;
  } else if (mode === 'host') {
    winWidth = 480;
    winHeight = 600;
  } else {
    winWidth = Math.min(1280, width - 100);
    winHeight = Math.min(820, height - 60);
  }

  mainWindow = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    minWidth: 400,
    minHeight: 350,
    frame: false,
    transparent: false,
    backgroundColor: '#0f1117',
    titleBarStyle: 'hidden',
    titleBarOverlay: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
    icon: path.join(__dirname, '../assets/icons/icon.png'),
    show: false,
    center: true,
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev) mainWindow.webContents.openDevTools();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (hostServer) {
      hostServer.close();
      hostServer = null;
    }
  });

  // Send initial mode info once loaded
  mainWindow.webContents.once('did-finish-load', () => {
    mainWindow.webContents.send('init-mode', {
      mode,
      localIPs: getLocalIPs(),
      platform: process.platform,
      hostname: os.hostname(),
    });
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Network Utilities
// ────────────────────────────────────────────────────────────────────────────
function getLocalIPs() {
  const nets = os.networkInterfaces();
  const ips = [];
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
// IPC Handlers — Window Controls
// ────────────────────────────────────────────────────────────────────────────
ipcMain.handle('window-minimize', () => mainWindow?.minimize());
ipcMain.handle('window-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.handle('window-close', () => mainWindow?.close());
ipcMain.handle('window-is-maximized', () => mainWindow?.isMaximized() ?? false);

// ────────────────────────────────────────────────────────────────────────────
// IPC Handlers — App Mode Navigation
// ────────────────────────────────────────────────────────────────────────────
ipcMain.handle('navigate-mode', (_, newMode) => {
  appMode = newMode;
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.workAreaSize;

  if (newMode === 'host') {
    mainWindow?.setSize(480, 600);
    mainWindow?.center();
  } else if (newMode === 'client') {
    mainWindow?.setSize(Math.min(1280, width - 100), Math.min(820, height - 60));
    mainWindow?.center();
  } else {
    mainWindow?.setSize(520, 420);
    mainWindow?.center();
  }
  mainWindow.webContents.send('mode-changed', newMode);
});

// ────────────────────────────────────────────────────────────────────────────
// IPC Handlers — Host Mode (Screen Server)
// ────────────────────────────────────────────────────────────────────────────
ipcMain.handle('host-start', async (_, { port, password }) => {
  try {
    const { startHostServer } = require('./host/server');
    hostServer = await startHostServer({ port, password, mainWindow });
    return { success: true, port, ips: getLocalIPs() };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('host-stop', async () => {
  if (hostServer) {
    hostServer.close();
    hostServer = null;
  }
  return { success: true };
});

ipcMain.handle('host-get-status', () => {
  return { running: !!hostServer, ips: getLocalIPs() };
});

// ────────────────────────────────────────────────────────────────────────────
// IPC Handlers — Client Mode (Remote Viewer)
// ────────────────────────────────────────────────────────────────────────────
ipcMain.handle('client-connect', async (_, { host, port, password }) => {
  try {
    const { connectToHost } = require('./client/connection');
    clientConnection = await connectToHost({ host, port, password, mainWindow });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('client-disconnect', async () => {
  if (clientConnection) {
    clientConnection.disconnect();
    clientConnection = null;
  }
  return { success: true };
});

ipcMain.handle('client-send-input', async (_, inputEvent) => {
  if (clientConnection) {
    clientConnection.sendInput(inputEvent);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// IPC Handlers — .remapp File Generation
// ────────────────────────────────────────────────────────────────────────────
ipcMain.handle('generate-remapp-file', async (_, { host, port, name }) => {
  const data = {
    version: '1.0',
    appName: 'Morderx',
    host,
    port,
    name: name || os.hostname(),
    created: new Date().toISOString(),
  };

  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Simpan File Koneksi Morderx',
    defaultPath: path.join(os.homedir(), `${name || 'connection'}.remapp`),
    filters: [{ name: 'Morderx Connection', extensions: ['remapp'] }],
  });

  if (filePath) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    shell.showItemInFolder(filePath);
    return { success: true, filePath };
  }
  return { success: false };
});

ipcMain.handle('open-remapp-file', async () => {
  const { filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Buka File Koneksi Morderx',
    filters: [{ name: 'Morderx Connection', extensions: ['remapp'] }],
    properties: ['openFile'],
  });

  if (filePaths && filePaths[0]) {
    const data = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
    return { success: true, data };
  }
  return { success: false };
});

// ────────────────────────────────────────────────────────────────────────────
// IPC Handlers — Permissions (macOS)
// ────────────────────────────────────────────────────────────────────────────
ipcMain.handle('check-permissions', async () => {
  if (process.platform !== 'darwin') {
    return { screenCapture: true, accessibility: true };
  }
  const screenCapture = systemPreferences.getMediaAccessStatus('screen');
  return {
    screenCapture: screenCapture === 'granted',
    screenCaptureStatus: screenCapture,
  };
});

ipcMain.handle('request-screen-permission', async () => {
  if (process.platform === 'darwin') {
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
  }
});

ipcMain.handle('get-local-ips', () => getLocalIPs());

ipcMain.handle('get-hostname', () => os.hostname());

// ────────────────────────────────────────────────────────────────────────────
// IPC Handlers — Screen Capture Sources (WebRTC)
// ────────────────────────────────────────────────────────────────────────────
ipcMain.handle('get-desktop-sources', async () => {
  const sources = await desktopCapturer.getSources({ types: ['screen'], fetchWindowThumbnails: false });
  return sources.map(s => ({ id: s.id, name: s.name }));
});

ipcMain.on('auto-host-status', (_, msg) => {
  console.log(`[AUTO-HOST] ${msg}`);
});
