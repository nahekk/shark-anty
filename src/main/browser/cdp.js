'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const WebSocket = require('ws');

/** Minimal Chrome DevTools Protocol client over a browser-level WebSocket. */
class CDPClient extends EventEmitter {
  constructor(ws) {
    super();
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.closed = false;
    this.onClose = null;
    ws.on('message', (data) => this._onMessage(data));
    ws.on('close', () => {
      this.closed = true;
      for (const { reject } of this.pending.values()) reject(new Error('DevTools connection closed'));
      this.pending.clear();
      if (this.onClose) this.onClose();
    });
    ws.on('error', () => {});
  }

  static connect(url, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, { perMessageDeflate: false, maxPayload: 512 * 1024 * 1024 });
      const timer = setTimeout(() => {
        ws.terminate();
        reject(new Error('DevTools connection timed out'));
      }, timeoutMs);
      ws.once('open', () => {
        clearTimeout(timer);
        resolve(new CDPClient(ws));
      });
      ws.once('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
    });
  }

  send(method, params = {}, sessionId, timeoutMs = 30000) {
    if (this.closed) return Promise.reject(new Error('DevTools connection closed'));
    const id = this.nextId++;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.ws.send(JSON.stringify(msg));
    });
  }

  _onMessage(data) {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (msg.id && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message || 'CDP error'));
      else p.resolve(msg.result);
    } else if (msg.method) {
      this.emit(msg.method, msg.params || {}, msg.sessionId);
    }
  }

  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

/** Reads <user-data-dir>/DevToolsActivePort written by Chromium after launch. */
function readActivePort(userDataDir) {
  try {
    const [port, wsPath] = fs.readFileSync(path.join(userDataDir, 'DevToolsActivePort'), 'utf8').split(/\r?\n/);
    if (!port || !wsPath) return null;
    return { port: Number(port), wsUrl: `ws://127.0.0.1:${port}${wsPath}` };
  } catch {
    return null;
  }
}

async function waitForActivePort(userDataDir, isAlive, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const info = readActivePort(userDataDir);
    if (info) return info;
    if (isAlive && !isAlive()) throw new Error('Browser exited during startup');
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('Browser did not open its DevTools port in time');
}

module.exports = { CDPClient, readActivePort, waitForActivePort };
