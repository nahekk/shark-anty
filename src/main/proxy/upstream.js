'use strict';
const net = require('node:net');
const { SocksClient } = require('socks');

/**
 * Opens a TCP tunnel to host:port through the given upstream proxy.
 * Supports HTTP (CONNECT), SOCKS4/4a and SOCKS5, with or without auth.
 * Hostnames are resolved by the proxy (remote DNS), so no DNS leaks.
 * Resolves with a connected net.Socket.
 */
function connectThrough(proxy, host, port, timeoutMs = 15000) {
  if (!proxy) return connectDirect(host, port, timeoutMs);
  if (proxy.type === 'http') return connectHttp(proxy, host, port, timeoutMs);
  if (proxy.type === 'socks5' || proxy.type === 'socks4') return connectSocks(proxy, host, port, timeoutMs);
  return Promise.reject(new Error(`Unsupported proxy type: ${proxy.type}`));
}

function connectDirect(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port });
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error('Connection timed out'));
    }, timeoutMs);
    sock.once('connect', () => {
      clearTimeout(timer);
      resolve(sock);
    });
    sock.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

async function connectSocks(proxy, host, port, timeoutMs) {
  const { socket } = await SocksClient.createConnection({
    proxy: {
      host: proxy.host,
      port: Number(proxy.port),
      type: proxy.type === 'socks4' ? 4 : 5,
      userId: proxy.username || undefined,
      password: proxy.type === 'socks5' ? proxy.password || undefined : undefined,
    },
    command: 'connect',
    destination: { host, port: Number(port) },
    timeout: timeoutMs,
  });
  return socket;
}

function connectHttp(proxy, host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: proxy.host, port: Number(proxy.port) });
    let done = false;
    let buf = Buffer.alloc(0);

    const fail = (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sock.destroy();
      reject(err);
    };
    const timer = setTimeout(() => fail(new Error('Proxy connection timed out')), timeoutMs);

    sock.once('error', fail);
    sock.once('close', () => fail(new Error('Proxy closed the connection')));
    sock.once('connect', () => {
      const target = host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`;
      const lines = [`CONNECT ${target} HTTP/1.1`, `Host: ${target}`, 'Proxy-Connection: keep-alive'];
      if (proxy.username) {
        const token = Buffer.from(`${proxy.username}:${proxy.password || ''}`).toString('base64');
        lines.push(`Proxy-Authorization: Basic ${token}`);
      }
      sock.write(lines.join('\r\n') + '\r\n\r\n');
    });

    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const end = buf.indexOf('\r\n\r\n');
      if (end === -1) {
        if (buf.length > 64 * 1024) fail(new Error('Invalid proxy response'));
        return;
      }
      sock.off('data', onData);
      const head = buf.slice(0, end).toString('latin1');
      const rest = buf.slice(end + 4);
      const status = Number((head.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/) || [])[1]);
      if (status !== 200) {
        const err = new Error(status === 407 ? 'Proxy authentication failed (407)' : `Proxy refused CONNECT (${status || 'bad response'})`);
        err.statusCode = status;
        return fail(err);
      }
      done = true;
      clearTimeout(timer);
      sock.removeAllListeners('error');
      sock.removeAllListeners('close');
      if (rest.length) sock.unshift(rest);
      resolve(sock);
    };
    sock.on('data', onData);
  });
}

module.exports = { connectThrough };
