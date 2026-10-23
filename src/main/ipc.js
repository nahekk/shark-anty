'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ipcMain, dialog, shell, app, BrowserWindow, clipboard } = require('electron');
const store = require('./store');
const paths = require('./paths');
const launcher = require('./browser/launcher');
const engines = require('./browser/engines');
const extensions = require('./browser/extensions');
const cookies = require('./cookies/service');
const presence = require('./rpc/presence');
const localApi = require('./api/local-api');
const updater = require('./updater');
const { parseProxy, parseProxyList, validateProxy } = require('./proxy/parse');
const { checkProxy } = require('./proxy/checker');
const log = require('./log');
const fingerprint = require('./fingerprint/generator');

const THEME_COLORS = {
  dark: { color: '#121212', symbolColor: '#a0a0a0' },
  light: { color: '#f4f5f7', symbolColor: '#3c414a' },
};

function broadcast(channel, payload) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

// Wraps handlers so the renderer always gets { ok, data } / { ok:false, error }.
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (e) {
      log.warn(`[ipc ${channel}]`, e.message);
      return { ok: false, error: e.message, code: e.code };
    }
  });
}

function snapshot() {
  return {
    profiles: store.listProfiles(),
    proxies: store.listProxies(),
    extensions: store.listExtensions(),
    settings: store.settings,
    running: launcher.list(),
    engine: engines.status(),
    rpc: presence.status,
  };
}

// Resolves the proxy part of the profile editor form into a proxyId.
function resolveProxy(input) {
  const p = input && input.proxy;
  if (!p || p.mode === 'none') return null;
  if (p.mode === 'saved') {
    if (!store.getProxy(p.proxyId)) throw new Error('Selected proxy no longer exists');
    return p.proxyId;
  }
  if (p.mode === 'new') {
    const data = p.raw ? parseProxy(p.raw, p.type || 'http') : validateProxy(p);
    const created = store.findOrCreateProxy({ ...data, name: p.name });
    if (p.lastCheck) store.updateProxy(created.id, { lastCheck: p.lastCheck });
    return created.id;
  }
  return null;
}

