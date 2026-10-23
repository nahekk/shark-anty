'use strict';
// End-to-end: client -> ProxyBridge (127.0.0.1) -> upstream proxy (HTTP / SOCKS5 / SOCKS4, with auth) -> target server
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { ProxyBridge } = require('../src/main/proxy/bridge');

const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));

// --- target web server
function target() {
  const srv = http.createServer((req, res) => res.end(`hello ${req.method} ${req.url}`));
  return listen(srv).then((port) => ({ srv, port }));
}

// --- upstream HTTP proxy requiring Basic auth (supports CONNECT and absolute-form)
function httpProxy(user, pass) {
  const expected = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
  const srv = http.createServer((req, res) => {
    if (req.headers['proxy-authorization'] !== expected) return res.writeHead(407).end();
    const u = new URL(req.url);
    const preq = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method: req.method }, (pres) => {
      res.writeHead(pres.statusCode, pres.headers);
      pres.pipe(res);
    });
    req.pipe(preq);
  });
  srv.on('connect', (req, sock, head) => {
    if (req.headers['proxy-authorization'] !== expected) return sock.end('HTTP/1.1 407 Proxy Auth Required\r\n\r\n');
    const [h, p] = req.url.split(':');
    const up = net.connect(Number(p), h, () => {
      sock.write('HTTP/1.1 200 OK\r\n\r\n');
      up.write(head);
      up.pipe(sock);
      sock.pipe(up);
    });
    up.on('error', () => sock.destroy());
  });
  return listen(srv).then((port) => ({ srv, port }));
}

// --- minimal SOCKS5 server with username/password auth (RFC 1928/1929)
function socks5(user, pass) {
  const srv = net.createServer((c) => {
    c.once('data', (greet) => {
      if (greet[0] !== 5) return c.destroy();
      c.write(Buffer.from([5, 2]));
      c.once('data', (auth) => {
        const ul = auth[1];
        const u = auth.slice(2, 2 + ul).toString();
        const pl = auth[2 + ul];
        const p = auth.slice(3 + ul, 3 + ul + pl).toString();
        if (u !== user || p !== pass) {
          c.end(Buffer.from([1, 1]));
          return;
        }
        c.write(Buffer.from([1, 0]));
        c.once('data', (req) => {
          let host;
          let off;
          if (req[3] === 1) {
            host = [...req.slice(4, 8)].join('.');
            off = 8;
          } else if (req[3] === 3) {
            const len = req[4];
            host = req.slice(5, 5 + len).toString();
            off = 5 + len;
          } else return c.destroy();
          const port = req.readUInt16BE(off);
          c.socksHost = host;
          const up = net.connect(port, host === 'localhost' ? '127.0.0.1' : host, () => {
            c.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
            up.pipe(c);
            c.pipe(up);
          });
          up.on('error', () => c.destroy());
        });
      });
    });
  });
  return listen(srv).then((port) => ({ srv, port }));
}

// --- minimal SOCKS4a server
function socks4() {
  const srv = net.createServer((c) => {
    c.once('data', (req) => {
      const port = req.readUInt16BE(2);
      let host = [...req.slice(4, 8)].join('.');
      const end = req.indexOf(0, 8);
      if (host.startsWith('0.0.0.')) host = req.slice(end + 1, req.indexOf(0, end + 1)).toString();
      const up = net.connect(port, host === 'localhost' ? '127.0.0.1' : host, () => {
        c.write(Buffer.from([0, 0x5a, 0, 0, 0, 0, 0, 0]));
        up.pipe(c);
        c.pipe(up);
      });
      up.on('error', () => c.destroy());
    });
  });
  return listen(srv).then((port) => ({ srv, port }));
}

// GET via bridge using absolute-form (plain http)
function getAbsolute(bridgePort, url) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port: bridgePort, path: url, headers: { Host: new URL(url).host } }, (res) => {
        let b = '';
        res.on('data', (d) => (b += d));
        res.on('end', () => resolve({ status: res.statusCode, body: b }));
      })
      .on('error', reject);
  });
}

// GET via bridge using a CONNECT tunnel (what Chromium does for https)
function getConnect(bridgePort, host, port) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: bridgePort, method: 'CONNECT', path: `${host}:${port}` });
    req.on('connect', (res, sock) => {
      if (res.statusCode !== 200) return resolve({ status: res.statusCode, body: '' });
      sock.write(`GET /tunnel HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
      let b = '';
      sock.on('data', (d) => (b += d));
      sock.on('end', () => resolve({ status: 200, body: b }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('bridge -> HTTP proxy with auth', async () => {
  const t = await target();
  const up = await httpProxy('alice', 's3cret');
  const bridge = new ProxyBridge({ type: 'http', host: '127.0.0.1', port: up.port, username: 'alice', password: 's3cret' });
  const bp = await bridge.start();
  try {
    const a = await getAbsolute(bp, `http://127.0.0.1:${t.port}/plain?x=1`);
    assert.equal(a.status, 200);
    assert.equal(a.body, 'hello GET /plain?x=1');
    const c = await getConnect(bp, '127.0.0.1', t.port);
    assert.match(c.body, /hello GET \/tunnel/);
  } finally {
    await bridge.stop();
    up.srv.close();
    t.srv.close();
  }
});

test('bridge -> HTTP proxy with WRONG auth returns 502 with explanation', async () => {
  const t = await target();
  const up = await httpProxy('alice', 's3cret');
  const bridge = new ProxyBridge({ type: 'http', host: '127.0.0.1', port: up.port, username: 'alice', password: 'nope' });
  const bp = await bridge.start();
  try {
    const c = await getConnect(bp, '127.0.0.1', t.port);
    assert.equal(c.status, 502);
  } finally {
    await bridge.stop();
    up.srv.close();
    t.srv.close();
  }
});

test('bridge -> SOCKS5 with auth (hostname resolved remotely)', async () => {
  const t = await target();
  const up = await socks5('bob', 'pw');
  const bridge = new ProxyBridge({ type: 'socks5', host: '127.0.0.1', port: up.port, username: 'bob', password: 'pw' });
  const bp = await bridge.start();
  try {
    const a = await getAbsolute(bp, `http://localhost:${t.port}/via-socks`);
    assert.equal(a.body, 'hello GET /via-socks');
    const c = await getConnect(bp, 'localhost', t.port);
    assert.match(c.body, /hello GET \/tunnel/);
  } finally {
    await bridge.stop();
    up.srv.close();
    t.srv.close();
  }
});

test('bridge -> SOCKS4a', async () => {
  const t = await target();
  const up = await socks4();
  const bridge = new ProxyBridge({ type: 'socks4', host: '127.0.0.1', port: up.port, username: '', password: '' });
  const bp = await bridge.start();
  try {
    const c = await getConnect(bp, 'localhost', t.port);
    assert.match(c.body, /hello GET \/tunnel/);
  } finally {
    await bridge.stop();
    up.srv.close();
    t.srv.close();
  }
});
