/**
 * Morderx — Browser Viewer Logic
 * WebSocket client: auth, frame rendering, input forwarding.
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
const canvas       = document.getElementById('screen-canvas');
const ctx          = canvas.getContext('2d');

const stFps        = document.getElementById('st-fps');
const stPing       = document.getElementById('st-ping');
const stHost       = document.getElementById('st-host');
const viewerCount  = document.getElementById('viewer-count');
const btnInput     = document.getElementById('btn-input-toggle');
const btnFs        = document.getElementById('btn-fullscreen');

// ── State ─────────────────────────────────────────────────────────────────────
let ws           = null;
let inputEnabled = true;
let frameCount   = 0;
let lastFpsTime  = Date.now();

// ── WebSocket URL (same host, same port) ──────────────────────────────────────
const WS_URL = `ws://${location.host}`;

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

  ws.addEventListener('open', () => {
    // Wait for auth-required from server
  });

  ws.addEventListener('message', (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      switch (msg.type) {
        case 'auth-required':
          ws.send(JSON.stringify({ type: 'auth', password: authPass.value }));
          break;

        case 'auth-ok':
          onConnected(msg);
          break;

        case 'auth-failed':
          authError.style.display = 'block';
          authBtn.disabled = false;
          authBtn.textContent = 'Hubungkan';
          ws.close();
          break;

        case 'frame':
          renderFrame(msg);
          break;

        case 'pong':
          stPing.textContent = (Date.now() - msg.ts) + ' ms';
          break;
      }
    } catch (e) { /* ignore */ }
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

// ── Connected ─────────────────────────────────────────────────────────────────
function onConnected(msg) {
  authOverlay.style.display = 'none';
  viewerWrap.style.display  = 'flex';

  const firstIP = msg.ips && msg.ips[0] ? msg.ips[0].address : location.hostname;
  stHost.textContent = msg.hostname || firstIP;
  viewerCount.textContent = `${msg.viewerCount} viewer`;

  showToast('Terhubung ke host!', 'success');

  // Start ping loop
  setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
    }
  }, 3000);

  // Setup input events on canvas
  setupInput();
}

// ── Frame Rendering ───────────────────────────────────────────────────────────
function renderFrame(msg) {
  // FPS counter
  frameCount++;
  const now = Date.now();
  if (now - lastFpsTime >= 1000) {
    stFps.textContent = frameCount;
    frameCount  = 0;
    lastFpsTime = now;
  }

  const img = new Image();
  img.onload = () => {
    const wrap = document.getElementById('canvas-wrap');
    const cw   = wrap.clientWidth;
    const ch   = wrap.clientHeight;
    const ar   = img.naturalWidth / img.naturalHeight;
    const car  = cw / ch;

    let dw, dh;
    if (ar > car) { dw = cw; dh = cw / ar; }
    else          { dh = ch; dw = ch * ar; }

    canvas.width         = dw;
    canvas.height        = dh;
    canvas.style.width   = dw + 'px';
    canvas.style.height  = dh + 'px';
    canvas._nw = img.naturalWidth;
    canvas._nh = img.naturalHeight;
    ctx.drawImage(img, 0, 0, dw, dh);

    // Show canvas, hide placeholder
    placeholder.style.display = 'none';
    canvas.style.display = 'block';
  };
  img.src = `data:image/${msg.format};base64,${msg.data}`;
}

// ── Input Forwarding ──────────────────────────────────────────────────────────
function sendInput(data) {
  if (!inputEnabled || !ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'input', data }));
}

function canvasCoords(e) {
  const r  = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top, screenW: canvas._nw || canvas.width, screenH: canvas._nh || canvas.height };
}

function mods(e) {
  return { ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey };
}

let lastMove = 0;
const KEY_MAP = {
  'Enter':'enter','Tab':'tab','Escape':'escape','Backspace':'backspace','Delete':'delete',
  'ArrowUp':'up','ArrowDown':'down','ArrowLeft':'left','ArrowRight':'right',
  'Home':'home','End':'end','PageUp':'pageup','PageDown':'pagedown',
  'F1':'f1','F2':'f2','F3':'f3','F4':'f4','F5':'f5','F6':'f6',
  'F7':'f7','F8':'f8','F9':'f9','F10':'f10','F11':'f11','F12':'f12',
  'Control':'control','Shift':'shift','Alt':'alt','Meta':'command',' ':'space',
};
const mapKey = (k) => KEY_MAP[k] || (k.length === 1 ? k.toLowerCase() : null);
const mapBtn = (b) => b === 2 ? 'right' : b === 1 ? 'middle' : 'left';

function setupInput() {
  canvas.addEventListener('mousemove', (e) => {
    const now = Date.now(); if (now - lastMove < 30) return; lastMove = now;
    const c = canvasCoords(e);
    sendInput({ type: 'mousemove', ...c });
  });
  canvas.addEventListener('mousedown',   (e) => { e.preventDefault(); sendInput({ type: 'mousedown',   ...canvasCoords(e), button: e.button }); });
  canvas.addEventListener('mouseup',     (e) => sendInput({ type: 'mouseup',     ...canvasCoords(e), button: e.button }));
  canvas.addEventListener('click',       (e) => sendInput({ type: 'click',       ...canvasCoords(e), button: e.button }));
  canvas.addEventListener('dblclick',    (e) => sendInput({ type: 'click',       ...canvasCoords(e), button: e.button, double: true }));
  canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); sendInput({ type: 'click', ...canvasCoords(e), button: 2 }); });
  canvas.addEventListener('wheel',       (e) => { e.preventDefault(); sendInput({ type: 'scroll', ...canvasCoords(e), deltaX: e.deltaX, deltaY: e.deltaY }); }, { passive: false });

  document.addEventListener('keydown', (e) => {
    if (!inputEnabled) return;
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
    const key = mapKey(e.key);
    if (key) { e.preventDefault(); sendInput({ type: 'keydown', key, code: e.code, modifiers: mods(e) }); }
  });
  document.addEventListener('keyup', (e) => {
    if (!inputEnabled) return;
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
    const key = mapKey(e.key);
    if (key) { e.preventDefault(); sendInput({ type: 'keyup', key, code: e.code, modifiers: mods(e) }); }
  });
}

// ── Controls ──────────────────────────────────────────────────────────────────
btnInput.addEventListener('click', () => {
  inputEnabled = !inputEnabled;
  if (inputEnabled) {
    btnInput.classList.add('active');
    btnInput.lastChild.textContent = ' Kontrol Aktif';
    canvas.style.cursor = 'crosshair';
    showToast('Kontrol input aktif', 'success');
  } else {
    btnInput.classList.remove('active');
    btnInput.lastChild.textContent = ' Kontrol Nonaktif';
    canvas.style.cursor = 'default';
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