function register(getWindow) {
  // Push live updates to the UI
  launcher.on('changed', (running) => broadcast('state:running', running));
  engines.on('progress', (p) => broadcast('engine:progress', p));
  engines.on('installed', () => broadcast('state:changed', snapshot()));
  engines.on('update', (u) => broadcast('engine:update', u));
  presence.on('status', (s) => broadcast('rpc:status', s));

  handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    dataDir: paths.root(),
    locale: app.getLocale(),
    website: require('./config').WEBSITE,
  }));
  handle('state:get', () => snapshot());

  // ---------------- profiles ----------------
  handle('profiles:create', (input) => {
    const proxyId = resolveProxy(input);
    return store.createProfile({ ...input, proxyId });
  });

  handle('profiles:update', (id, input) => {
    const patch = { ...input };
    if (input.proxy) patch.proxyId = resolveProxy(input);
    delete patch.proxy;
    return store.updateProfile(id, patch);
  });

  handle('profiles:bulkCreate', ({ count, prefix, group, tags, proxyType, proxies: proxyText, startUrls }) => {
    const n = Math.max(1, Math.min(500, Number(count) || 1));
    const list = proxyText ? parseProxyList(proxyText, proxyType || 'http') : { ok: [], errors: [] };
    if (list.errors.length) throw new Error(`Invalid proxy: ${list.errors[0].line}`);
    const proxyIds = list.ok.map((p) => store.findOrCreateProxy(p).id);
    const created = [];
    const base = String(prefix || 'Profile').trim();
    const used = new Set(store.listProfiles().map((p) => p.name));
    let k = 1;
    for (let i = 0; i < n; i++) {
      while (used.has(`${base} ${k}`)) k++;
      const name = `${base} ${k}`;
      used.add(name);
      created.push(
        store.createProfile({
          name,
          group,
          tags,
          startUrls,
          proxyId: proxyIds.length ? proxyIds[i % proxyIds.length] : null,
        }),
      );
    }
    return created.length;
  });

  handle('profiles:clone', async (id, withData) => {
    const src = store.getProfile(id);
    if (!src) throw new Error('Profile not found');
    if (withData && launcher.isRunning(id)) throw new Error('Close the profile before cloning it with its data');
    const copy = store.createProfile({ ...src, name: `${src.name} (copy)` });
    if (withData) {
      const from = paths.profileDir(id);
      if (fs.existsSync(from)) {
        await fs.promises.cp(from, paths.profileDir(copy.id), {
          recursive: true,
          filter: (f) => !/(lockfile|DevToolsActivePort|shark-runtime\.json|Singleton\w*)$/.test(f),
        });
      }
    }
    return copy;
  });

  handle('profiles:delete', async (ids) => {
    for (const id of [].concat(ids)) {
      await launcher.stop(id).catch(() => {});
      store.deleteProfile(id);
      const dir = paths.profileDir(id);
      for (let i = 0; i < 5; i++) {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 400));
        }
      }
    }
    return true;
  });

  handle('profiles:start', (id) => launcher.start(id));
  handle('profiles:stop', (id) => launcher.stop(id));
  handle('profiles:stopAll', () => launcher.stopAll());
  handle('profiles:openFolder', (id) => {
    const dir = paths.profileDir(id);
    fs.mkdirSync(dir, { recursive: true });
    return shell.openPath(dir);
  });

  // ---------------- cookies ----------------
  handle('cookies:export', (id, opts) => cookies.exportCookies(id, opts));
  handle('cookies:import', (id, text, opts) => cookies.importCookies(id, text, opts));
  handle('cookies:clear', (id) => cookies.clearCookies(id));
  handle('cookies:saveFile', async (text, defaultName) => {
    const r = await dialog.showSaveDialog(getWindow(), {
      defaultPath: defaultName,
      filters: defaultName.endsWith('.txt')
        ? [{ name: 'Netscape cookies.txt', extensions: ['txt'] }]
        : [{ name: 'JSON', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, text, 'utf8');
    return r.filePath;
  });
  handle('cookies:openFile', async () => {
    const r = await dialog.showOpenDialog(getWindow(), {
      properties: ['openFile'],
      filters: [
        { name: 'Cookies (JSON / cookies.txt)', extensions: ['json', 'txt'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const stat = fs.statSync(r.filePaths[0]);
    if (stat.size > 50 * 1024 * 1024) throw new Error('File is too large');
    return { name: path.basename(r.filePaths[0]), text: fs.readFileSync(r.filePaths[0], 'utf8') };
  });

  // ---------------- proxies ----------------
  handle('proxies:create', (input) => {
    const data = input.raw ? parseProxy(input.raw, input.type || 'http') : validateProxy(input);
    return store.createProxy({ ...data, name: input.name, category: input.category });
  });
  handle('proxies:update', (id, input) => {
    const data = input.raw ? parseProxy(input.raw, input.type || 'http') : validateProxy(input);
    return store.updateProxy(id, { ...data, name: input.name || `${data.host}:${data.port}`, category: input.category });
  });
  handle('proxies:delete', (ids) => {
    for (const id of [].concat(ids)) store.deleteProxy(id);
    return true;
  });
  handle('proxies:setCategory', (id, category) => store.updateProxy(id, { category }));
  handle('proxies:parse', (text, type) => parseProxy(text, type || 'http'));
  handle('proxies:import', (text, type) => {
    const { ok, errors } = parseProxyList(text, type || 'http');
    const before = store.listProxies().length;
    for (const p of ok) store.findOrCreateProxy(p);
    return { added: store.listProxies().length - before, duplicates: ok.length - (store.listProxies().length - before), errors };
  });
  // Paste a proxy URI: parse it, save it (reusing an identical one) and check it.
  // Returns { proxy, check }. The proxy's category comes from the check.
  handle('proxies:add', async (raw, type) => {
    const data = parseProxy(raw, type || 'http');
    const proxy = store.findOrCreateProxy(data);
    const check = await checkProxy(proxy);
    store.updateProxy(proxy.id, { lastCheck: check, category: check.ok && check.category ? check.category : proxy.category });
    return { proxy: store.getProxy(proxy.id), check };
  });
  // Check a saved proxy (by id) or an unsaved one from the form.
  handle('proxies:check', async (idOrProxy) => {
    let proxy;
    if (typeof idOrProxy === 'string') proxy = store.getProxy(idOrProxy);
    else if (idOrProxy && idOrProxy.raw) proxy = parseProxy(idOrProxy.raw, idOrProxy.type || 'http');
    else proxy = idOrProxy ? validateProxy(idOrProxy) : null;
    const result = await checkProxy(proxy);
    if (typeof idOrProxy === 'string' && proxy) {
      store.updateProxy(proxy.id, { lastCheck: result, category: result.ok && result.category ? result.category : proxy.category });
    }
    return result;
  });

  // ---------------- extensions ----------------
  handle('extensions:addWebStore', (input) => extensions.addFromWebStore(input));
  handle('extensions:addFolder', async () => {
    const r = await dialog.showOpenDialog(getWindow(), { properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    return extensions.addFromFolder(r.filePaths[0]);
  });
  handle('extensions:addCrx', async () => {
    const r = await dialog.showOpenDialog(getWindow(), {
      properties: ['openFile'],
      filters: [{ name: 'Chrome extension', extensions: ['crx', 'zip'] }],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    return extensions.addFromCrxFile(r.filePaths[0]);
  });
  handle('extensions:remove', (id) => extensions.remove(id));
  handle('extensions:update', (id) => extensions.update(id));
  handle('extensions:setEnabled', (id, value) => {
    const ext = store.listExtensions().find((e) => e.id === id);
    if (!ext) throw new Error('Extension not found');
    store.upsertExtension({ ...ext, enabled: Boolean(value) });
    return true;
  });

  // ---------------- fingerprint ----------------
  handle('fingerprint:random', (os) => fingerprint.randomFingerprint(os));
  handle('fingerprint:meta', () => fingerprint.meta());
  handle('fingerprint:preview', (fp, proxyInput) => {
    // what the profile will report, for the overview panel
    const r = fingerprint.resolve({ ...fp, enabled: true }, { engineVersion: engines.status().version, ip: proxyInput && proxyInput.lastCheck });
    return { ...r, userAgent: r.userAgent || null, engineVersion: engines.status().version };
  });

  // ---------------- engine ----------------
  handle('engine:status', () => engines.status());
  handle('engine:install', (source) => engines.install(source || engines.status().source));
  handle('engine:checkUpdate', () => engines.checkUpdate());
  handle('engine:setSource', (source) => {
    store.updateSettings({ engine: { source } });
    return engines.status();
  });
  handle('engine:pickCustom', async () => {
    const r = await dialog.showOpenDialog(getWindow(), {
      properties: ['openFile'],
      filters: process.platform === 'win32' ? [{ name: 'Chromium executable', extensions: ['exe'] }] : [],
    });
    if (r.canceled || !r.filePaths[0]) return engines.status();
    store.updateSettings({ engine: { source: 'custom', customPath: r.filePaths[0] } });
    return engines.status();
  });

  // ---------------- settings / app ----------------
  handle('settings:update', (patch) => {
    const before = JSON.stringify(store.settings.api);
    const s = store.updateSettings(patch);
    if (JSON.stringify(s.api) !== before) localApi.start();
    return s;
  });
  handle('api:regenerateToken', () => {
    const s = store.updateSettings({ api: { token: crypto.randomBytes(24).toString('hex') } });
    localApi.start();
    return s;
  });
  handle('app:checkUpdate', () => updater.checkForUpdate());
  handle('app:openExternal', (url) => {
    if (!/^https:\/\//i.test(String(url))) throw new Error('Only https links can be opened');
    return shell.openExternal(url);
  });
  handle('app:openDataFolder', () => shell.openPath(paths.root()));
  handle('app:setTheme', (theme) => {
    const w = getWindow();
    const c = THEME_COLORS[theme === 'light' ? 'light' : 'dark'];
    if (w && !w.isDestroyed()) {
      w.setBackgroundColor(c.color);
      if (process.platform !== 'darwin') w.setTitleBarOverlay(c);
    }
    return true;
  });
  handle('app:copy', (text) => clipboard.writeText(String(text)));

  // ---------------- Discord RPC ----------------
  handle('rpc:preview', () => {
    const { payload } = presence.buildPresence();
    return { details: payload.details, state: payload.state, startedAt: presence.startTs * 1000 };
  });
  handle('rpc:openAssets', () => {
    const base = app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked') : path.join(__dirname, '..', '..');
    return shell.openPath(path.join(base, 'assets', 'discord'));
  });
}

module.exports = { register, snapshot, broadcast, THEME_COLORS };
