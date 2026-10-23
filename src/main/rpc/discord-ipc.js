'use strict';
const net = require('node:net');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');

/**
 * Minimal Discord RPC client over the local IPC pipe (no dependencies).
 * Frame format: int32 LE opcode | int32 LE length | UTF-8 JSON.
 */
const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };

function pipePath(i) {
  if (process.platform === 'win32') return `\\\\?\\pipe\\discord-ipc-${i}`;
  const base = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || '/tmp';
  return path.join(base.replace(/\/$/, ''), `discord-ipc-${i}`);
}

class DiscordIPC extends EventEmitter {
  constructor(clientId) {
    super();
    this.clientId = clientId;
    this.socket = null;
    this.ready = false;
    this.buffer = Buffer.alloc(0);
    this.pending = new Map();
  }

  async connect() {
    let lastErr;
    for (let i = 0; i < 10; i++) {
      try {
        this.socket = await openPipe(pipePath(i));
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!this.socket) {
      const err = new Error('Discord is not running');
      err.code = 'DISCORD_NOT_FOUND';
      err.cause = lastErr;
      throw err;
    }
    this.socket.on('data', (d) => this._onData(d));
    this.socket.on('close', () => this._onClose());
    this.socket.on('error', () => {});

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Discord handshake timed out')), 10000);
      this.once('ready', () => {
        clearTimeout(timer);
        resolve();
      });
      this.once('handshake-error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      this._send(OP.HANDSHAKE, { v: 1, client_id: this.clientId });
    });
  }

  setActivity(activity) {
    return this._request('SET_ACTIVITY', { pid: process.pid, activity: activity || null });
  }

  clearActivity() {
    return this.setActivity(null);
  }

  close() {
    this.ready = false;
    if (this.socket) {
      try {
        this._send(OP.CLOSE, {});
        this.socket.end();
      } catch {}
      this.socket.destroy();
      this.socket = null;
    }
  }

  _request(cmd, args) {
    if (!this.ready || !this.socket) return Promise.reject(new Error('Not connected to Discord'));
    const nonce = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(nonce);
        reject(new Error(`${cmd} timed out`));
      }, 10000);
      this.pending.set(nonce, { resolve, reject, timer });
      this._send(OP.FRAME, { cmd, args, nonce });
    });
  }

  _send(op, payload) {
    const json = Buffer.from(JSON.stringify(payload), 'utf8');
    const header = Buffer.alloc(8);
    header.writeInt32LE(op, 0);
    header.writeInt32LE(json.length, 4);
    this.socket.write(Buffer.concat([header, json]));
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 8) {
      const op = this.buffer.readInt32LE(0);
      const len = this.buffer.readInt32LE(4);
      if (this.buffer.length < 8 + len) return;
      const body = this.buffer.slice(8, 8 + len).toString('utf8');
      this.buffer = this.buffer.slice(8 + len);
      let msg = {};
      try {
        msg = JSON.parse(body);
      } catch {}
      this._handle(op, msg);
    }
  }

  _handle(op, msg) {
    if (op === OP.PING) return this._send(OP.PONG, msg);
    if (op === OP.CLOSE) {
      const err = new Error(msg.message || 'Discord closed the connection');
      err.code = msg.code;
      this.emit('handshake-error', err);
      return this.close();
    }
    if (op !== OP.FRAME) return;
    if (msg.cmd === 'DISPATCH' && msg.evt === 'READY') {
      this.ready = true;
      this.user = msg.data && msg.data.user;
      this.emit('ready');
      return;
    }
    if (msg.evt === 'ERROR' && !msg.nonce) {
      this.emit('handshake-error', new Error((msg.data && msg.data.message) || 'Discord error'));
      return;
    }
    if (msg.nonce && this.pending.has(msg.nonce)) {
      const p = this.pending.get(msg.nonce);
      this.pending.delete(msg.nonce);
      clearTimeout(p.timer);
      if (msg.evt === 'ERROR') p.reject(new Error((msg.data && msg.data.message) || 'Discord error'));
      else p.resolve(msg.data);
    }
  }

  _onClose() {
    const wasReady = this.ready;
    this.ready = false;
    this.socket = null;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('Discord connection closed'));
    }
    this.pending.clear();
    this.emit('disconnected', wasReady);
  }
}

function openPipe(p) {
  return new Promise((resolve, reject) => {
    const s = net.createConnection(p);
    s.once('connect', () => {
      s.removeAllListeners('error');
      resolve(s);
    });
    s.once('error', reject);
  });
}

module.exports = { DiscordIPC };
