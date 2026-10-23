'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { pipeline } = require('node:stream/promises');
const { Readable, Transform } = require('node:stream');
const { app } = require('electron');
const extractZip = require('extract-zip');
const paths = require('../paths');
const store = require('../store');
const log = require('../log');

/**
 * Chromium builds ("engines") Shark{anty} downloads and keeps up to date.
 *
 *  chromium  - Chromium (latest stable) with Google sync and H.264/AAC codecs.
 *              Windows: builds by Hibbiki (github.com/Hibbiki/chromium-win64).
 *              Other systems: official Chromium snapshot builds.
 *  ungoogled - ungoogled-chromium (latest stable), no Google services or telemetry.
 *  custom    - any Chromium-based executable chosen by the user.
 */
const SOURCES = {
  chromium: {
    label: 'Chromium (latest)',
    platforms: ['win32', 'linux', 'darwin'],
    async latest() {
      if (process.platform === 'win32') {
        const rel = await getJson('https://api.github.com/repos/Hibbiki/chromium-win64/releases/latest');
        const asset = (rel.assets || []).find((a) => a.name === 'chrome.7z');
        if (!asset) throw new Error('No Chromium build found for this system');
        const version = String(rel.tag_name).replace(/^v/, '').replace(/-r\d+$/, '');
        return { version, url: asset.browser_download_url, size: asset.size, archive: '7z' };
      }
      const dir = process.platform === 'darwin' ? (process.arch === 'arm64' ? 'Mac_Arm' : 'Mac') : 'Linux_x64';
      const rev = (await getText(`https://commondatastorage.googleapis.com/chromium-browser-snapshots/${dir}/LAST_CHANGE`)).trim();
      const file = process.platform === 'darwin' ? 'chrome-mac.zip' : 'chrome-linux.zip';
      return { version: `r${rev}`, url: `https://commondatastorage.googleapis.com/chromium-browser-snapshots/${dir}/${rev}/${file}`, archive: 'zip' };
    },
  },
  ungoogled: {
    label: 'ungoogled-chromium (latest)',
    platforms: ['win32'],
    async latest() {
      const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'ia32' ? 'x86' : 'x64';
      const rel = await getJson('https://api.github.com/repos/ungoogled-software/ungoogled-chromium-windows/releases/latest');
      const asset = (rel.assets || []).find((a) => a.name.endsWith(`_windows_${arch}.zip`));
      if (!asset) throw new Error('No ungoogled-chromium build found for this system');
      return { version: String(rel.tag_name).replace(/^v/, ''), url: asset.browser_download_url, size: asset.size, archive: 'zip' };
    },
  },
};

const UPDATE_CHECK_EVERY = 6 * 60 * 60 * 1000;

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'SharkAnty', Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function getText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'SharkAnty' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

// Path of the bundled 7-Zip binary (unpacked from the asar archive when packaged).
function sevenZipPath() {
  const p = require('7zip-bin').path7za;
  return app.isPackaged ? p.replace('app.asar', 'app.asar.unpacked') : p;
}

function extract7z(archive, dir) {
  return new Promise((resolve, reject) => {
    execFile(sevenZipPath(), ['x', archive, `-o${dir}`, '-y', '-bd'], { windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (err, _out, stderr) =>
      err ? reject(new Error(`7-Zip failed: ${stderr || err.message}`)) : resolve(),
    );
  });
}

// Finds the browser executable inside an extracted build.
function findExecutable(dir) {
  const names =
    process.platform === 'win32' ? ['chrome.exe'] : process.platform === 'darwin' ? ['Chromium', 'Google Chrome for Testing'] : ['chrome'];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.shift();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isFile() && names.includes(e.name)) {
        if (process.platform !== 'darwin' || full.includes(`${path.sep}MacOS${path.sep}`)) return full;
      }
      if (e.isDirectory() && full.split(path.sep).length - dir.split(path.sep).length < 6) stack.push(full);
    }
  }
  return null;
}

// Windows Chromium builds keep their DLLs in a folder named after the version (e.g. 156.0.8078.48).
function detectVersion(exePath) {
  try {
    const v = fs.readdirSync(path.dirname(exePath)).find((n) => /^\d+\.\d+\.\d+\.\d+$/.test(n));
    if (v) return v;
  } catch {}
  return null;
}

class Engines extends EventEmitter {
  constructor() {
    super();
    this.installing = null; // { source, stage, received, total }
    this.update = null; // { source, current, latest } when a newer build exists
    this._timer = null;
  }

  availableSources() {
    return Object.entries(SOURCES)
      .filter(([, s]) => s.platforms.includes(process.platform))
      .map(([id, s]) => ({ id, label: s.label }))
      .concat([{ id: 'custom', label: 'Custom executable' }]);
  }

