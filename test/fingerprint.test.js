'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const g = require('../src/main/fingerprint/generator');
const { pageScript, workerScript } = require('../src/main/fingerprint/inject');

test('random fingerprint is complete and uses real-world values', () => {
  for (const os of ['windows', 'macos', 'linux']) {
    const fp = g.randomFingerprint(os);
    assert.equal(fp.os, os);
    assert.equal(fp.enabled, true);
    assert.match(fp.screen, /^\d+x\d+$/);
    assert.ok(fp.cpu > 0 && fp.memory > 0 && fp.seed > 0);
    assert.match(fp.webglRenderer, /^ANGLE \(/);
  }
});

test('brand list matches what real Chromium reports', () => {
  // values read from Chromium 155 and 156 during testing
  assert.deepEqual(g.brandList(155, '155.0.8059.84').brands.map((b) => `${b.brand}/${b.version}`), ['Chromium/155', 'Not(A:Brand/24']);
  assert.deepEqual(g.brandList(156, '156.0.8078.48').brands.map((b) => `${b.brand}/${b.version}`), ['Not:A-Brand/8', 'Chromium/156']);
});

test('UA is only overridden for a different OS or a custom value', () => {
  const real = g.realOs();
  const same = g.resolve({ ...g.randomFingerprint(real) }, { engineVersion: '156.0.8078.48' });
  assert.equal(same.userAgent, null);
  const other = real === 'macos' ? 'windows' : 'macos';
  const diff = g.resolve({ ...g.randomFingerprint(other) }, { engineVersion: '156.0.8078.48' });
  assert.match(diff.userAgent, /Chrome\/156\.0\.0\.0/);
  assert.equal(diff.uaMetadata.fullVersion, '156.0.8078.48');
});

test('timezone, language and geolocation follow the proxy IP', () => {
  const fp = g.randomFingerprint('windows');
  const r = g.resolve(fp, { engineVersion: '156.0.8078.48', ip: { ok: true, timezone: 'Europe/Berlin', countryCode: 'DE', lat: 52.5, lon: 13.4 } });
  assert.equal(r.timezone, 'Europe/Berlin');
  assert.equal(r.locale, 'de-DE');
  assert.equal(r.acceptLanguage, 'de-DE,de,en-US,en');
  assert.ok(Math.abs(r.geo.latitude - 52.5) < 0.01);
  const noIp = g.resolve(fp, { engineVersion: '156.0.8078.48', ip: null });
  assert.equal(noIp.timezone, null);
  assert.equal(noIp.locale, null);
});

test('disabled fingerprint resolves to nothing; "real" fields are not overridden', () => {
  assert.equal(g.resolve({ ...g.randomFingerprint(), enabled: false }), null);
  const r = g.resolve({ ...g.randomFingerprint(), screen: 'real', cpu: 'real', memory: 'real', webglInfo: 'real', timezone: 'real', language: 'real' });
  assert.equal(r.screen, null);
  assert.equal(r.hardwareConcurrency, null);
  assert.equal(r.deviceMemory, null);
  assert.equal(r.webgl, null);
  assert.equal(r.timezone, null);
  assert.equal(r.locale, null);
});

test('injected scripts are valid JavaScript', () => {
  const r = g.resolve(g.randomFingerprint(), { engineVersion: '156.0.8078.48' });
  assert.doesNotThrow(() => new Function(pageScript(r)));
  assert.doesNotThrow(() => new Function(workerScript(r)));
});
