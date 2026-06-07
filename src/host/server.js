/**
 * Host Server (Electron) — WebRTC signaling relay.
 *
 * Tidak lagi menangkap layar di proses utama. Server ini hanya merelay sinyal
 * WebRTC dan input. Capture + broadcast dilakukan oleh renderer Electron
 * (host mode) yang terhubung sebagai "host peer" lewat desktopCapturer.
 */
const WebSocket = require('ws');
const { attachSignaling } = require('./signaling');

let wss = null;

/**
 * Mulai server signaling.
 * @param {Object} opts
 * @param {number} opts.port
 * @param {string} opts.password
 * @param {BrowserWindow} opts.mainWindow
 */
async function startHostServer({ port, password, mainWindow }) {
  return new Promise((resolve, reject) => {
    try {
      wss = new WebSocket.Server({ port }, () => {
        console.log(`[HOST] Signaling server started on port ${port}`);
        mainWindow.webContents.send('host-event', { type: 'server-started', port });
        resolve(wss);
      });

      attachSignaling(wss, {
        password,
        log: (msg) => console.log('[HOST]', msg),
        onViewerCount: (count) => {
          mainWindow.webContents.send('host-event', { type: 'viewer-count', count });
        },
      });

      wss.on('error', (err) => {
        console.error('[HOST] Server error:', err.message);
        mainWindow.webContents.send('host-event', { type: 'error', message: err.message });
        reject(err);
      });

      const origClose = WebSocket.Server.prototype.close;
      wss.close = function (cb) {
        origClose.call(this, cb);
        mainWindow.webContents.send('host-event', { type: 'server-stopped' });
      };
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { startHostServer };
