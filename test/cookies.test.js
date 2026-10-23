'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('../src/main/cookies/formats');

const cookieEditor = JSON.stringify([
  { domain: '.example.com', expirationDate: 1900000000.5, hostOnly: false, httpOnly: true, name: 'sid', path: '/', sameSite: 'no_restriction', secure: true, session: false, value: 'abc' },
  { domain: 'www.example.com', hostOnly: true, httpOnly: false, name: 'pref', path: '/x', sameSite: 'lax', secure: false, session: true, value: 'v=1;2' },
]);

test('parses Cookie-Editor JSON', () => {
  const c = f.parseCookies(cookieEditor);
  assert.equal(c.length, 2);
  assert.equal(c[0].sameSite, 'None');
  assert.equal(c[0].hostOnly, false);
  assert.equal(c[1].expires, -1);
  assert.equal(c[1].hostOnly, true);
});

test('CDP params: host-only uses url, domain cookie uses dotted domain', () => {
  const [a, b] = f.parseCookies(cookieEditor).map(f.toCdpParam);
  assert.equal(a.domain, '.example.com');
  assert.equal(a.expires, 1900000000);
  assert.equal(b.url, 'http://www.example.com/x');
  assert.equal(b.domain, undefined);
});

test('SameSite=None forces secure', () => {
  const [p] = f.parseCookies('[{"domain":"a.com","name":"x","value":"1","sameSite":"None"}]').map(f.toCdpParam);
  assert.equal(p.secure, true);
});

test('milliseconds expiry (Puppeteer/other tools) is converted', () => {
  const [c] = f.parseCookies('[{"domain":".a.com","name":"x","value":"1","expires":1900000000000}]');
  assert.equal(Math.round(c.expires), 1900000000);
});

test('Netscape round trip', () => {
  const txt = '# Netscape HTTP Cookie File\n#HttpOnly_.example.com\tTRUE\t/\tTRUE\t1900000000\tsid\tabc\nexample.org\tFALSE\t/p\tFALSE\t0\tk\tv\twith tab\n';
  const c = f.parseCookies(txt);
  assert.equal(c.length, 2);
  assert.equal(c[0].httpOnly, true);
  assert.equal(c[1].value, 'v\twith tab');
  assert.equal(c[1].hostOnly, true);
  const again = f.parseCookies(f.toNetscape(c));
  assert.deepEqual(again, c);
});

test('JSON export round trip', () => {
  const c = f.parseCookies(cookieEditor);
  assert.deepEqual(f.parseCookies(f.toJson(c)), c);
});

test('fromCdp and domain filter', () => {
  const list = [
    { name: 'a', value: '1', domain: '.vinted.pl', path: '/', expires: -1, session: true, httpOnly: false, secure: true },
    { name: 'b', value: '2', domain: 'www.vinted.pl', path: '/', expires: 1900000000, session: false, httpOnly: true, secure: true },
    { name: 'c', value: '3', domain: 'google.com', path: '/', expires: -1, session: true, httpOnly: false, secure: false },
  ].map(f.fromCdp);
  assert.equal(f.filterByDomain(list, 'vinted.pl').length, 2);
  assert.equal(f.filterByDomain(list, '').length, 3);
});

test('rejects garbage', () => {
  assert.throws(() => f.parseCookies('hello world'));
  assert.throws(() => f.parseCookies('{"foo":1}'));
});
