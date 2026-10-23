'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { safeStorage } = require('electron');
const paths = require('./paths');
const log = require('./log');
const fingerprint = require('./fingerprint/generator');

const SCHEMA_VERSION = 1;

function defaultSettings() {
  return {
    language: 'en', // en | pl | ru
    theme: 'dark', // dark | light
    engine: {
      source: 'chromium', // chromium | ungoogled | custom
      customPath: '',
      installed: {}, // source -> { version, exePath, dir, installedAt }
    },
    rpc: {
      enabled: true,
      // Shared Shark{anty} Discord application, so Rich Presence works with no setup.
      clientId: '1562863712266756167',
      showNames: true,
      proxyDisplay: 'type', // type | country | hidden
      largeImage: 'logo',
      smallImage: 'small_logo',
      largeText: 'Shark{anty}',
    },
    closeToTray: true,
    confirmCloseWithProfiles: true,
    webrtcProtection: true,
    api: { enabled: false, port: 3030, token: crypto.randomBytes(24).toString('hex') },
    checkUpdates: true,
  };
}

function emptyData() {
  return { schema: SCHEMA_VERSION, settings: defaultSettings(), profiles: [], proxies: [], extensions: [] };
}

// Deep merge so new settings keys appear after an update without wiping user values.
function mergeDefaults(def, val) {
  if (Array.isArray(def)) return Array.isArray(val) ? val : def;
  if (def && typeof def === 'object') {
    const out = { ...def };
    if (val && typeof val === 'object') {
      for (const k of Object.keys(val)) out[k] = k in def ? mergeDefaults(def[k], val[k]) : val[k];
    }
    return out;
  }
  return val === undefined ? def : val;
}

// Proxy passwords are encrypted at rest with the OS keychain (DPAPI on Windows)
// whenever Electron's safeStorage is available.
let encryptionAvailable = null;
async function canEncrypt() {
  if (encryptionAvailable === null) {
    try {
      encryptionAvailable = await safeStorage.isAsyncEncryptionAvailable();
    } catch {
      encryptionAvailable = false;
    }
  }
  return encryptionAvailable;
}

async function encrypt(text) {
  if (!text) return '';
  try {
    if (await canEncrypt()) return 'enc:' + (await safeStorage.encryptStringAsync(text)).toString('base64');
  } catch {}
  return 'b64:' + Buffer.from(text, 'utf8').toString('base64');
}

async function decrypt(value) {
  if (!value) return '';
  try {
    if (value.startsWith('enc:')) return (await safeStorage.decryptStringAsync(Buffer.from(value.slice(4), 'base64'))).result;
    if (value.startsWith('b64:')) return Buffer.from(value.slice(4), 'base64').toString('utf8');
  } catch (e) {
    log.warn('Could not decrypt a stored secret', e.message);
    return '';
  }
  return value;
}

class Store extends EventEmitter {
  constructor() {
    super();
    this.data = emptyData();
    this._timer = null;
  }

  // Upgrades data written by older versions.
  _migrate() {
    const st = this.data.settings;
    if (!['en', 'pl', 'ru'].includes(st.language)) st.language = 'en';
    if (!['dark', 'light'].includes(st.theme)) st.theme = 'dark';
    if (st.engine.source === 'cft') st.engine.source = 'chromium';
    if (st.rpc.largeText === 'Shark{Anty}') st.rpc.largeText = 'Shark{anty}';
    // Everyone uses the shared Shark{anty} Discord application; not user-editable.
    st.rpc.clientId = '1562863712266756167';
    for (const e of this.data.extensions) if (e.enabled === undefined) e.enabled = true;
    // Profiles from v1.0 keep their real fingerprint until the user turns it on.
    for (const p of this.data.profiles) {
      if (!p.fingerprint) p.fingerprint = fingerprint.realFingerprint();
      delete p.extensions;
    }
  }

  async load() {
    const file = paths.dataFile();
    try {
      if (fs.existsSync(file)) {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        this.data = {
          ...emptyData(),
          ...raw,
          settings: mergeDefaults(defaultSettings(), raw.settings || {}),
        };
        this._migrate();
        this.data.proxies = await Promise.all(
          (this.data.proxies || []).map(async (p) => ({ ...p, password: await decrypt(p.password) })),
        );
      }
    } catch (e) {
      log.error('Failed to read data file, starting with a backup copy', e);
      try {
        fs.copyFileSync(file, file + '.corrupt-' + Date.now());
      } catch {}
      this.data = emptyData();
    }
    return this;
  }

