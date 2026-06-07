/**
 * Morderx — Host Broadcaster (WebRTC)
 *
 * Berjalan di mesin yang dibagikan. Menangkap layar via getDisplayMedia
 * (akselerasi hardware), lalu menyiarkannya ke setiap viewer melalui
 * RTCPeerConnection. Sinyal SDP/ICE direlay oleh server lewat WebSocket.
 */
'use strict';

const $ = (id) => document.getElementById(id);

const passInput   = $('host-pass');
const startBtn     = $('start-btn');
const stopBtn      = $('stop-btn');
const statusEl     = $('status');
const viewerCntEl  = $('viewer-count');
const preview      = $('preview');
const errorEl      = $('error');

const WS_URL = `ws://${location.host}`;
const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

let ws       = null;
let stream   = null;
const peers  = new Map();   // viewerId -> RTCPeerConnection

// ── Mulai berbagi ───────────────────────────────────────────────────────────────
startBtn.addEventListener('click', startSharing);
stopBtn.addEventListener('click', stopSharing);

async function startSharing() {
  errorEl.style.display = 'none';
  try {
    // Minta izin & ambil layar. frameRate tinggi = stream halus.
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 30, max: 60 }, cursor: 'always' },
      audio: false,
    });
  } catch (err) {
    showError('Gagal mengambil layar: ' + err.message);
    return;
  }

  preview.srcObject = stream;
  preview.play().catch(() => {});

  // Jika user menghentikan share dari UI browser
  stream.getVideoTracks()[0].addEventListener('ended', stopSharing);

  startBtn.style.display = 'none';
  stopBtn.style.display  = 'inline-flex';
  passInput.disabled = true;

  connectSignaling();
}

function stopSharing() {
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  for (const pc of peers.values()) pc.close();
  peers.clear();
  if (ws) { ws.close(); ws = null; }
  preview.srcObject = null;
  startBtn.style.display = 'inline-flex';
  stopBtn.style.display  = 'none';
  passInput.disabled = false;
  setStatus('Berhenti berbagi', 'idle');
  viewerCntEl.textContent = '0';
}

// ── Signaling ────────────────────────────────────────────────────────────────────
function connectSignaling() {
  setStatus('Menghubungkan ke server...', 'connecting');
  ws = new WebSocket(WS_URL);

  ws.addEventListener('message', async (ev) => {
    let msg; try { msg = JSON.parse(ev.data); } catch { return; }

    switch (msg.type) {
      case 'auth-required':
        ws.send(JSON.stringify({ type: 'auth', role: 'host', password: passInput.value }));
        break;

      case 'auth-ok':
        setStatus('Sedang berbagi layar ✓', 'live');
        break;

      case 'auth-failed':
        showError('Password salah.');
        stopSharing();
        break;

      case 'viewer-join':
        await createPeer(msg.viewerId);
        break;

      case 'viewer-leave':
        closePeer(msg.viewerId);
        break;

      case 'viewer-count':
        viewerCntEl.textContent = String(msg.count);
        break;

      case 'signal':
        await handleSignal(msg.viewerId, msg.signal);
        break;
    }
  });

  ws.addEventListener('close', () => {
    if (stream) setStatus('Koneksi server terputus', 'error');
  });
  ws.addEventListener('error', () => showError('Tidak bisa terhubung ke server.'));
}

// ── Per-viewer peer connection ────────────────────────────────────────────────────
async function createPeer(viewerId) {
  if (peers.has(viewerId)) closePeer(viewerId);

  const pc = new RTCPeerConnection(ICE);
  peers.set(viewerId, pc);

  for (const track of stream.getTracks()) pc.addTrack(track, stream);

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      ws.send(JSON.stringify({ type: 'signal', viewerId, signal: { candidate: e.candidate } }));
    }
  };

  pc.onconnectionstatechange = () => {
    if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) closePeer(viewerId);
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  ws.send(JSON.stringify({ type: 'signal', viewerId, signal: { sdp: pc.localDescription } }));
}

async function handleSignal(viewerId, signal) {
  const pc = peers.get(viewerId);
  if (!pc) return;
  if (signal.sdp) {
    await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
  } else if (signal.candidate) {
    try { await pc.addIceCandidate(signal.candidate); } catch { /* ignore */ }
  }
}

function closePeer(viewerId) {
  const pc = peers.get(viewerId);
  if (pc) { pc.close(); peers.delete(viewerId); }
}

// ── UI helpers ───────────────────────────────────────────────────────────────────
function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = 'status ' + (kind || '');
}
function showError(text) {
  errorEl.textContent = text;
  errorEl.style.display = 'block';
}