  status() {
    const eng = store.settings.engine;
    let source = eng.source;
    if (source !== 'custom' && !(SOURCES[source] && SOURCES[source].platforms.includes(process.platform))) source = 'chromium';
    const inst = eng.installed[source];
    let exePath = null;
    let version = null;
    if (source === 'custom') {
      exePath = eng.customPath && fs.existsSync(eng.customPath) ? eng.customPath : null;
      version = exePath ? detectVersion(exePath) || 'custom' : null;
    } else if (inst && inst.exePath && fs.existsSync(inst.exePath)) {
      exePath = inst.exePath;
      version = inst.chromeVersion || inst.version;
    }
    return {
      source,
      sources: this.availableSources(),
      ready: Boolean(exePath),
      exePath,
      version,
      major: version ? parseInt(version, 10) || null : null,
      installed: eng.installed,
      installing: this.installing,
      update: this.update,
    };
  }

  executable() {
    const s = this.status();
    if (!s.ready) {
      const err = new Error('Browser engine is not installed. Download Chromium first.');
      err.code = 'NO_ENGINE';
      throw err;
    }
    return s.exePath;
  }

  async checkUpdate() {
    const s = this.status();
    if (s.source === 'custom' || !SOURCES[s.source]) return { source: s.source, current: s.version, latest: null, update: false };
    const latest = await SOURCES[s.source].latest();
    const inst = s.installed[s.source];
    const update = Boolean(inst) && s.ready && inst.version !== latest.version;
    this.update = update ? { source: s.source, current: inst.version, latest: latest.version } : null;
    this.emit('update', this.update);
    return { source: s.source, current: inst ? inst.version : null, latest: latest.version, update: update || !s.ready };
  }

  // Checks for a newer build shortly after start and then every few hours.
  startAutoCheck() {
    const run = () =>
      this.checkUpdate().catch((e) => log.warn('Engine update check failed:', e.message));
    setTimeout(run, 8000);
    clearInterval(this._timer);
    this._timer = setInterval(run, UPDATE_CHECK_EVERY);
  }

  async install(source) {
    if (this.installing) throw new Error('A download is already in progress');
    const src = SOURCES[source];
    if (!src) throw new Error('Unknown engine');
    this._progress({ source, stage: 'resolve', received: 0, total: 0 });
    const info = await src.latest().catch((e) => {
      this._progress(null);
      throw e;
    });
    const tmpFile = path.join(paths.tmpDir(), `${source}-${Date.now()}.${info.archive}`);
    try {
      const baseDir = path.join(paths.enginesDir(), source);
      const target = path.join(baseDir, info.version.replace(/[^\w.-]/g, '_'));
      log.info(`Installing engine ${source} ${info.version} from ${info.url}`);

      await this._download(info.url, tmpFile, source, info.size);

      this._progress({ source, stage: 'extract', received: 0, total: 0 });
      const staging = target + '.partial';
      fs.rmSync(staging, { recursive: true, force: true });
      fs.mkdirSync(staging, { recursive: true });
      if (info.archive === '7z') await extract7z(tmpFile, staging);
      else await extractZip(tmpFile, { dir: staging });
      fs.rmSync(target, { recursive: true, force: true });
      fs.renameSync(staging, target);

      const exePath = findExecutable(target);
      if (!exePath) throw new Error('Browser executable not found in the downloaded archive');
      if (process.platform !== 'win32') fs.chmodSync(exePath, 0o755);

      const record = {
        version: info.version,
        chromeVersion: detectVersion(exePath) || info.version,
        exePath,
        dir: target,
        installedAt: Date.now(),
      };
      store.updateSettings({ engine: { source, installed: { ...store.settings.engine.installed, [source]: record } } });
      this._cleanupOld(baseDir, target);
      if (this.update && this.update.source === source) this.update = null;
      this.emit('update', this.update);
      this._progress(null);
      log.info(`Engine ${source} ${record.chromeVersion} ready at ${exePath}`);
      this.emit('installed', record);
      return this.status();
    } catch (e) {
      this._progress(null);
      log.error('Engine install failed', e);
      throw e;
    } finally {
      fs.rmSync(tmpFile, { force: true });
    }
  }

  async _download(url, file, source, sizeHint) {
    const res = await fetch(url, { headers: { 'User-Agent': 'SharkAnty' } });
    if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status})`);
    const total = Number(res.headers.get('content-length')) || sizeHint || 0;
    let received = 0;
    let last = 0;
    const counter = new Transform({
      transform: (chunk, _enc, cb) => {
        received += chunk.length;
        const now = Date.now();
        if (now - last > 200) {
          last = now;
          this._progress({ source, stage: 'download', received, total });
        }
        cb(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(file));
    this._progress({ source, stage: 'download', received, total: total || received });
  }

  // Remove older builds of the same engine; folders still in use are skipped.
  _cleanupOld(baseDir, keep) {
    try {
      for (const name of fs.readdirSync(baseDir)) {
        const full = path.join(baseDir, name);
        if (full === keep) continue;
        try {
          fs.rmSync(full, { recursive: true, force: true });
        } catch (e) {
          log.warn(`Could not remove old engine ${full}: ${e.message}`);
        }
      }
    } catch {}
  }

  _progress(p) {
    this.installing = p;
    this.emit('progress', p);
  }
}

module.exports = new Engines();
module.exports.findExecutable = findExecutable;
