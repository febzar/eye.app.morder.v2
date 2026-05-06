/**
 * Host Server - Captures screen and serves it to clients over WebSocket.
 * Also accepts input events (mouse/keyboard) from clients.
 */
const WebSocket = require('ws');
const { createHash } = require('crypto');
const { captureScreen } = require('./capture');
const { executeInput } = require('./input');

let captureInterval = null;
let connectedClients = new Set();
let wss = null;

/**
 * Start the WebSocket host server
 * @param {Object} opts
 * @param {number} opts.port
 * @param {string} opts.password
 * @param {BrowserWindow} opts.mainWindow
 */
async function startHostServer({ port, password, mainWindow }) {
  return new Promise((resolve, reject) => {
    try {
      wss = new WebSocket.Server({ port }, () => {
        console.log(`[HOST] Server started on port ${port}`);
        mainWindow.webContents.send('host-event', {
          type: 'server-started',
          port,
        });
        startCapture(mainWindow);
        resolve(wss);
      });

      wss.on('connection', (ws, req) => {
        const clientIP = req.socket.remoteAddress;
        console.log(`[HOST] Client connecting from ${clientIP}`);
        let authenticated = false;

        // Send auth challenge
        ws.send(JSON.stringify({ type: 'auth-required', version: '1.0' }));

        ws.on('message', (raw) => {
          try {
            const msg = JSON.parse(raw.toString());

            if (!authenticated) {
              if (msg.type === 'auth' && verifyPassword(msg.password, password)) {
                authenticated = true;
                connectedClients.add(ws);
                ws.send(JSON.stringify({ type: 'auth-ok', clientCount: connectedClients.size }));
                console.log(`[HOST] Client authenticated: ${clientIP}`);
                mainWindow.webContents.send('host-event', {
                  type: 'client-connected',
                  ip: clientIP,
                  count: connectedClients.size,
                });
              } else {
                ws.send(JSON.stringify({ type: 'auth-failed' }));
                ws.close();
              }
              return;
            }

            // Handle input events from authenticated client
            if (msg.type === 'input') {
              executeInput(msg.data);
            } else if (msg.type === 'ping') {
              ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
            }
          } catch (e) {
            console.error('[HOST] Message parse error:', e.message);
          }
        });

        ws.on('close', () => {
          connectedClients.delete(ws);
          console.log(`[HOST] Client disconnected: ${clientIP}`);
          mainWindow.webContents.send('host-event', {
            type: 'client-disconnected',
            ip: clientIP,
            count: connectedClients.size,
          });
        });

        ws.on('error', (err) => {
          console.error('[HOST] WebSocket error:', err.message);
          connectedClients.delete(ws);
        });
      });

      wss.on('error', (err) => {
        console.error('[HOST] Server error:', err.message);
        mainWindow.webContents.send('host-event', { type: 'error', message: err.message });
        reject(err);
      });

      wss.close = function (cb) {
        stopCapture();
        connectedClients.clear();
        WebSocket.Server.prototype.close.call(this, cb);
        mainWindow.webContents.send('host-event', { type: 'server-stopped' });
      };
    } catch (err) {
      reject(err);
    }
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Screen Capture Loop
// ────────────────────────────────────────────────────────────────────────────
const TARGET_FPS = 15;
const FRAME_INTERVAL_MS = Math.round(1000 / TARGET_FPS);
let lastFrameHash = null;

function startCapture(mainWindow) {
  if (captureInterval) return;

  captureInterval = setInterval(async () => {
    if (connectedClients.size === 0) return;

    try {
      const frameData = await captureScreen();
      if (!frameData) return;

      // Skip if frame hasn't changed (simple optimization)
      const frameHash = createHash('md5').update(frameData.slice(0, 1000)).digest('hex');
      if (frameHash === lastFrameHash) return;
      lastFrameHash = frameHash;

      const message = JSON.stringify({
        type: 'frame',
        ts: Date.now(),
        data: frameData.toString('base64'),
        format: 'jpeg',
      });

      for (const ws of connectedClients) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(message, (err) => {
            if (err) connectedClients.delete(ws);
          });
        }
      }
    } catch (err) {
      console.error('[HOST] Capture error:', err.message);
    }
  }, FRAME_INTERVAL_MS);

  console.log(`[HOST] Capture started at ~${TARGET_FPS}fps`);
}

function stopCapture() {
  if (captureInterval) {
    clearInterval(captureInterval);
    captureInterval = null;
    lastFrameHash = null;
    console.log('[HOST] Capture stopped');
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Password verification (SHA-256 hash comparison)
// ────────────────────────────────────────────────────────────────────────────
function verifyPassword(provided, actual) {
  if (!actual || actual === '') return true; // No password set
  if (!provided) return false;
  const hashed = createHash('sha256').update(provided).digest('hex');
  const actualHashed = createHash('sha256').update(actual).digest('hex');
  return hashed === actualHashed;
}

module.exports = { startHostServer };
