'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { EventEmitter } = require('node:events');
const paths = require('../paths');
const store = require('../store');
const engines = require('./engines');
const log = require('../log');
const { ProxyBridge } = require('../proxy/bridge');
const { CDPClient, readActivePort, waitForActivePort } = require('./cdp');
const fingerprint = require('../fingerprint/generator');
const { FingerprintController } = require('../fingerprint/controller');
const { checkProxy } = require('../proxy/checker');
const taskbar = require('./taskbar');

// Fixed id of the built-in Shark Cookies extension (from its manifest "key").
const SHARK_EXT_ID = 'mfbfmeppdflmbophkokggbbglmjlcgdh';

/**
 * Starts/stops Chromium for each profile. Every profile gets its own
 * --user-data-dir, so cookies, storage, history and extensions are fully
 * isolated. Optional per-profile fingerprints are applied by FingerprintController.
 */
class Launcher extends EventEmitter {
  constructor() {
    super();
    this.running = new Map(); // id -> entry
  }

  isRunning(id) {
    return this.running.has(id);
  }

  get(id) {
    return this.running.get(id) || null;
  }

  // Public, serialisable status list for the UI / RPC / API.
  list() {
    return [...this.running.values()].map((e) => ({
      id: e.id,
      state: e.state,
      pid: e.pid || null,
      startedAt: e.startedAt,
      debugPort: e.debugPort || null,
      wsEndpoint: e.wsUrl || null,
      headless: Boolean(e.headless),
      error: e.error || null,
    }));
  }

  visibleCount() {
    return [...this.running.values()].filter((e) => !e.headless).length;
  }

  _changed() {
    this.emit('changed', this.list());
  }

