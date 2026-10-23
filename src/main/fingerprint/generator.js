'use strict';
const crypto = require('node:crypto');
const { GPUS, SCREENS, CPU, MEMORY, OS_LABEL, COUNTRY_LANG, LANGUAGES } = require('./data');

/**
 * A profile fingerprint. Every field can be a fixed value or "real" (keep the
 * value of this computer). Stored on the profile as profile.fingerprint.
 */
function realOs() {
  return process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux';
}

function weighted(list) {
  const total = list.reduce((s, x) => s + x[x.length - 1], 0);
  let r = crypto.randomInt(0, total);
  for (const item of list) {
    r -= item[item.length - 1];
    if (r < 0) return item;
  }
  return list[0];
}

const DEFAULT_PORTS = '3389,5900,5800,7070,6568,5938,63333,5901,5902,5903,5950,5931,5939,6039,5944,6040,5279,2112';

function randomMac() {
  const b = crypto.randomBytes(6);
  b[0] = (b[0] & 0xfe) | 0x02; // locally administered, unicast
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join(':').toUpperCase();
}

function randomFingerprint(os = realOs()) {
  if (!GPUS[os]) os = realOs();
  const [webglVendor, webglRenderer] = weighted(GPUS[os]);
  return {
    enabled: true,
    os,
    userAgent: '', // empty = automatic (matches the installed Chromium)
    screen: weighted(SCREENS[os])[0],
    cpu: weighted(CPU[os])[0],
    memory: weighted(MEMORY)[0],
    webglInfo: 'custom', // custom | real
    webglVendor,
    webglRenderer,
    canvas: 'noise', // noise | real
    webglImage: 'noise',
    webgpu: 'noise', // noise | real | block
    audio: 'noise',
    clientRects: 'noise',
    fonts: 'mask', // mask | real
    mediaDevices: 'noise', // noise | real
    timezone: 'ip', // ip | real | <IANA zone>
    language: 'ip', // ip | real | <locale>
    geolocation: 'ip', // ip | ask | block
    webrtc: 'proxy', // proxy (hide local IP) | real | disabled
    doNotTrack: false,
    portsProtection: true,
    ports: DEFAULT_PORTS,
    macAddress: randomMac(), // stored only; not exposed to web pages
    deviceName: '', // stored only
    commandSwitches: '',
    hideNameInBrowser: false,
    seed: crypto.randomInt(1, 2 ** 31 - 1),
  };
}

function realFingerprint() {
  return { ...randomFingerprint(realOs()), enabled: false };
}

// Fills in missing fields of older/partial fingerprints.
function normalize(fp) {
  if (!fp || typeof fp !== 'object') return realFingerprint();
  const base = randomFingerprint(GPUS[fp.os] ? fp.os : realOs());
  return { ...base, ...fp, seed: Number(fp.seed) || base.seed };
}

// --- User-Agent and client hints -------------------------------------------------

