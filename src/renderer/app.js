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
const screenVideo       = $('screen-video');
const viewerControls    = $('viewer-controls');
const btnToggleInput    = $('btn-toggle-input');
const viewerFpsDisplay  = $('viewer-fps-display');
const viewerLatency     = $('viewer-latency-display');

// ────────────────────────────────────────────────────────────────────────────
// Canvas context for rendering morderx screen
// ────────────────────────────────────────────────────────────────────────────
// ────────────────────────────────────────────────────────────────────────────
// WebRTC — shared config
// ────────────────────────────────────────────────────────────────────────────
const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

// ── Host Broadcaster: capture layar (desktopCapturer) → siarkan ke viewer ──────
const hostBroadcaster = {
  ws: null,
  stream: null,
  peers: new Map(),   // viewerId -> RTCPeerConnection

  async start(port, password) {
    // Ambil sumber layar dari main process, lalu capture via getUserMedia.
    const sources = await api.getDesktopSources();
    if (!sources || !sources.length) throw new Error('Tidak ada sumber layar terdeteksi');

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sources[0].id,
          maxFrameRate: 60,
        },
      },
    });

    await this._connect(port, password);
  },

  _connect(port, password) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://localhost:${port}`);
      let settled = false;

      this.ws.addEventListener('message', async (ev) => {
        let msg; try { msg = JSON.parse(ev.data); } catch { return; }
        switch (msg.type) {
          case 'auth-required':
            this.ws.send(JSON.stringify({ type: 'auth', role: 'host', password }));
            break;
          case 'auth-ok':
            if (!settled) { settled = true; resolve(); }
            break;
          case 'auth-failed':
            if (!settled) { settled = true; reject(new Error('Auth host gagal')); }
            break;
          case 'viewer-join':   await this._createPeer(msg.viewerId); break;
          case 'viewer-leave':  this._closePeer(msg.viewerId); break;
          case 'signal':        await this._onSignal(msg.viewerId, msg.signal); break;
        }
      });

      this.ws.addEventListener('error', () => { if (!settled) { settled = true; reject(new Error('Gagal konek signaling')); } });
    });
  },

  async _createPeer(viewerId) {
    this._closePeer(viewerId);
    const pc = new RTCPeerConnection(ICE);
    this.peers.set(viewerId, pc);
    for (const track of this.stream.getTracks()) pc.addTrack(track, this.stream);
    pc.onicecandidate = (e) => {
      if (e.candidate) this.ws.send(JSON.stringify({ type: 'signal', viewerId, signal: { candidate: e.candidate } }));
    };
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) this._closePeer(viewerId);
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.ws.send(JSON.stringify({ type: 'signal', viewerId, signal: { sdp: pc.localDescription } }));
  },

  async _onSignal(viewerId, signal) {
    const pc = this.peers.get(viewerId);
    if (!pc) return;
    if (signal.sdp) await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
    else if (signal.candidate) { try { await pc.addIceCandidate(signal.candidate); } catch {} }
  },

  _closePeer(viewerId) {
    const pc = this.peers.get(viewerId);
    if (pc) { pc.close(); this.peers.delete(viewerId); }
  },

  stop() {
    for (const pc of this.peers.values()) pc.close();
    this.peers.clear();
    if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
    if (this.ws) { this.ws.close(); this.ws = null; }
  },
};

