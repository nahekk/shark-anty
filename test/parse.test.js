'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseProxy, parseProxyList, formatProxy } = require('../src/main/proxy/parse');

test('scheme with auth', () => {
  assert.deepEqual(parseProxy('socks5://user:p%40ss@1.2.3.4:1080'), {
    type: 'socks5', host: '1.2.3.4', port: 1080, username: 'user', password: 'p@ss',
  });
});

test('host:port uses default type', () => {
  assert.deepEqual(parseProxy('10.0.0.1:8080', 'http'), { type: 'http', host: '10.0.0.1', port: 8080, username: '', password: '' });
});

test('host:port:user:pass', () => {
  const p = parseProxy('proxy.example.com:9000:alice:secret', 'socks5');
  assert.equal(p.host, 'proxy.example.com');
  assert.equal(p.port, 9000);
  assert.equal(p.username, 'alice');
  assert.equal(p.password, 'secret');
  assert.equal(p.type, 'socks5');
});

test('user:pass@host:port and user:pass:host:port', () => {
  assert.equal(parseProxy('bob:pw@5.5.5.5:3128').username, 'bob');
  const p = parseProxy('bob:pw:5.5.5.5:3128');
  assert.equal(p.host, '5.5.5.5');
  assert.equal(p.password, 'pw');
});

test('host:port@user:pass', () => {
  const p = parseProxy('http://9.9.9.9:80@u:p');
  assert.equal(p.host, '9.9.9.9');
  assert.equal(p.username, 'u');
});

test('aliases and ipv6', () => {
  assert.equal(parseProxy('socks5h://1.1.1.1:1').type, 'socks5');
  assert.equal(parseProxy('https://1.1.1.1:443').type, 'http');
  assert.equal(parseProxy('socks4a://1.1.1.1:1').type, 'socks4');
  assert.equal(parseProxy('[::1]:1080').host, '::1');
});

test('errors', () => {
  assert.throws(() => parseProxy(''));
  assert.throws(() => parseProxy('1.2.3.4'));
  assert.throws(() => parseProxy('1.2.3.4:99999'));
  assert.throws(() => parseProxy('ftp://1.2.3.4:21'));
});

test('list parsing reports bad lines', () => {
  const r = parseProxyList('1.1.1.1:80\n# comment\n\nbad\nsocks5://2.2.2.2:1080');
  assert.equal(r.ok.length, 2);
  assert.equal(r.errors.length, 1);
});

test('format round trip', () => {
  const p = parseProxy('socks5://u%3A1:p%2F2@h.com:1');
  assert.deepEqual(parseProxy(formatProxy(p)), p);
});
