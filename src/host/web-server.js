/**
 * Web Server bersama — HTTP static (renderer) + WebSocket signaling.
 * Dipakai oleh server.js (mode browser) dan main.js (mode auto-host Electron).
 */
'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { attachSignaling } = require('./signaling');

const RENDERER_DIR = path.join(__dirname, '..', 'renderer');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.png':  'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
};

/**
 * Buat HTTP server (melayani folder renderer) dengan signaling WebSocket terpasang.
 * @param {Object} opts
 * @param {string}   [opts.password='']
 * @param {Function} [opts.log]
 * @param {Function} [opts.onViewerCount]
 * @returns {http.Server} httpServer (panggil .listen sendiri)
 */
function createWebServer({ password = '', log = () => {}, onViewerCount = () => {} } = {}) {
  const httpServer = http.createServer((req, res) => {
    let urlPath = req.url.split('?')[0];
    if (urlPath === '/')     urlPath = '/viewer.html';
    if (urlPath === '/host') urlPath = '/host.html';

    const filePath = path.resolve(RENDERER_DIR, urlPath.slice(1));
    if (!filePath.startsWith(RENDERER_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }

    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not Found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
      res.end(data);
    });
  });

  const wss = new WebSocket.Server({ server: httpServer });
  attachSignaling(wss, { password, log, onViewerCount });

  return httpServer;
}

module.exports = { createWebServer, RENDERER_DIR };
