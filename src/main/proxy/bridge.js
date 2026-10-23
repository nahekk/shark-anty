'use strict';
const http = require('node:http');
const { connectThrough } = require('./upstream');
const log = require('../log');

/**
 * Chromium cannot use SOCKS proxies with a username/password, and it pops up a
 * login dialog for authenticated HTTP proxies. To make every proxy type "just work",
 * each running profile gets a tiny local HTTP proxy on 127.0.0.1 that forwards all
 * traffic to the real upstream proxy and handles the authentication itself.
 *
 * Chromium only ever talks to 127.0.0.1:<port>, sends hostnames (not IPs) in
 * CONNECT requests, and the upstream proxy resolves DNS - so DNS does not leak.
 */
class ProxyBridge {
  constructor(upstream, label = '') {
    this.upstream = upstream;
    this.label = label;
    this.server = null;
    this.port = 0;
    this.sockets = new Set();
  }

  start() {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => this._onRequest(req, res));
      server.on('connect', (req, socket, head) => this._onConnect(req, socket, head));
      server.on('connection', (s) => {
        this.sockets.add(s);
        s.on('close', () => this.sockets.delete(s));
      });
      server.on('clientError', (err, socket) => socket.destroy());
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        this.server = server;
        this.port = server.address().port;
        resolve(this.port);
      });
    });
  }

  stop() {
    for (const s of this.sockets) s.destroy();
    this.sockets.clear();
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
      this.server = null;
    });
  }

  async _onConnect(req, client, head) {
    const [host, port] = splitTarget(req.url, 443);
    let upstream;
    try {
      upstream = await connectThrough(this.upstream, host, port);
    } catch (e) {
      log.warn(`[bridge ${this.label}] CONNECT ${host}:${port} failed: ${e.message}`);
      if (!client.destroyed) {
        client.end(`HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain\r\n\r\nShark{anty} proxy error: ${e.message}`);
      }
      return;
    }
    if (client.destroyed) return upstream.destroy();
    this._track(upstream);
    client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head && head.length) upstream.write(head);
    upstream.pipe(client);
    client.pipe(upstream);
    const kill = () => {
      upstream.destroy();
      client.destroy();
    };
    upstream.on('error', kill);
    client.on('error', kill);
    upstream.on('close', () => client.destroy());
    client.on('close', () => upstream.destroy());
  }

  // Plain http:// requests arrive in absolute form ("GET http://host/path").
  _onRequest(req, res) {
    let url;
    try {
      url = new URL(req.url);
    } catch {
      res.writeHead(400).end('Bad request');
      return;
    }
    const headers = { ...req.headers };
    delete headers['proxy-connection'];
    delete headers['proxy-authorization'];

    const up = this.upstream;
    let options;
    if (up.type === 'http') {
      // Forward to the HTTP proxy in absolute form, adding our credentials.
      if (up.username) {
        headers['proxy-authorization'] =
          'Basic ' + Buffer.from(`${up.username}:${up.password || ''}`).toString('base64');
      }
      options = { host: up.host, port: up.port, method: req.method, path: req.url, headers, agent: false };
    } else {
      // SOCKS: open a tunnel, then speak plain HTTP over it. A custom Agent is
      // needed because `agent: false` makes Node ignore createConnection and
      // connect directly (bypassing the proxy).
      const port = Number(url.port) || 80;
      const agent = new http.Agent({ keepAlive: false, maxSockets: 1 });
      agent.createConnection = (_opts, cb) => {
        connectThrough(up, url.hostname, port).then(
          (s) => {
            this._track(s);
            cb(null, s);
          },
          (e) => cb(e),
        );
      };
      options = { host: url.hostname, port, method: req.method, path: url.pathname + url.search, headers, agent };
    }

    const preq = http.request(options, (pres) => {
      res.writeHead(pres.statusCode || 502, pres.rawHeaders ? rawToObject(pres.rawHeaders) : pres.headers);
      pres.pipe(res);
    });
    preq.on('error', (e) => {
      log.warn(`[bridge ${this.label}] ${req.method} ${url.host} failed: ${e.message}`);
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
      res.end(`Shark{anty} proxy error: ${e.message}`);
    });
    req.pipe(preq);
  }

  _track(sock) {
    this.sockets.add(sock);
    sock.on('close', () => this.sockets.delete(sock));
  }
}

function splitTarget(target, defPort) {
  if (target.startsWith('[')) {
    const end = target.indexOf(']');
    return [target.slice(1, end), Number(target.slice(end + 2)) || defPort];
  }
  const i = target.lastIndexOf(':');
  if (i === -1) return [target, defPort];
  return [target.slice(0, i), Number(target.slice(i + 1)) || defPort];
}

function rawToObject(raw) {
  const out = {};
  for (let i = 0; i < raw.length; i += 2) {
    const k = raw[i];
    if (out[k] === undefined) out[k] = raw[i + 1];
    else out[k] = [].concat(out[k], raw[i + 1]);
  }
  return out;
}

module.exports = { ProxyBridge };