function userAgentFor(os, major) {
  const tail = `AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
  if (os === 'macos') return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ${tail}`;
  if (os === 'linux') return `Mozilla/5.0 (X11; Linux x86_64) ${tail}`;
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) ${tail}`;
}

// Same GREASE brand algorithm Chromium uses (components/embedder_support/user_agent_utils.cc).
function brandList(major, fullVersion) {
  const chars = [' ', '(', ':', '-', '.', '/', ')', ';', '=', '?', '_'];
  const versions = ['8', '99', '24'];
  const seed = major;
  const grease = { brand: `Not${chars[seed % chars.length]}A${chars[(seed + 1) % chars.length]}Brand`, version: versions[seed % versions.length] };
  const chromium = { brand: 'Chromium', version: String(major) };
  const order = seed % 2 === 0 ? [grease, chromium] : [chromium, grease];
  const full = order.map((b) => ({ brand: b.brand, version: b.brand === 'Chromium' ? fullVersion : `${b.version}.0.0.0` }));
  return { brands: order, fullVersionList: full };
}

function uaMetadata(os, major, fullVersion) {
  const { brands, fullVersionList } = brandList(major, fullVersion);
  const platform = OS_LABEL[os] || 'Windows';
  return {
    brands,
    fullVersionList,
    fullVersion,
    platform,
    platformVersion: os === 'macos' ? '14.6.1' : os === 'linux' ? '6.5.0' : '15.0.0',
    architecture: os === 'macos' ? 'arm' : 'x86',
    model: '',
    mobile: false,
    bitness: '64',
    wow64: false,
  };
}

function navigatorPlatform(os) {
  return os === 'macos' ? 'MacIntel' : os === 'linux' ? 'Linux x86_64' : 'Win32';
}

function acceptLanguage(locale) {
  const base = locale.split('-')[0];
  const list = [locale];
  if (base !== locale) list.push(base);
  if (!locale.startsWith('en')) list.push('en-US', 'en');
  // plain list: Chromium adds the q-values to the Accept-Language header itself
  return list.join(',');
}

/**
 * Turns a stored fingerprint into concrete values for one launch.
 *   ctx.engineVersion: '156.0.8078.48'
 *   ctx.ip: proxy/connection check result { ok, timezone, countryCode, lat, lon } or null
 * Fields that are null mean "do not override".
 */
function resolve(fp, ctx = {}) {
  fp = normalize(fp);
  if (!fp.enabled) return null;
  const m = String(ctx.engineVersion || '').match(/^\d+\.\d+\.\d+\.\d+/);
  const fullVersion = m ? m[0] : null;
  const major = fullVersion ? parseInt(fullVersion, 10) : parseInt(ctx.engineVersion, 10) || 0;
  const ip = ctx.ip && ctx.ip.ok ? ctx.ip : null;

  // UA is only overridden when it has to differ from the real browser.
  let ua = null;
  if (fp.userAgent && fp.userAgent.trim()) ua = fp.userAgent.trim();
  else if (fp.os !== realOs() && major) ua = userAgentFor(fp.os, major);

  let locale = null;
  if (fp.language === 'ip') locale = ip && ip.countryCode ? COUNTRY_LANG[ip.countryCode] || 'en-US' : null;
  else if (fp.language && fp.language !== 'real') locale = fp.language;

  let timezone = null;
  if (fp.timezone === 'ip') timezone = ip && ip.timezone ? ip.timezone : null;
  else if (fp.timezone && fp.timezone !== 'real') timezone = fp.timezone;

  let geo = null;
  if (fp.geolocation === 'ip' && ip && typeof ip.lat === 'number' && typeof ip.lon === 'number') {
    // a few hundred metres of jitter, stable per profile
    const j = ((fp.seed % 1000) / 1000 - 0.5) * 0.01;
    geo = { latitude: ip.lat + j, longitude: ip.lon - j, accuracy: 30 + (fp.seed % 70) };
  }

  const [sw, sh] = fp.screen && fp.screen !== 'real' ? fp.screen.split('x').map(Number) : [null, null];

  return {
    os: fp.os,
    userAgent: ua,
    uaMetadata: ua && major ? uaMetadata(fp.os, major, fullVersion || `${major}.0.0.0`) : null,
    platform: ua ? navigatorPlatform(fp.os) : null,
    locale,
    acceptLanguage: locale ? acceptLanguage(locale) : null,
    timezone,
    geo,
    blockGeolocation: fp.geolocation === 'block',
    hardwareConcurrency: fp.cpu && fp.cpu !== 'real' ? Number(fp.cpu) : null,
    deviceMemory: fp.memory && fp.memory !== 'real' ? Number(fp.memory) : null,
    screen: sw && sh ? { width: sw, height: sh } : null,
    webgl: fp.webglInfo === 'custom' && fp.webglRenderer ? { vendor: fp.webglVendor, renderer: fp.webglRenderer } : null,
    noise: {
      canvas: fp.canvas === 'noise',
      webgl: fp.webglImage === 'noise',
      audio: fp.audio === 'noise',
      rects: fp.clientRects === 'noise',
      fonts: fp.fonts === 'mask',
      mediaDevices: fp.mediaDevices === 'noise',
    },
    webgpuBlock: fp.webgpu === 'block',
    doNotTrack: Boolean(fp.doNotTrack),
    ports: fp.portsProtection ? parsePorts(fp.ports) : [],
    webrtc: fp.webrtc || 'proxy',
    commandSwitches: parseSwitches(fp.commandSwitches),
    hideNameInBrowser: Boolean(fp.hideNameInBrowser),
    seed: fp.seed,
  };
}

function parsePorts(value) {
  return String(value || '')
    .split(/[\s,]+/)
    .map((p) => parseInt(p, 10))
    .filter((p) => p > 0 && p < 65536);
}

function parseSwitches(value) {
  return String(value || '')
    .split(/\r?\n|\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function needsIp(fp) {
  fp = normalize(fp);
  return fp.enabled && (fp.timezone === 'ip' || fp.language === 'ip' || fp.geolocation === 'ip');
}

function meta() {
  return {
    realOs: realOs(),
    os: Object.keys(OS_LABEL).map((id) => ({ id, label: OS_LABEL[id] })),
    gpus: Object.fromEntries(Object.entries(GPUS).map(([k, v]) => [k, v.map(([vendor, renderer]) => ({ vendor, renderer }))])),
    screens: Object.fromEntries(Object.entries(SCREENS).map(([k, v]) => [k, v.map((x) => x[0])])),
    cpu: [2, 4, 6, 8, 10, 12, 16, 20, 24, 32],
    memory: [2, 4, 8],
    languages: LANGUAGES,
    countryLang: COUNTRY_LANG,
    defaultPorts: DEFAULT_PORTS,
  };
}

module.exports = { randomFingerprint, realFingerprint, normalize, resolve, needsIp, meta, realOs, userAgentFor, brandList, acceptLanguage, randomMac };
