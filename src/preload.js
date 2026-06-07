const { contextBridge, ipcRenderer } = require('electron');

// Expose a safe API to the renderer process
contextBridge.exposeInMainWorld('morderx', {
  // Window controls
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close: () => ipcRenderer.invoke('window-close'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),

  // Mode navigation
  navigateMode: (mode) => ipcRenderer.invoke('navigate-mode', mode),

  // Host (server) controls
  hostStart: (opts) => ipcRenderer.invoke('host-start', opts),
  hostStop: () => ipcRenderer.invoke('host-stop'),
  hostGetStatus: () => ipcRenderer.invoke('host-get-status'),

  // Client (viewer) controls
  clientConnect: (opts) => ipcRenderer.invoke('client-connect', opts),
  clientDisconnect: () => ipcRenderer.invoke('client-disconnect'),
  clientSendInput: (event) => ipcRenderer.invoke('client-send-input', event),

  // File operations
  generateRemappFile: (opts) => ipcRenderer.invoke('generate-remapp-file', opts),
  openRemappFile: () => ipcRenderer.invoke('open-remapp-file'),

  // Permissions
  checkPermissions: () => ipcRenderer.invoke('check-permissions'),
  requestScreenPermission: () => ipcRenderer.invoke('request-screen-permission'),

  // Network info
  getLocalIPs: () => ipcRenderer.invoke('get-local-ips'),
  getHostname: () => ipcRenderer.invoke('get-hostname'),

  // Screen capture sources (WebRTC)
  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),

  // Auto-host status report (hidden renderer → main log)
  autoHostStatus: (msg) => ipcRenderer.send('auto-host-status', msg),

  // Event listeners
  onInitMode: (callback) => {
    ipcRenderer.on('init-mode', (_, data) => callback(data));
  },
  onModeChanged: (callback) => {
    ipcRenderer.on('mode-changed', (_, mode) => callback(mode));
  },
  onHostEvent: (callback) => {
    ipcRenderer.on('host-event', (_, data) => callback(data));
  },
  onClientEvent: (callback) => {
    ipcRenderer.on('client-event', (_, data) => callback(data));
  },
  onLoadRemappFile: (callback) => {
    ipcRenderer.on('load-remapp-file', (_, data) => callback(data));
  },
  onScreenFrame: (callback) => {
    ipcRenderer.on('screen-frame', (_, data) => callback(data));
  },

  // Remove listeners
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  },
});