  // Debounced, atomic save (write tmp, then rename) so a crash never leaves a half-written file.
  save() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), 150);
    this.emit('changed');
  }

  // Writes are serialized so two saves never race on the same temp file.
  flush() {
    clearTimeout(this._timer);
    this._writing = (this._writing || Promise.resolve()).then(() => this._write());
    return this._writing;
  }

  async _write() {
    const file = paths.dataFile();
    try {
      const proxies = await Promise.all(this.data.proxies.map(async (p) => ({ ...p, password: await encrypt(p.password) })));
      const out = { ...this.data, proxies };
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(out, null, 2), 'utf8');
      if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak');
      fs.renameSync(tmp, file);
    } catch (e) {
      log.error('Failed to save data', e);
    }
  }

  get settings() {
    return this.data.settings;
  }

  updateSettings(patch) {
    this.data.settings = mergeDefaults(this.data.settings, patch);
    this.save();
    this.emit('settings', this.data.settings);
    return this.data.settings;
  }

  // ---------- profiles ----------
  listProfiles() {
    return this.data.profiles;
  }

  getProfile(id) {
    return this.data.profiles.find((p) => p.id === id) || null;
  }

  createProfile(input = {}) {
    const now = Date.now();
    const profile = {
      id: crypto.randomUUID(),
      name: String(input.name || '').trim() || this.nextProfileName(),
      group: String(input.group || '').trim(),
      tags: normalizeTags(input.tags),
      notes: String(input.notes || ''),
      color: input.color || '',
      proxyId: input.proxyId || null,
      startUrls: normalizeUrls(input.startUrls),
      webrtc: input.webrtc || 'auto', // only used when the fingerprint is off
      fingerprint: input.fingerprint ? fingerprint.normalize(input.fingerprint) : fingerprint.randomFingerprint(),
      createdAt: now,
      updatedAt: now,
      lastLaunchAt: null,
      launchCount: 0,
    };
    this.data.profiles.unshift(profile);
    this.save();
    return profile;
  }

  updateProfile(id, patch) {
    const p = this.getProfile(id);
    if (!p) throw new Error('Profile not found');
    const allowed = ['name', 'group', 'tags', 'notes', 'color', 'proxyId', 'startUrls', 'webrtc', 'fingerprint', 'lastLaunchAt', 'launchCount'];
    for (const k of allowed) {
      if (!(k in patch)) continue;
      if (k === 'tags') p.tags = normalizeTags(patch.tags);
      else if (k === 'startUrls') p.startUrls = normalizeUrls(patch.startUrls);
      else if (k === 'name') p.name = String(patch.name || '').trim() || p.name;
      else if (k === 'fingerprint') p.fingerprint = fingerprint.normalize(patch.fingerprint);
      else p[k] = patch[k];
    }
    p.updatedAt = Date.now();
    this.save();
    return p;
  }

  deleteProfile(id) {
    this.data.profiles = this.data.profiles.filter((p) => p.id !== id);
    this.save();
  }

  nextProfileName() {
    const used = new Set(this.data.profiles.map((p) => p.name));
    let n = this.data.profiles.length + 1;
    while (used.has(`Profile ${n}`)) n++;
    return `Profile ${n}`;
  }

  // Extensions are global: every enabled extension loads in every profile.
  enabledExtensions() {
    return this.data.extensions.filter((e) => e.enabled !== false);
  }

  // ---------- proxies ----------
  listProxies() {
    return this.data.proxies;
  }

  getProxy(id) {
    return id ? this.data.proxies.find((p) => p.id === id) || null : null;
  }

  createProxy(input) {
    const proxy = {
      id: crypto.randomUUID(),
      name: String(input.name || '').trim(),
      type: input.type,
      category: input.category || 'unknown', // residential | isp | datacenter | mobile | unknown
      host: input.host,
      port: Number(input.port),
      username: input.username || '',
      password: input.password || '',
      lastCheck: null,
      createdAt: Date.now(),
    };
    if (!proxy.name) proxy.name = `${proxy.host}:${proxy.port}`;
    this.data.proxies.unshift(proxy);
    this.save();
    return proxy;
  }

  // Reuse an existing identical proxy instead of creating duplicates.
  findOrCreateProxy(input) {
    const same = this.data.proxies.find(
      (p) =>
        p.type === input.type &&
        p.host === input.host &&
        Number(p.port) === Number(input.port) &&
        (p.username || '') === (input.username || '') &&
        (p.password || '') === (input.password || ''),
    );
    return same || this.createProxy(input);
  }

  updateProxy(id, patch) {
    const p = this.getProxy(id);
    if (!p) throw new Error('Proxy not found');
    for (const k of ['name', 'type', 'category', 'host', 'port', 'username', 'password', 'lastCheck']) {
      if (k in patch) p[k] = k === 'port' ? Number(patch[k]) : patch[k];
    }
    this.save();
    return p;
  }

  deleteProxy(id) {
    this.data.proxies = this.data.proxies.filter((p) => p.id !== id);
    for (const prof of this.data.profiles) if (prof.proxyId === id) prof.proxyId = null;
    this.save();
  }

  // ---------- extensions ----------
  listExtensions() {
    return this.data.extensions;
  }

  upsertExtension(ext) {
    const i = this.data.extensions.findIndex((e) => e.id === ext.id);
    if (i >= 0) this.data.extensions[i] = { ...this.data.extensions[i], ...ext };
    else this.data.extensions.push(ext);
    this.save();
  }

  removeExtension(id) {
    this.data.extensions = this.data.extensions.filter((e) => e.id !== id);
    this.save();
  }
}

function normalizeTags(tags) {
  if (typeof tags === 'string') tags = tags.split(',');
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags.map((t) => String(t).trim()).filter(Boolean))].slice(0, 20);
}

function normalizeUrls(urls) {
  if (typeof urls === 'string') urls = urls.split(/\r?\n|,/);
  if (!Array.isArray(urls)) return [];
  return urls
    .map((u) => String(u).trim())
    .filter(Boolean)
    .map((u) => (/^[a-z][a-z0-9+.-]*:/i.test(u) ? u : 'https://' + u))
    .slice(0, 20);
}

module.exports = new Store();
module.exports.Store = Store;
