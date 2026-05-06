/**
 * Morderx — Renderer Process Logic
 * Handles UI interactions, mode switching, host/client operations,
 * screen rendering, and input event forwarding.
 */

'use strict';

const api = window.morderx;

// ────────────────────────────────────────────────────────────────────────────
// State
// ────────────────────────────────────────────────────────────────────────────
const state = {
  currentMode: 'launcher',
  hostRunning: false,
  clientConnected: false,
  inputEnabled: true,
  lastHostIP: null,
  lastHostPort: 7420,
};

// ────────────────────────────────────────────────────────────────────────────
// DOM References
// ────────────────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

// Titlebar
const btnMinimize  = $('btn-minimize');
const btnMaximize  = $('btn-maximize');
const btnClose     = $('btn-close');

// Launcher
const btnHostMode   = $('btn-host-mode');
const btnClientMode = $('btn-client-mode');
const networkHint   = $('network-hint');

// Host
const hostBackBtn      = $('host-back-btn');
const hostStatusDot    = $('host-status-dot');
const permissionBanner = $('permission-banner');
const btnGrantPerm     = $('btn-grant-permission');
const hostPortInput    = $('host-port');
const hostPassInput    = $('host-password');
const toggleHostPass   = $('toggle-host-pass');
const btnStartHost     = $('btn-start-host');
const btnStopHost      = $('btn-stop-host');
const hostConfig       = $('host-config');
const hostInfo         = $('host-info');
const hostIpList       = $('host-ip-list');
const hostClientCount  = $('host-client-count');
const btnGenerateRemapp = $('btn-generate-remapp');
const btnCopyAddress   = $('btn-copy-address');
const hostLogEntries   = $('host-log-entries');

// Client
const clientBackBtn    = $('client-back-btn');
const clientStatusDot  = $('client-status-dot');
const clientHostInput  = $('client-host');
const clientPortInput  = $('client-port');
const clientPassInput  = $('client-password');
const toggleClientPass = $('toggle-client-pass');
const btnConnect       = $('btn-connect');
const btnOpenRemapp    = $('btn-open-remapp');
const btnDisconnect    = $('btn-disconnect');
const clientStats      = $('client-stats');
const statFps          = $('stat-fps');
const statLatency      = $('stat-latency');
const statStatus       = $('stat-status');
const clientLogEntries = $('client-log-entries');

// Screen viewer
const screenPlaceholder = $('screen-placeholder');
const screenCanvas      = $('screen-canvas');
const viewerControls    = $('viewer-controls');
const btnToggleInput    = $('btn-toggle-input');
const viewerFpsDisplay  = $('viewer-fps-display');
const viewerLatency     = $('viewer-latency-display');

// ────────────────────────────────────────────────────────────────────────────
// Canvas context for rendering morderx screen
// ────────────────────────────────────────────────────────────────────────────
const ctx = screenCanvas.getContext('2d');

// ────────────────────────────────────────────────────────────────────────────
// Init
// ────────────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setupTitlebar();
  setupLauncher();
  setupHostView();
  setupClientView();
  setupEventListeners();
  setupResizeObserver();
});

// ────────────────────────────────────────────────────────────────────────────
// Titlebar Controls
// ────────────────────────────────────────────────────────────────────────────
function setupTitlebar() {
  btnMinimize.addEventListener('click', () => api.minimize());
  btnMaximize.addEventListener('click', () => api.maximize());
  btnClose.addEventListener('click', () => api.close());
}

// ────────────────────────────────────────────────────────────────────────────
// Launcher
// ────────────────────────────────────────────────────────────────────────────
function setupLauncher() {
  btnHostMode.addEventListener('click', () => switchView('host'));
  btnClientMode.addEventListener('click', () => switchView('client'));
}