  async start(id, opts = {}) {
    const profile = store.getProfile(id);
    if (!profile) throw new Error('Profile not found');
    if (this.running.has(id)) {
      const e = this.running.get(id);
      if (e.headless && !opts.headless) throw new Error('Profile is busy (cookie operation in progress)');
      if (!opts.headless) this._focus(e).catch(() => {});
      return this._publicEntry(e);
    }

    const exe = engines.executable();
    const dir = paths.profileDir(id);
    fs.mkdirSync(dir, { recursive: true });

    if (isLocked(dir)) {
      throw new Error('This profile is already open in another browser window/process. Close it first.');
    }

    const entry = {
      id,
      state: 'starting',
      startedAt: Date.now(),
      headless: Boolean(opts.headless),
      proc: null,
      pid: null,
      bridge: null,
      debugPort: null,
      wsUrl: null,
      monitor: null,
      error: null,
    };
    this.running.set(id, entry);
    this._changed();

    try {
      const proxy = store.getProxy(profile.proxyId);
      const fp = fingerprint.normalize(profile.fingerprint);
      const useFp = fp.enabled && !opts.headless;

      // Timezone / language / geolocation "from IP" need the exit IP of the proxy.
      let ip = proxy ? proxy.lastCheck : null;
      if (useFp && proxy && fingerprint.needsIp(fp)) {
        ip = await checkProxy(proxy, 12000);
        store.updateProxy(proxy.id, { lastCheck: ip });
        if (!ip.ok) throw new Error(`Proxy is not working: ${ip.error}`);
      }
      const resolved = useFp ? fingerprint.resolve(fp, { engineVersion: engines.status().version, ip }) : null;
      entry.fingerprint = resolved;

      // WebRTC: with a fingerprint use its setting, otherwise the v1.0 behaviour.
      let webrtcPolicy = null;
      if (resolved) {
        if (resolved.webrtc === 'disabled') webrtcPolicy = 'disable_non_proxied_udp';
        else if (resolved.webrtc === 'proxy') webrtcPolicy = proxy ? 'disable_non_proxied_udp' : 'default_public_interface_only';
      } else if (profile.webrtc === 'proxy' || (profile.webrtc !== 'real' && proxy && store.settings.webrtcProtection)) {
        webrtcPolicy = 'disable_non_proxied_udp';
      }
      prepareProfileDir(dir, profile, {
        webrtcPolicy,
        acceptLanguage: resolved && resolved.acceptLanguage,
        blockGeo: resolved && resolved.blockGeolocation,
      });
      // Chrome shows this name in its own profile button, next to the address bar.
      writeLocalState(dir, profile.name);

      // navigator.webdriver (set because of the DevTools port) is hidden by the
      // injected script instead of the --disable-blink-features flag, which Chromium
      // shows a yellow "unsupported flag" warning bar for.
      const args = [
        `--user-data-dir=${dir}`,
        '--remote-debugging-port=0',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-features=DisableLoadExtensionCommandLineSwitch,Translate',
        '--no-service-autorun',
        '--password-store=basic',
        '--profile-directory=Default',
        `--window-name=${profile.name}`,
      ];

      if (proxy) {
        entry.bridge = new ProxyBridge(proxy, profile.name);
        const port = await entry.bridge.start();
        args.push(`--proxy-server=http://127.0.0.1:${port}`);
        args.push('--proxy-bypass-list=<-loopback>');
      }
      if (webrtcPolicy) args.push(`--force-webrtc-ip-handling-policy=${webrtcPolicy}`);
      // Extra switches typed by the user in the profile's advanced settings.
      for (const sw of resolved && resolved.commandSwitches ? resolved.commandSwitches : []) {
        if (/^--[a-z0-9-]+(=.*)?$/i.test(sw)) args.push(sw);
      }
      if (resolved && resolved.locale) args.push(`--lang=${resolved.locale}`);
      if (resolved && resolved.screen) {
        // keep the window smaller than the reported screen, like on a real computer
        const work = screenWorkArea();
        const w = Math.min(resolved.screen.width, work.width) - 60;
        const h = Math.min(resolved.screen.height - 40, work.height) - 40;
        args.push(`--window-size=${Math.max(800, w)},${Math.max(600, h)}`);
      }

      if (opts.headless) {
        args.push('--headless=new', '--mute-audio');
        args.push('about:blank');
      } else {
        const exts = [paths.builtinExtension()];
        for (const ext of store.enabledExtensions()) if (ext.path && fs.existsSync(ext.path)) exts.push(ext.path);
        args.push(`--load-extension=${exts.join(',')}`);
        // With a fingerprint the start pages are opened after the overrides are ready.
        if (!resolved) args.push(...(profile.startUrls || []));
      }

      try {
        fs.rmSync(path.join(dir, 'DevToolsActivePort'), { force: true });
      } catch {}

      log.info(`Starting profile "${profile.name}" (${id})${opts.headless ? ' [headless]' : ''}${proxy ? ` via ${proxy.type}` : ''}${resolved ? ' [fingerprint]' : ''}`);
      // Detached: if Shark{anty} itself crashes, open browsers keep running and are
      // re-attached on the next start (see adoptOrphans). Normal quit closes them.
      const proc = spawn(exe, args, { env: process.env, stdio: 'ignore', detached: !opts.headless, windowsHide: Boolean(opts.headless) });
      entry.proc = proc;
      entry.pid = proc.pid;

      let exited = false;
      proc.once('error', (e) => {
        exited = true;
        entry.error = e.message;
        log.error(`Profile ${id} process error`, e);
      });
      proc.once('exit', (code) => {
        exited = true;
        log.info(`Profile "${profile.name}" exited (code ${code})`);
        this._cleanup(id, entry);
      });

      const active = await waitForActivePort(dir, () => !exited);
      entry.debugPort = active.port;
      entry.wsUrl = active.wsUrl;

      if (resolved) {
        entry.controller = new FingerprintController(active.wsUrl, resolved, profile.name);
        await entry.controller.start();
        await entry.controller.openUrls(profile.startUrls);
      }
      entry.state = 'running';

      // Blue per-profile taskbar icon (a helper process keeps it applied).
      if (!opts.headless) entry.iconProc = await taskbar.apply(entry.pid, profile).catch(() => null);
      // Show the profile name on the Shark Cookies toolbar button.
      const fpCfg = fingerprint.normalize(profile.fingerprint);
      if (!opts.headless && !(fpCfg.enabled && fpCfg.hideNameInBrowser)) this._labelProfile(active.wsUrl, profile.name).catch(() => {});

      fs.writeFileSync(
        path.join(dir, 'shark-runtime.json'),
        JSON.stringify({ pid: entry.pid, bridgePort: entry.bridge ? entry.bridge.port : null, startedAt: entry.startedAt }),
      );

      if (!opts.headless) {
        store.updateProfile(id, { lastLaunchAt: Date.now(), launchCount: (profile.launchCount || 0) + 1 });
      }
      this._changed();
      return this._publicEntry(entry);
    } catch (e) {
      entry.error = e.message;
      await this._kill(entry);
      this._cleanup(id, entry);
      throw e;
    }
  }