// ── Client Viewer: terima track WebRTC dari host → render ke <video> ───────────
const clientViewer = {
  ws: null,
  pc: null,
  pingTimer: null,
  fpsTimer: null,
  onConnected: null,
  onDisconnected: null,

  start(host, port, password) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://${host}:${port}`);
      let settled = false;
      const fail = (e) => { if (!settled) { settled = true; reject(e); } };

      this.ws.addEventListener('message', async (ev) => {
        let msg; try { msg = JSON.parse(ev.data); } catch { return; }
        switch (msg.type) {
          case 'auth-required':
            this.ws.send(JSON.stringify({ type: 'auth', role: 'viewer', password }));
            break;
          case 'auth-ok':
            if (!settled) { settled = true; resolve(); }
            this.pingTimer = setInterval(() => {
              if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
            }, 3000);
            break;
          case 'auth-failed':
            fail(new Error('Password salah atau autentikasi gagal'));
            this.ws.close();
            break;
          case 'no-host':
            clientLog('Host belum membagikan layar, menunggu...', 'warn');
            break;
          case 'signal':
            await this._onSignal(msg.signal);
            break;
          case 'pong': {
            const ms = Date.now() - msg.ts;
            statLatency.textContent = ms + ' ms';
            viewerLatency.textContent = ms + ' ms';
            break;
          }
        }
      });

      this.ws.addEventListener('close', () => {
        this._cleanup();
        if (this.onDisconnected) this.onDisconnected();
      });
      this.ws.addEventListener('error', () => fail(new Error('Tidak dapat terhubung ke host')));
    });
  },

  _ensurePeer() {
    if (this.pc) return this.pc;
    const pc = new RTCPeerConnection(ICE);
    this.pc = pc;
    pc.ontrack = (e) => {
      screenVideo.srcObject = e.streams[0];
      screenVideo.play().catch(() => {});
      if (this.onConnected) this.onConnected();
      this._startFps();
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) this.ws.send(JSON.stringify({ type: 'signal', signal: { candidate: e.candidate } }));
    };
    return pc;
  },

  async _onSignal(signal) {
    const pc = this._ensurePeer();
    if (signal.sdp) {
      await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      if (signal.sdp.type === 'offer') {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.ws.send(JSON.stringify({ type: 'signal', signal: { sdp: pc.localDescription } }));
      }
    } else if (signal.candidate) {
      try { await pc.addIceCandidate(signal.candidate); } catch {}
    }
  },

  _startFps() {
    if (this.fpsTimer) return;
    if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
      let frames = 0, last = Date.now();
      const tick = () => {
        frames++;
        const now = Date.now();
        if (now - last >= 1000) {
          statFps.textContent = frames;
          viewerFpsDisplay.textContent = frames + ' fps';
          frames = 0; last = now;
        }
        if (this.pc) screenVideo.requestVideoFrameCallback(tick);
      };
      this.fpsTimer = true;
      screenVideo.requestVideoFrameCallback(tick);
    }
  },

  sendInput(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'input', data }));
  },

  _cleanup() {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
    this.fpsTimer = null;
    if (this.pc) { this.pc.close(); this.pc = null; }
    screenVideo.srcObject = null;
  },

  disconnect() {
    this._cleanup();
    if (this.ws) { this.ws.close(); this.ws = null; }
  },
};

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
      // Mulai capture layar + broadcast WebRTC dari renderer.
      try {
        await hostBroadcaster.start(port, password);
      } catch (err) {
        await api.hostStop();
        showToast('Gagal capture layar: ' + err.message, 'error');
        hostLog('Capture gagal: ' + err.message + ' (cek izin Screen Recording)', 'error');
        btnStartHost.disabled = false;
        btnStartHost.innerHTML = `<svg viewBox="0 0 20 20"><path d="M5 3l12 7-12 7V3z" fill="currentColor"/></svg> Mulai Hosting`;
        return;
      }

      state.hostRunning = true;
      state.lastHostPort = port;
      hostStatusDot.className = 'status-indicator running';
      btnStartHost.classList.add('hidden');
      btnStopHost.classList.remove('hidden');
      hostConfig.classList.add('hidden');
      hostInfo.classList.remove('hidden');
      renderHostIPs(result.ips, port);
      hostLog('Server dimulai pada port ' + port + ' — layar dibagikan', 'success');
    } else {
      showToast('Gagal memulai: ' + result.error, 'error');
      hostLog('Error: ' + result.error, 'error');
      btnStartHost.disabled = false;
      btnStartHost.innerHTML = `<svg viewBox="0 0 20 20"><path d="M5 3l12 7-12 7V3z" fill="currentColor"/></svg> Mulai Hosting`;
    }
  });

  // Stop hosting
  btnStopHost.addEventListener('click', async () => {
    hostBroadcaster.stop();
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
      clientViewer.disconnect();
      setClientDisconnected();
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

    clientViewer.onConnected = () => {
      screenPlaceholder.classList.add('hidden');
      screenVideo.classList.remove('hidden');
    };
    clientViewer.onDisconnected = () => {
      if (state.clientConnected) {
        setClientDisconnected();
        clientLog('Koneksi terputus', 'warn');
      }
    };

    try {
      await clientViewer.start(host, port, password);
      setClientConnected();
      clientLog('Terhubung ke host!', 'success');
      showToast('Berhasil terhubung!', 'success');
    } catch (err) {
      showToast(err.message, 'error');
      clientLog('Gagal: ' + err.message, 'error');
      clientViewer.disconnect();
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
  btnDisconnect.addEventListener('click', () => {
    clientViewer.disconnect();
    setClientDisconnected();
    clientLog('Koneksi diputus oleh pengguna', 'warn');
  });

  // Toggle input control
  btnToggleInput.addEventListener('click', () => {
    state.inputEnabled = !state.inputEnabled;
    if (state.inputEnabled) {
      btnToggleInput.classList.remove('disabled');
      btnToggleInput.querySelector('span').textContent = 'Kontrol Aktif';
      screenVideo.style.cursor = 'crosshair';
      showToast('Kontrol input diaktifkan', 'success');
    } else {
      btnToggleInput.classList.add('disabled');
      btnToggleInput.querySelector('span').textContent = 'Kontrol Nonaktif';
      screenVideo.style.cursor = 'default';
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
  screenVideo.classList.remove('hidden');
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
  screenVideo.classList.add('hidden');
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
      case 'viewer-count':
        hostClientCount.textContent = event.count;
        hostLog(`Viewer terhubung: ${event.count}`, event.count > 0 ? 'success' : 'info');
        break;
      case 'error':
        hostLog('Error: ' + event.message, 'error');
        showToast('Error: ' + event.message, 'error');
        break;
    }
  });

  // Catatan: koneksi client & frame kini ditangani langsung di renderer
  // (clientViewer + WebRTC), bukan lewat IPC main process.
}

// ────────────────────────────────────────────────────────────────────────────
// Input Forwarding (mouse + keyboard)
// ────────────────────────────────────────────────────────────────────────────
function setupCanvasInput() {
  screenVideo.addEventListener('mousemove',  onCanvasMouseMove);
  screenVideo.addEventListener('mousedown',  onCanvasMouseDown);
  screenVideo.addEventListener('mouseup',    onCanvasMouseUp);
  screenVideo.addEventListener('click',      onCanvasClick);
  screenVideo.addEventListener('dblclick',   onCanvasDblClick);
  screenVideo.addEventListener('wheel',      onCanvasWheel, { passive: false });
  screenVideo.addEventListener('contextmenu', onCanvasContextMenu);
  document.addEventListener('keydown',  onKeyDown);
  document.addEventListener('keyup',    onKeyUp);
}

function removeCanvasInput() {
  screenVideo.removeEventListener('mousemove',  onCanvasMouseMove);
  screenVideo.removeEventListener('mousedown',  onCanvasMouseDown);
  screenVideo.removeEventListener('mouseup',    onCanvasMouseUp);
  screenVideo.removeEventListener('click',      onCanvasClick);
  screenVideo.removeEventListener('dblclick',   onCanvasDblClick);
  screenVideo.removeEventListener('wheel',      onCanvasWheel);
  screenVideo.removeEventListener('contextmenu', onCanvasContextMenu);
  document.removeEventListener('keydown',  onKeyDown);
  document.removeEventListener('keyup',    onKeyUp);
}

function canvasToScreenCoords(e) {
  // Pakai area konten video yang ter-render (object-fit: contain → hitung letterbox).
  const rect = screenVideo.getBoundingClientRect();
  const vW = screenVideo.videoWidth || rect.width;
  const vH = screenVideo.videoHeight || rect.height;
  const scale = Math.min(rect.width / vW, rect.height / vH);
  const dispW = vW * scale, dispH = vH * scale;
  const offX = (rect.width - dispW) / 2;
  const offY = (rect.height - dispH) / 2;
  const x = e.clientX - rect.left - offX;
  const y = e.clientY - rect.top - offY;
  return { x, y, screenW: dispW, screenH: dispH };
}

function getModifiers(e) {
  return { ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey };
}

function sendInput(data) {
  if (!state.inputEnabled || !state.clientConnected) return;
  clientViewer.sendInput(data);
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