// ────────────────────────────────────────────────────────────────────────────
// Host View
// ────────────────────────────────────────────────────────────────────────────
function setupHostView() {
  hostBackBtn.addEventListener('click', () => {
    if (state.hostRunning) {
      showToast('Stop server sebelum kembali', 'error');
      return;
    }
    switchView('launcher');
  });

  // Toggle password visibility
  toggleHostPass.addEventListener('click', () => togglePasswordVisibility(hostPassInput, toggleHostPass));

  // Start hosting
  btnStartHost.addEventListener('click', async () => {
    const port = parseInt(hostPortInput.value, 10) || 7420;
    const password = hostPassInput.value;

    if (port < 1024 || port > 65535) {
      showToast('Port harus antara 1024–65535', 'error');
      return;
    }

    btnStartHost.disabled = true;
    btnStartHost.innerHTML = `<span class="spinner"></span> Memulai...`;

    const result = await api.hostStart({ port, password });

    if (result.success) {
      state.hostRunning = true;
      state.lastHostPort = port;
      hostStatusDot.className = 'status-indicator running';
      btnStartHost.classList.add('hidden');
      btnStopHost.classList.remove('hidden');
      hostConfig.classList.add('hidden');
      hostInfo.classList.remove('hidden');
      renderHostIPs(result.ips, port);
      hostLog('Server dimulai pada port ' + port, 'success');
    } else {
      showToast('Gagal memulai: ' + result.error, 'error');
      hostLog('Error: ' + result.error, 'error');
      btnStartHost.disabled = false;
      btnStartHost.innerHTML = `<svg viewBox="0 0 20 20"><path d="M5 3l12 7-12 7V3z" fill="currentColor"/></svg> Mulai Hosting`;
    }
  });

  // Stop hosting
  btnStopHost.addEventListener('click', async () => {
    await api.hostStop();
    state.hostRunning = false;
    hostStatusDot.className = 'status-indicator';
    btnStopHost.classList.add('hidden');
    btnStartHost.classList.remove('hidden');
    btnStartHost.disabled = false;
    btnStartHost.innerHTML = `<svg viewBox="0 0 20 20"><path d="M5 3l12 7-12 7V3z" fill="currentColor"/></svg> Mulai Hosting`;
    hostConfig.classList.remove('hidden');
    hostInfo.classList.add('hidden');
    hostIpList.innerHTML = '';
    hostClientCount.textContent = '0';
    hostLog('Server dihentikan', 'warn');
  });

  // Generate .remapp file
  btnGenerateRemapp.addEventListener('click', async () => {
    const ip = state.lastHostIP;
    const port = state.lastHostPort;
    if (!ip) { showToast('Server belum berjalan', 'error'); return; }
    const hostname = await api.getHostname();
    const result = await api.generateRemappFile({ host: ip, port, name: hostname });
    if (result.success) {
      showToast('File .remapp berhasil dibuat!', 'success');
      hostLog('File .remapp disimpan: ' + result.filePath, 'success');
    }
  });

  // Copy connection address
  btnCopyAddress.addEventListener('click', () => {
    if (!state.lastHostIP) return;
    const addr = `${state.lastHostIP}:${state.lastHostPort}`;
    navigator.clipboard.writeText(addr).then(() => {
      showToast('Alamat disalin: ' + addr, 'success');
    });
  });

  // Permission button (macOS)
  btnGrantPerm.addEventListener('click', () => api.requestScreenPermission());

  // Check permissions on host view load
  api.onModeChanged(async (mode) => {
    if (mode === 'host') {
      const perms = await api.checkPermissions();
      if (!perms.screenCapture) {
        permissionBanner.classList.remove('hidden');
        hostLog('Izin screen capture diperlukan!', 'warn');
      }
    }
  });
}

function renderHostIPs(ips, port) {
  hostIpList.innerHTML = '';
  ips.forEach(ip => {
    state.lastHostIP = ip.address; // last one wins, usually fine
    const div = document.createElement('div');
    div.className = 'ip-entry';
    div.innerHTML = `
      <div>
        <div class="ip-label">${ip.name}</div>
        <div class="ip-address">${ip.address}</div>
      </div>
      <span class="ip-port">:${port}</span>
    `;
    hostIpList.appendChild(div);
  });
}

function hostLog(msg, type = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  const time = new Date().toLocaleTimeString('id-ID', { hour12: false });
  entry.textContent = `[${time}] ${msg}`;
  hostLogEntries.appendChild(entry);
  hostLogEntries.scrollTop = hostLogEntries.scrollHeight;
}

