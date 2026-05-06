const { app, BrowserWindow, ipcMain, dialog, shell, screen, systemPreferences, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Parse command line arguments
const args = process.argv.slice(2);
const modeArg = args.find(a => a.startsWith('--mode='));
let appMode = modeArg ? modeArg.split('=')[1] : null; // 'host' | 'client' | null (show launcher)
const isDev = args.includes('--dev');

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
