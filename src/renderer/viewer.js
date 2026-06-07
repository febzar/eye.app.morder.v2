/**
 * Morderx — Browser Viewer (WebRTC)
 * Menerima video layar host via WebRTC dan meneruskan input lewat WebSocket.
 */
'use strict';

// ── Elements ──────────────────────────────────────────────────────────────────
const authOverlay  = document.getElementById('auth-overlay');
const authPass     = document.getElementById('auth-pass');
const authBtn      = document.getElementById('auth-btn');
const authError    = document.getElementById('auth-error');
const authToggle   = document.getElementById('auth-pass-toggle');

const viewerWrap   = document.getElementById('viewer-wrap');
const placeholder  = document.getElementById('placeholder');
const video        = document.getElementById('screen-video');

const stFps        = document.getElementById('st-fps');
const stPing       = document.getElementById('st-ping');
const stHost       = document.getElementById('st-host');
const viewerCount  = document.getElementById('viewer-count');
const btnInput     = document.getElementById('btn-input-toggle');
const btnFs        = document.getElementById('btn-fullscreen');

// ── State ─────────────────────────────────────────────────────────────────────
let ws           = null;
let pc           = null;
let inputEnabled = true;

const WS_URL = `ws://${location.host}`;
const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

// ── Auth UI ───────────────────────────────────────────────────────────────────
authToggle.addEventListener('click', () => {
  authPass.type = authPass.type === 'password' ? 'text' : 'password';
  authToggle.style.color = authPass.type === 'text' ? 'var(--accent)' : '';
});

authPass.addEventListener('keydown', (e) => { if (e.key === 'Enter') connect(); });
authBtn.addEventListener('click', connect);

function connect() {
  authBtn.disabled  = true;
  authBtn.textContent = 'Menghubungkan...';
  authError.style.display = 'none';

  ws = new WebSocket(WS_URL);

  ws.addEventListener('message', async (ev) => {
    let msg; try { msg = JSON.parse(ev.data); } catch { return; }

    switch (msg.type) {
      case 'auth-required':
        ws.send(JSON.stringify({ type: 'auth', role: 'viewer', password: authPass.value }));
        break;

      case 'auth-ok':
        onConnected(msg);
        if (!msg.hostOnline) showToast('Host belum membagikan layar. Menunggu...', 'info');
        break;

      case 'auth-failed':
        authError.style.display = 'block';
        authBtn.disabled = false;
        authBtn.textContent = 'Hubungkan';
        ws.close();
        break;

      case 'no-host':
        showPlaceholder('Menunggu host membagikan layar...');
        break;

      case 'viewer-count':
        viewerCount.textContent = `${msg.count} viewer`;
        break;

      case 'signal':
        await handleSignal(msg.signal);
        break;

      case 'pong':
        stPing.textContent = (Date.now() - msg.ts) + ' ms';
        break;
    }
  });

  ws.addEventListener('close', () => {
    showToast('Koneksi terputus dari host', 'error');
    setTimeout(() => location.reload(), 2000);
  });

  ws.addEventListener('error', () => {
    authError.textContent = '❌ Tidak bisa terhubung ke server.';
    authError.style.display = 'block';
    authBtn.disabled = false;
    authBtn.textContent = 'Hubungkan';
  });
}

// ── WebRTC ──────────────────────────────────────────────────────────────────────
function ensurePeer() {
  if (pc) return pc;
  pc = new RTCPeerConnection(ICE);

  pc.ontrack = (e) => {
    video.srcObject = e.streams[0];
    video.play().catch(() => {});
    placeholder.style.display = 'none';
    video.style.display = 'block';
    startFpsMeter();
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) ws.send(JSON.stringify({ type: 'signal', signal: { candidate: e.candidate } }));
  };

  pc.onconnectionstatechange = () => {
    if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
      showPlaceholder('Koneksi video terputus, menunggu host...');
    }
  };

  return pc;
}

async function handleSignal(signal) {
  const peer = ensurePeer();
  if (signal.sdp) {
    await peer.setRemoteDescription(new RTCSessionDescription(signal.sdp));
    if (signal.sdp.type === 'offer') {
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      ws.send(JSON.stringify({ type: 'signal', signal: { sdp: peer.localDescription } }));
    }
  } else if (signal.candidate) {
    try { await peer.addIceCandidate(signal.candidate); } catch { /* ignore */ }
  }
}

function showPlaceholder(text) {
  video.style.display = 'none';
  placeholder.style.display = 'flex';
  const p = placeholder.querySelector('p');
  if (p) p.textContent = text;
}