// ────────────────────────────────────────────────────────────────────────────
// Client View
// ────────────────────────────────────────────────────────────────────────────
function setupClientView() {
  clientBackBtn.addEventListener('click', () => {
    if (state.clientConnected) {
      api.clientDisconnect();
    }
    switchView('launcher');
  });

  toggleClientPass.addEventListener('click', () => togglePasswordVisibility(clientPassInput, toggleClientPass));

  // Connect
  btnConnect.addEventListener('click', async () => {
    const host = clientHostInput.value.trim();
    const port = parseInt(clientPortInput.value, 10) || 7420;
    const password = clientPassInput.value;

    if (!host) {
      showToast('Masukkan IP address host', 'error');
      return;
    }

    btnConnect.disabled = true;
    btnConnect.innerHTML = `<span class="spinner"></span> Menghubungkan...`;
    clientLog(`Menghubungkan ke ${host}:${port}...`, 'info');

    const result = await api.clientConnect({ host, port, password });

    if (result.success) {
      // Connected state set via event listener
    } else {
      showToast(result.error, 'error');
      clientLog('Gagal: ' + result.error, 'error');
      resetConnectBtn();
    }
  });

  // Open .remapp file
  btnOpenRemapp.addEventListener('click', async () => {
    const result = await api.openRemappFile();
    if (result.success) {
      const { host, port } = result.data;
      clientHostInput.value = host;
      clientPortInput.value = port;
      showToast(`File dimuat: ${host}:${port}`, 'info');
      clientLog(`File .remapp dimuat — ${host}:${port}`, 'info');
    }
  });

  // Disconnect
  btnDisconnect.addEventListener('click', async () => {
    await api.clientDisconnect();
    setClientDisconnected();
    clientLog('Koneksi diputus oleh pengguna', 'warn');
  });

  // Toggle input control
  btnToggleInput.addEventListener('click', () => {
    state.inputEnabled = !state.inputEnabled;
    if (state.inputEnabled) {
      btnToggleInput.classList.remove('disabled');
      btnToggleInput.querySelector('span').textContent = 'Kontrol Aktif';
      screenCanvas.style.cursor = 'crosshair';
      showToast('Kontrol input diaktifkan', 'success');
    } else {
      btnToggleInput.classList.add('disabled');
      btnToggleInput.querySelector('span').textContent = 'Kontrol Nonaktif';
      screenCanvas.style.cursor = 'default';
      showToast('Kontrol input dinonaktifkan', 'info');
    }
  });

  // Load from .remapp on startup
  api.onLoadRemappFile((data) => {
    switchView('client');
    clientHostInput.value = data.host;
    clientPortInput.value = data.port;
    showToast(`File .remapp: ${data.name}`, 'info');
  });
}

function setClientConnected(count) {
  state.clientConnected = true;
  clientStatusDot.className = 'status-indicator connected';
  btnConnect.classList.add('hidden');
  btnOpenRemapp.classList.add('hidden');
  btnDisconnect.classList.remove('hidden');
  clientStats.classList.remove('hidden');
  screenPlaceholder.classList.add('hidden');
  screenCanvas.classList.remove('hidden');
  viewerControls.classList.remove('hidden');
  statStatus.textContent = 'Online';
  statStatus.className = 'stat-value connected-text';
  setupCanvasInput();
}

function setClientDisconnected() {
  state.clientConnected = false;
  clientStatusDot.className = 'status-indicator';
  btnConnect.classList.remove('hidden');
  btnOpenRemapp.classList.remove('hidden');
  btnDisconnect.classList.add('hidden');
  statStatus.textContent = 'Offline';
  statStatus.className = 'stat-value';
  screenPlaceholder.classList.remove('hidden');
  screenCanvas.classList.add('hidden');
  viewerControls.classList.add('hidden');
  removeCanvasInput();
  resetConnectBtn();
}

function resetConnectBtn() {
  btnConnect.disabled = false;
  btnConnect.innerHTML = `<svg viewBox="0 0 20 20" fill="none"><path d="M10 3l7 7-7 7M3 10h14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg> Hubungkan`;
}

function clientLog(msg, type = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  const time = new Date().toLocaleTimeString('id-ID', { hour12: false });
  entry.textContent = `[${time}] ${msg}`;
  clientLogEntries.appendChild(entry);
  clientLogEntries.scrollTop = clientLogEntries.scrollHeight;
}

