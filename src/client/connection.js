/**
 * Client Connection Module
 * Connects to a host WebSocket server, receives screen frames,
 * and sends mouse/keyboard input events.
 */
const WebSocket = require('ws');

/**
 * Connect to a Morderx host
 * @param {Object} opts
 * @param {string} opts.host - IP address of the host
 * @param {number} opts.port - Port number
 * @param {string} opts.password - Password
 * @param {BrowserWindow} opts.mainWindow - Electron window reference
 * @returns {Promise<Object>} Connection object
 */
function connectToHost({ host, port, password, mainWindow }) {
  return new Promise((resolve, reject) => {
    const url = `ws://${host}:${port}`;
    console.log(`[CLIENT] Connecting to ${url}`);

    const ws = new WebSocket(url, {
      handshakeTimeout: 8000,
    });

    let connected = false;
    let pingInterval = null;
    let frameCount = 0;
    let lastFpsTime = Date.now();

    ws.on('open', () => {
      console.log('[CLIENT] Connected, waiting for auth challenge...');
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        switch (msg.type) {
          case 'auth-required':
            // Send auth credentials
            ws.send(JSON.stringify({ type: 'auth', password }));
            break;

          case 'auth-ok':
            connected = true;
            console.log(`[CLIENT] Authenticated. Clients: ${msg.clientCount}`);
            mainWindow.webContents.send('client-event', {
              type: 'connected',
              clientCount: msg.clientCount,
            });
            // Start ping interval
            pingInterval = setInterval(() => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
              }
            }, 5000);
            resolve(createConnectionObject(ws, pingInterval));
            break;

          case 'auth-failed':
            console.error('[CLIENT] Authentication failed');
            ws.close();
            reject(new Error('Password salah atau autentikasi gagal'));
            break;

          case 'frame':
            // Forward frame to renderer
            frameCount++;
            const now = Date.now();
            if (now - lastFpsTime >= 1000) {
              const fps = frameCount;
              frameCount = 0;
              lastFpsTime = now;
              mainWindow.webContents.send('client-event', { type: 'fps', fps });
            }
            mainWindow.webContents.send('screen-frame', {
              data: msg.data,
              format: msg.format,
              ts: msg.ts,
            });
            break;

          case 'pong':
            const latency = Date.now() - msg.ts;
            mainWindow.webContents.send('client-event', { type: 'latency', ms: latency });
            break;

          default:
            console.log('[CLIENT] Unknown message:', msg.type);
        }
      } catch (err) {
        console.error('[CLIENT] Parse error:', err.message);
      }
    });

    ws.on('close', (code, reason) => {
      connected = false;
      if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
      console.log(`[CLIENT] Disconnected: ${code} ${reason}`);
      mainWindow.webContents.send('client-event', { type: 'disconnected', code });
    });

    ws.on('error', (err) => {
      console.error('[CLIENT] Error:', err.message);
      if (!connected) {
        reject(new Error(`Tidak dapat terhubung ke host: ${err.message}`));
      } else {
        mainWindow.webContents.send('client-event', { type: 'error', message: err.message });
      }
    });

    // Connection timeout
    setTimeout(() => {
      if (!connected && ws.readyState !== WebSocket.OPEN) {
        ws.terminate();
        reject(new Error('Connection timeout - periksa IP dan port host'));
      }
    }, 10000);
  });
}

/**
 * Create a connection object exposing sendInput and disconnect methods
 */
function createConnectionObject(ws, pingInterval) {
  return {
    sendInput(event) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data: event }));
      }
    },
    disconnect() {
      if (pingInterval) clearInterval(pingInterval);
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1000, 'Client disconnecting');
      }
    },
    get isConnected() {
      return ws.readyState === WebSocket.OPEN;
    },
  };
}

module.exports = { connectToHost };