  _publicEntry(e) {
    return { id: e.id, state: e.state, pid: e.pid, debugPort: e.debugPort, wsEndpoint: e.wsUrl, headless: e.headless };
  }

  async stop(id) {
    const entry = this.running.get(id);
    if (!entry) return;
    if (entry.state === 'stopping') return entry.stopPromise;
    entry.state = 'stopping';
    this._changed();
    entry.stopPromise = (async () => {
      // Graceful close first so cookies and session are flushed to disk.
      if (entry.wsUrl) {
        try {
          const cdp = await CDPClient.connect(entry.wsUrl, 3000);
          await cdp.send('Browser.close', {}, undefined, 3000).catch(() => {});
          cdp.close();
        } catch {}
      }
      const exited = await waitUntil(() => !this.running.has(id) || !isPidAlive(entry.pid), 8000);
      if (!exited) {
        log.warn(`Profile ${id} did not close in time, killing`);
        await this._kill(entry);
      }
      this._cleanup(id, entry);
    })();
    return entry.stopPromise;
  }

  async stopAll() {
    await Promise.all([...this.running.keys()].map((id) => this.stop(id).catch(() => {})));
  }

  async _kill(entry) {
    if (!entry.pid) return;
    if (process.platform === 'win32') {
      await new Promise((r) => execFile('taskkill', ['/PID', String(entry.pid), '/T', '/F'], () => r()));
    } else {
      try {
        process.kill(entry.pid, 'SIGKILL');
      } catch {}
    }
  }

  _cleanup(id, entry) {
    const cur = this.running.get(id);
    if (cur !== entry) return;
    this.running.delete(id);
    if (entry.bridge) entry.bridge.stop().catch(() => {});
    if (entry.monitor) entry.monitor.close();
    if (entry.controller) entry.controller.close();
    if (entry.iconProc) taskbar.stop(entry.iconProc);
    try {
      fs.rmSync(path.join(paths.profileDir(id), 'shark-runtime.json'), { force: true });
    } catch {}
    this._changed();
  }

  async _focus(entry) {
    if (!entry.wsUrl) return;
    const cdp = await CDPClient.connect(entry.wsUrl, 3000);
    try {
      const { targetInfos } = await cdp.send('Target.getTargets');
      const page = targetInfos.find((t) => t.type === 'page');
      if (page) await cdp.send('Target.activateTarget', { targetId: page.targetId });
      else await cdp.send('Target.createTarget', { url: 'about:blank', newWindow: true });
    } finally {
      cdp.close();
    }
  }

