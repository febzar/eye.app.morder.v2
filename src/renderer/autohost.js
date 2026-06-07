/**
 * Morderx — Auto Host (hidden renderer)
 *
 * Berjalan di jendela Electron tersembunyi. Otomatis menangkap layar via
 * desktopCapturer (tanpa dialog pemilih) lalu menyiarkannya ke setiap viewer
 * lewat WebRTC. Tidak ada UI / tombol — langsung mulai saat dimuat.
 */
'use strict';

const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
const params   = new URLSearchParams(location.search);
const PORT     = params.get('port') || '3000';
const PASSWORD = params.get('password') || '';

const report = (msg) => { try { window.morderx.autoHostStatus(msg); } catch {} };

let ws = null;
let stream = null;
const peers = new Map();   // viewerId -> RTCPeerConnection
let retryTimer = null;

start();

async function start() {
  try {
    const sources = await window.morderx.getDesktopSources();
    if (!sources || !sources.length) throw new Error('Tidak ada sumber layar');

    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sources[0].id,
          maxFrameRate: 60,
        },
      },
    });
    report('Layar tertangkap — ' + sources[0].name);
    connect();
  } catch (err) {
    // Sering karena izin Screen Recording belum diberikan. Coba lagi otomatis
    // supaya broadcaster pulih sendiri setelah user mengaktifkan izin.
    report('GAGAL capture: ' + err.message + ' — coba lagi 3s (cek izin Screen Recording)');
    setTimeout(start, 3000);
  }
}

function connect() {
  ws = new WebSocket(`ws://localhost:${PORT}`);

  ws.addEventListener('message', async (ev) => {
    let msg; try { msg = JSON.parse(ev.data); } catch { return; }
    switch (msg.type) {
      case 'auth-required':
        ws.send(JSON.stringify({ type: 'auth', role: 'host', password: PASSWORD }));
        break;
      case 'auth-ok':
        report('Broadcasting aktif ✓');
        break;
      case 'auth-failed':
        report('Auth host gagal (password salah?)');
        break;
      case 'viewer-join':  await createPeer(msg.viewerId); break;
      case 'viewer-leave': closePeer(msg.viewerId); break;
      case 'signal':       await onSignal(msg.viewerId, msg.signal); break;
    }
  });

  ws.addEventListener('close', () => {
    // Server mungkin belum siap / restart → coba sambung ulang.
    if (retryTimer) return;
    retryTimer = setTimeout(() => { retryTimer = null; connect(); }, 1500);
  });
  ws.addEventListener('error', () => {});
}

async function createPeer(viewerId) {
  closePeer(viewerId);
  const pc = new RTCPeerConnection(ICE);
  peers.set(viewerId, pc);
  for (const track of stream.getTracks()) pc.addTrack(track, stream);
  pc.onicecandidate = (e) => {
    if (e.candidate) ws.send(JSON.stringify({ type: 'signal', viewerId, signal: { candidate: e.candidate } }));
  };
  pc.onconnectionstatechange = () => {
    if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) closePeer(viewerId);
  };
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  ws.send(JSON.stringify({ type: 'signal', viewerId, signal: { sdp: pc.localDescription } }));
}

async function onSignal(viewerId, signal) {
  const pc = peers.get(viewerId);
  if (!pc) return;
  if (signal.sdp) await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
  else if (signal.candidate) { try { await pc.addIceCandidate(signal.candidate); } catch {} }
}

function closePeer(viewerId) {
  const pc = peers.get(viewerId);
  if (pc) { pc.close(); peers.delete(viewerId); }
}
