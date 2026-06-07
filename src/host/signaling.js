/**
 * WebRTC Signaling Relay
 * Dipakai bersama oleh server.js standalone dan host Electron.
 *
 * Tugasnya: merelay sinyal WebRTC (SDP/ICE) antara satu host (broadcaster)
 * dan banyak viewer, lalu meneruskan input mouse/keyboard dari viewer ke robotjs.
 * Tidak ada lagi capture/encode di sini — itu dilakukan oleh browser engine.
 */
'use strict';

const os = require('os');
const WebSocket = require('ws');
const { createHash } = require('crypto');
const { executeInput } = require('./input');

function getLocalIPs() {
  const result = [];
  for (const [name, nets] of Object.entries(os.networkInterfaces())) {
    for (const net of nets) {
      if (net.family === 'IPv4' && !net.internal) result.push({ name, address: net.address });
    }
  }
  return result;
}

function verifyPassword(provided, actual) {
  if (!actual) return true;
  if (!provided) return false;
  const h = (s) => createHash('sha256').update(s).digest('hex');
  return h(provided) === h(actual);
}

/**
 * Pasang logika signaling pada sebuah WebSocket.Server.
 * @param {WebSocket.Server} wss
 * @param {Object} opts
 * @param {string}   [opts.password='']      Password viewer/host.
 * @param {Function} [opts.log]              log(message)
 * @param {Function} [opts.onViewerCount]    onViewerCount(count)
 * @returns {{ viewerCount: () => number }}
 */
function attachSignaling(wss, { password = '', log = () => {}, onViewerCount = () => {} } = {}) {
  let host = null;                 // ws broadcaster
  const viewers = new Map();       // viewerId -> ws
  let nextViewerId = 1;

  const send = (ws, obj) => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  };

  const notifyViewerCount = () => {
    const count = viewers.size;
    for (const v of viewers.values()) send(v, { type: 'viewer-count', count });
    send(host, { type: 'viewer-count', count });
    onViewerCount(count);
  };

  wss.on('connection', (ws, req) => {
    const ip = (req && req.socket && req.socket.remoteAddress) || 'unknown';
    ws.role = null;
    ws.viewerId = null;
    ws.authed = false;

    send(ws, { type: 'auth-required' });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      if (!ws.authed) {
        if (msg.type === 'auth' && verifyPassword(msg.password, password)) {
          ws.authed = true;
          ws.role = msg.role === 'host' ? 'host' : 'viewer';

          if (ws.role === 'host') {
            if (host && host.readyState === WebSocket.OPEN) host.close();
            host = ws;
            send(ws, { type: 'auth-ok', role: 'host', ips: getLocalIPs(), hostname: os.hostname() });
            log(`🖥️  Host terhubung: ${ip}`);
            for (const id of viewers.keys()) send(host, { type: 'viewer-join', viewerId: id });
            notifyViewerCount();
          } else {
            ws.viewerId = nextViewerId++;
            viewers.set(ws.viewerId, ws);
            send(ws, { type: 'auth-ok', role: 'viewer', ips: getLocalIPs(), hostname: os.hostname(), hostOnline: !!(host && host.readyState === WebSocket.OPEN) });
            log(`✅ Viewer #${ws.viewerId} terhubung: ${ip} (total: ${viewers.size})`);
            if (host && host.readyState === WebSocket.OPEN) send(host, { type: 'viewer-join', viewerId: ws.viewerId });
            else send(ws, { type: 'no-host' });
            notifyViewerCount();
          }
        } else {
          send(ws, { type: 'auth-failed' });
          ws.close();
        }
        return;
      }

      if (msg.type === 'signal') {
        if (ws.role === 'host') {
          send(viewers.get(msg.viewerId), { type: 'signal', signal: msg.signal });
        } else {
          send(host, { type: 'signal', viewerId: ws.viewerId, signal: msg.signal });
        }
        return;
      }

      if (msg.type === 'input' && ws.role === 'viewer') { executeInput(msg.data); return; }

      if (msg.type === 'ping') { send(ws, { type: 'pong', ts: msg.ts }); return; }
    });

    ws.on('close', () => {
      if (ws.role === 'host') {
        if (host === ws) host = null;
        log(`🖥️  Host terputus: ${ip}`);
        for (const v of viewers.values()) send(v, { type: 'no-host' });
      } else if (ws.role === 'viewer' && ws.viewerId != null) {
        viewers.delete(ws.viewerId);
        log(`⚡ Viewer #${ws.viewerId} terputus: ${ip} (sisa: ${viewers.size})`);
        send(host, { type: 'viewer-leave', viewerId: ws.viewerId });
        notifyViewerCount();
      }
    });

    ws.on('error', () => {
      if (ws.role === 'viewer' && ws.viewerId != null) viewers.delete(ws.viewerId);
      if (ws.role === 'host' && host === ws) host = null;
    });
  });

  return { viewerCount: () => viewers.size };
}

module.exports = { attachSignaling, getLocalIPs, verifyPassword };