  // Tells the built-in Shark Cookies extension which profile this window is, so
  // its toolbar button shows the name.
  async _labelProfile(wsUrl, name) {
    let cdp;
    try {
      cdp = await CDPClient.connect(wsUrl, 4000);
      for (let attempt = 0; attempt < 12; attempt++) {
        const { targetInfos } = await cdp.send('Target.getTargets');
        // Several extensions have a background.js, so confirm by manifest name.
        const workers = targetInfos.filter((t) => t.type === 'service_worker' && t.url.startsWith('chrome-extension://'));
        let labelled = false;
        for (const sw of workers) {
          const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: sw.targetId, flatten: true });
          const r = await cdp
            .send('Runtime.evaluate', { expression: 'chrome.runtime.getManifest().name', returnByValue: true }, sessionId)
            .catch(() => null);
          if (r && r.result && r.result.value === 'Shark Cookies') {
            await cdp.send('Runtime.evaluate', { expression: `(self.__sharkSetProfile||(()=>{}))(${JSON.stringify(name)})` }, sessionId).catch(() => {});
            labelled = true;
            break;
          }
        }
        if (labelled) break;
        await new Promise((r) => setTimeout(r, 500));
      }
    } catch {
    } finally {
      if (cdp) cdp.close();
    }
  }

  /** Opens a CDP connection to a running profile (caller must close it). */
  async connect(id) {
    const entry = this.running.get(id);
    if (!entry || !entry.wsUrl) throw new Error('Profile is not running');
    return CDPClient.connect(entry.wsUrl);
  }

  /**
   * After a crash of the manager, browsers may still be open. Re-attach to them
   * (and restart their proxy bridge on the same port) so they keep working.
   */
  async adoptOrphans() {
    for (const profile of store.listProfiles()) {
      const dir = paths.profileDir(profile.id);
      const rtFile = path.join(dir, 'shark-runtime.json');
      if (!fs.existsSync(rtFile)) continue;
      let rt;
      try {
        rt = JSON.parse(fs.readFileSync(rtFile, 'utf8'));
      } catch {
        continue;
      }
      const active = readActivePort(dir);
      if (!active || !isPidAlive(rt.pid)) {
        fs.rmSync(rtFile, { force: true });
        continue;
      }
      try {
        const monitor = await CDPClient.connect(active.wsUrl, 2000);
        const entry = {
          id: profile.id,
          state: 'running',
          startedAt: rt.startedAt || Date.now(),
          headless: false,
          pid: rt.pid,
          proc: null,
          bridge: null,
          debugPort: active.port,
          wsUrl: active.wsUrl,
          monitor,
          error: null,
        };
        const proxy = store.getProxy(profile.proxyId);
        if (proxy && rt.bridgePort) {
          entry.bridge = new ProxyBridge(proxy, profile.name);
          await listenOnPort(entry.bridge, rt.bridgePort).catch((e) =>
            log.warn(`Could not restore proxy bridge for ${profile.name}: ${e.message}`),
          );
        }
        // Overrides die with the old DevTools connection; apply them again.
        const fp = fingerprint.normalize(profile.fingerprint);
        if (fp.enabled) {
          const resolved = fingerprint.resolve(fp, { engineVersion: engines.status().version, ip: proxy ? proxy.lastCheck : null });
          entry.controller = new FingerprintController(active.wsUrl, resolved, profile.name);
          await entry.controller.start().catch((e) => log.warn(`Fingerprint re-attach failed: ${e.message}`));
        }
        monitor.onClose = () => this._cleanup(profile.id, entry);
        this.running.set(profile.id, entry);
        log.info(`Re-attached to running profile "${profile.name}"`);
      } catch {
        fs.rmSync(rtFile, { force: true });
      }
    }
    this._changed();
  }
}

// Restart a bridge on a fixed port (used when re-attaching to orphaned browsers).
function listenOnPort(bridge, port) {
  const http = require('node:http');
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => bridge._onRequest(req, res));
    server.on('connect', (req, s, head) => bridge._onConnect(req, s, head));
    server.on('connection', (s) => {
      bridge.sockets.add(s);
      s.on('close', () => bridge.sockets.delete(s));
    });
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      bridge.server = server;
      bridge.port = port;
      resolve(port);
    });
  });
}