// ── FPS meter (requestVideoFrameCallback) ─────────────────────────────────────────
let fpsFrames = 0;
let fpsLast = Date.now();
let fpsStarted = false;

function startFpsMeter() {
  if (fpsStarted) return;
  fpsStarted = true;

  if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
    const tick = () => {
      fpsFrames++;
      const now = Date.now();
      if (now - fpsLast >= 1000) { stFps.textContent = fpsFrames; fpsFrames = 0; fpsLast = now; }
      video.requestVideoFrameCallback(tick);
    };
    video.requestVideoFrameCallback(tick);
  } else {
    // Fallback: tampilkan frameRate dari track settings
    setInterval(() => {
      const tr = video.srcObject && video.srcObject.getVideoTracks()[0];
      if (tr) stFps.textContent = Math.round(tr.getSettings().frameRate || 0);
    }, 1000);
  }
}

// ── Connected ─────────────────────────────────────────────────────────────────
function onConnected(msg) {
  authOverlay.style.display = 'none';
  viewerWrap.style.display  = 'flex';

  const firstIP = msg.ips && msg.ips[0] ? msg.ips[0].address : location.hostname;
  stHost.textContent = msg.hostname || firstIP;

  showToast('Terhubung ke server!', 'success');

  setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
  }, 3000);

  setupInput();
}

// ── Input Forwarding ──────────────────────────────────────────────────────────
function sendInput(data) {
  if (!inputEnabled || !ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'input', data }));
}

function videoCoords(e) {
  const r  = video.getBoundingClientRect();
  return {
    x: e.clientX - r.left,
    y: e.clientY - r.top,
    screenW: r.width,
    screenH: r.height,
  };
}

function mods(e) {
  return { ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey };
}

let lastMove = 0;

function setupInput() {
  video.addEventListener('mousemove', (e) => {
    const now = Date.now(); if (now - lastMove < 30) return; lastMove = now;
    sendInput({ type: 'mousemove', ...videoCoords(e) });
  });
  video.addEventListener('mousedown',   (e) => { e.preventDefault(); sendInput({ type: 'mousedown', ...videoCoords(e), button: e.button }); });
  video.addEventListener('mouseup',     (e) => sendInput({ type: 'mouseup',   ...videoCoords(e), button: e.button }));
  video.addEventListener('click',       (e) => sendInput({ type: 'click',     ...videoCoords(e), button: e.button }));
  video.addEventListener('dblclick',    (e) => sendInput({ type: 'click',     ...videoCoords(e), button: e.button, double: true }));
  video.addEventListener('contextmenu', (e) => { e.preventDefault(); sendInput({ type: 'click', ...videoCoords(e), button: 2 }); });
  video.addEventListener('wheel',       (e) => { e.preventDefault(); sendInput({ type: 'scroll', ...videoCoords(e), deltaX: e.deltaX, deltaY: e.deltaY }); }, { passive: false });

  document.addEventListener('keydown', (e) => {
    if (!inputEnabled) return;
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
    // Kirim e.key mentah; pemetaan ke nama robotjs dilakukan di host (input.js).
    e.preventDefault();
    sendInput({ type: 'keydown', key: e.key, code: e.code, modifiers: mods(e) });
  });
  document.addEventListener('keyup', (e) => {
    if (!inputEnabled) return;
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
    e.preventDefault();
    sendInput({ type: 'keyup', key: e.key, code: e.code, modifiers: mods(e) });
  });
}

// ── Controls ──────────────────────────────────────────────────────────────────
btnInput.addEventListener('click', () => {
  inputEnabled = !inputEnabled;
  if (inputEnabled) {
    btnInput.classList.add('active');
    btnInput.lastChild.textContent = ' Kontrol Aktif';
    video.style.cursor = 'crosshair';
    showToast('Kontrol input aktif', 'success');
  } else {
    btnInput.classList.remove('active');
    btnInput.lastChild.textContent = ' Kontrol Nonaktif';
    video.style.cursor = 'default';
    showToast('Kontrol input nonaktif', 'info');
  }
});

btnFs.addEventListener('click', () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen();
  else document.exitFullscreen();
});

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(message, type = 'info') {
  const icons = {
    success: `<svg class="toast-icon" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/><path d="M5 8l2 2 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
    error:   `<svg class="toast-icon" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/><path d="M6 6l4 4M10 6l-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
    info:    `<svg class="toast-icon" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/><path d="M8 7v4M8 5.5v.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  };
  const container = document.getElementById('toast-container');
  const toast     = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `${icons[type]}<span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity   = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all .3s';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