// ────────────────────────────────────────────────────────────────────────────
// Event Listeners from Main Process
// ────────────────────────────────────────────────────────────────────────────
function setupEventListeners() {
  // Init mode from main process
  api.onInitMode(async ({ mode, localIPs, hostname }) => {
    if (mode !== 'launcher') switchView(mode);
    // Show network info
    if (localIPs && localIPs.length > 0) {
      networkHint.innerHTML = `
        <svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.2"/><path d="M8 4v4l2 2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
        IP Anda: ${localIPs.map(n => n.address).join(' / ')} — Pastikan satu jaringan WiFi/LAN
      `;
    }
  });

  // Host events
  api.onHostEvent((event) => {
    switch (event.type) {
      case 'client-connected':
        hostClientCount.textContent = event.count;
        hostLog(`Klien terhubung dari ${event.ip} (total: ${event.count})`, 'success');
        showToast(`Klien baru terhubung: ${event.ip}`, 'success');
        break;
      case 'client-disconnected':
        hostClientCount.textContent = event.count;
        hostLog(`Klien terputus dari ${event.ip}`, 'warn');
        break;
      case 'error':
        hostLog('Error: ' + event.message, 'error');
        showToast('Error: ' + event.message, 'error');
        break;
    }
  });

  // Client events
  api.onClientEvent((event) => {
    switch (event.type) {
      case 'connected':
        setClientConnected(event.clientCount);
        clientLog('Terhubung ke host!', 'success');
        showToast('Berhasil terhubung!', 'success');
        break;
      case 'disconnected':
        setClientDisconnected();
        clientLog('Koneksi terputus (code: ' + event.code + ')', 'warn');
        break;
      case 'fps':
        statFps.textContent = event.fps;
        viewerFpsDisplay.textContent = event.fps + ' fps';
        break;
      case 'latency':
        statLatency.textContent = event.ms + ' ms';
        viewerLatency.textContent = event.ms + ' ms';
        break;
      case 'error':
        clientLog('Error: ' + event.message, 'error');
        break;
    }
  });

  // Screen frames
  api.onScreenFrame((frame) => {
    renderFrame(frame);
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Canvas: Render incoming screen frames
// ────────────────────────────────────────────────────────────────────────────
function renderFrame(frame) {
  const img = new Image();
  img.onload = () => {
    // Fit canvas to container while maintaining aspect ratio
    const container = screenCanvas.parentElement;
    const containerW = container.clientWidth;
    const containerH = container.clientHeight;
    const imgAspect = img.naturalWidth / img.naturalHeight;
    const containerAspect = containerW / containerH;

    let drawW, drawH;
    if (imgAspect > containerAspect) {
      drawW = containerW;
      drawH = containerW / imgAspect;
    } else {
      drawH = containerH;
      drawW = containerH * imgAspect;
    }

    screenCanvas.width  = drawW;
    screenCanvas.height = drawH;
    screenCanvas.style.width  = drawW + 'px';
    screenCanvas.style.height = drawH + 'px';

    ctx.drawImage(img, 0, 0, drawW, drawH);

    // Store natural dimensions for input mapping
    screenCanvas._naturalW = img.naturalWidth;
    screenCanvas._naturalH = img.naturalHeight;
  };
  img.src = `data:image/${frame.format};base64,${frame.data}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Canvas: Input Forwarding (mouse + keyboard)
// ────────────────────────────────────────────────────────────────────────────
function setupCanvasInput() {
  screenCanvas.addEventListener('mousemove',  onCanvasMouseMove);
  screenCanvas.addEventListener('mousedown',  onCanvasMouseDown);
  screenCanvas.addEventListener('mouseup',    onCanvasMouseUp);
  screenCanvas.addEventListener('click',      onCanvasClick);
  screenCanvas.addEventListener('dblclick',   onCanvasDblClick);
  screenCanvas.addEventListener('wheel',      onCanvasWheel, { passive: false });
  screenCanvas.addEventListener('contextmenu', onCanvasContextMenu);
  document.addEventListener('keydown',  onKeyDown);
  document.addEventListener('keyup',    onKeyUp);
}

function removeCanvasInput() {
  screenCanvas.removeEventListener('mousemove',  onCanvasMouseMove);
  screenCanvas.removeEventListener('mousedown',  onCanvasMouseDown);
  screenCanvas.removeEventListener('mouseup',    onCanvasMouseUp);
  screenCanvas.removeEventListener('click',      onCanvasClick);
  screenCanvas.removeEventListener('dblclick',   onCanvasDblClick);
  screenCanvas.removeEventListener('wheel',      onCanvasWheel);
  screenCanvas.removeEventListener('contextmenu', onCanvasContextMenu);
  document.removeEventListener('keydown',  onKeyDown);
  document.removeEventListener('keyup',    onKeyUp);
}

function canvasToScreenCoords(e) {
  const rect = screenCanvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  // Natural (host screen) coords, scaled back
  const nW = screenCanvas._naturalW || screenCanvas.width;
  const nH = screenCanvas._naturalH || screenCanvas.height;
  return { x, y, screenW: nW, screenH: nH };
}

function getModifiers(e) {
  return { ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey };
}

function sendInput(data) {
  if (!state.inputEnabled || !state.clientConnected) return;
  api.clientSendInput(data);
}

let lastMoveTime = 0;
function onCanvasMouseMove(e) {
  const now = Date.now();
  if (now - lastMoveTime < 30) return; // throttle ~33fps
  lastMoveTime = now;
  const { x, y, screenW, screenH } = canvasToScreenCoords(e);
  sendInput({ type: 'mousemove', x, y, screenW, screenH });
}

function onCanvasMouseDown(e) {
  e.preventDefault();
  const { x, y, screenW, screenH } = canvasToScreenCoords(e);
  sendInput({ type: 'mousedown', x, y, screenW, screenH, button: e.button });
}

function onCanvasMouseUp(e) {
  const { x, y, screenW, screenH } = canvasToScreenCoords(e);
  sendInput({ type: 'mouseup', x, y, screenW, screenH, button: e.button });
}

function onCanvasClick(e) {
  const { x, y, screenW, screenH } = canvasToScreenCoords(e);
  sendInput({ type: 'click', x, y, screenW, screenH, button: e.button });
}

function onCanvasDblClick(e) {
  const { x, y, screenW, screenH } = canvasToScreenCoords(e);
  sendInput({ type: 'click', x, y, screenW, screenH, button: e.button, double: true });
}

function onCanvasWheel(e) {
  e.preventDefault();
  const { x, y, screenW, screenH } = canvasToScreenCoords(e);
  sendInput({ type: 'scroll', x, y, screenW, screenH, deltaX: e.deltaX, deltaY: e.deltaY });
}

function onCanvasContextMenu(e) {
  e.preventDefault();
  const { x, y, screenW, screenH } = canvasToScreenCoords(e);
  sendInput({ type: 'click', x, y, screenW, screenH, button: 2 });
}

function onKeyDown(e) {
  if (!state.inputEnabled || !state.clientConnected) return;
  if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
  e.preventDefault();
  sendInput({ type: 'keydown', key: e.key, code: e.code, modifiers: getModifiers(e) });
}

function onKeyUp(e) {
  if (!state.inputEnabled || !state.clientConnected) return;
  if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
  e.preventDefault();
  sendInput({ type: 'keyup', key: e.key, code: e.code, modifiers: getModifiers(e) });
}

// ────────────────────────────────────────────────────────────────────────────
// View Switching
// ────────────────────────────────────────────────────────────────────────────
function switchView(mode) {
  const views = {
    launcher: $('view-launcher'),
    host:     $('view-host'),
    client:   $('view-client'),
  };

  Object.entries(views).forEach(([key, el]) => {
    if (key === mode) {
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  });

  state.currentMode = mode;
  api.navigateMode(mode);
}

// ────────────────────────────────────────────────────────────────────────────
// Resize Observer — keep canvas properly sized
// ────────────────────────────────────────────────────────────────────────────
function setupResizeObserver() {
  if (!window.ResizeObserver) return;
  const ro = new ResizeObserver(() => {
    // Re-render last frame on resize if connected
    // (just let next frame naturally re-render)
  });
  const viewer = $('screen-viewer');
  if (viewer) ro.observe(viewer);
}

// ────────────────────────────────────────────────────────────────────────────
// Utilities
// ────────────────────────────────────────────────────────────────────────────
function togglePasswordVisibility(input, btn) {
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.style.color = show ? 'var(--accent)' : 'var(--text-muted)';
}

function showToast(message, type = 'info') {
  const icons = {
    success: `<svg class="toast-icon" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/><path d="M5 8l2 2 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
    error:   `<svg class="toast-icon" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/><path d="M6 6l4 4M10 6l-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
    info:    `<svg class="toast-icon" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/><path d="M8 7v4M8 5.5v.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  };

  const container = $('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `${icons[type] || icons.info}<span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}