/**
 * Seeds/patches Default/Preferences before each launch:
 * - marks the last exit as clean (no "Restore pages?" bubble after a kill)
 * - WebRTC: only use the proxied route when protection is on (prevents IP leaks)
 */
function prepareProfileDir(dir, profile, opts = {}) {
  const defDir = path.join(dir, 'Default');
  fs.mkdirSync(defDir, { recursive: true });
  const prefFile = path.join(defDir, 'Preferences');
  let prefs = {};
  try {
    prefs = JSON.parse(fs.readFileSync(prefFile, 'utf8'));
  } catch {}
  prefs.profile = { ...(prefs.profile || {}), exit_type: 'Normal', exited_cleanly: true, name: profile.name };
  prefs.browser = { ...(prefs.browser || {}), has_seen_welcome_page: true, check_default_browser: false };
  // Turn off the Google sign-in promo pill in the toolbar.
  prefs.signin = { ...(prefs.signin || {}), allowed: false, allowed_on_next_startup: false };
  prefs.sync_promo = { ...(prefs.sync_promo || {}), show_on_first_run_allowed: false };
  // Pin the Shark Cookies button to the toolbar so the profile name (on its
  // badge and tooltip) sits next to the extensions, on the right.
  prefs.extensions = prefs.extensions || {};
  const pinned = new Set(prefs.extensions.pinned_extensions || []);
  pinned.add(SHARK_EXT_ID);
  prefs.extensions.pinned_extensions = [...pinned];
  prefs.webrtc = { ...(prefs.webrtc || {}) };
  if (opts.webrtcPolicy) prefs.webrtc.ip_handling_policy = opts.webrtcPolicy;
  else delete prefs.webrtc.ip_handling_policy;
  if (opts.acceptLanguage) {
    const langs = opts.acceptLanguage.split(',').map((l) => l.split(';')[0]).join(',');
    prefs.intl = { ...(prefs.intl || {}), accept_languages: langs, selected_languages: langs };
  }
  const cs = (prefs.profile.default_content_setting_values = { ...(prefs.profile.default_content_setting_values || {}) });
  if (opts.blockGeo) cs.geolocation = 2;
  else if (cs.geolocation === 2) delete cs.geolocation;
  fs.writeFileSync(prefFile, JSON.stringify(prefs));
}

function screenWorkArea() {
  try {
    return require('electron').screen.getPrimaryDisplay().workAreaSize;
  } catch {
    return { width: 1920, height: 1040 };
  }
}

// Names the Chromium profile so its toolbar profile button shows the name.
function writeLocalState(dir, name) {
  const file = path.join(dir, 'Local State');
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {}
  data.profile = data.profile || {};
  const cache = (data.profile.info_cache = data.profile.info_cache || {});
  const entry = (cache.Default = cache.Default || {});
  entry.name = name;
  entry.is_using_default_name = false;
  entry.is_ephemeral = false;
  entry.is_omitted_from_profile_list = false;
  entry.active_time = Date.now() / 1000;
  if (!('background_apps' in entry)) entry.background_apps = false;
  data.profile.profiles_order = ['Default'];
  data.profile.last_used = 'Default';
  data.profile.last_active_profiles = ['Default'];
  try {
    fs.writeFileSync(file, JSON.stringify(data));
  } catch {}
}

// Detects whether a Chromium instance currently holds this user-data-dir.
function isLocked(dir) {
  if (process.platform === 'win32') {
    const lock = path.join(dir, 'lockfile');
    if (!fs.existsSync(lock)) return false;
    try {
      fs.rmSync(lock);
      return false;
    } catch (e) {
      return e.code === 'EBUSY' || e.code === 'EPERM';
    }
  }
  try {
    const target = fs.readlinkSync(path.join(dir, 'SingletonLock'));
    const pid = Number(target.split('-').pop());
    return isPidAlive(pid);
  } catch {
    return false;
  }
}

function isPidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

async function waitUntil(fn, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return fn();
}

module.exports = new Launcher();
