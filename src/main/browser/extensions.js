'use strict';
const fs = require('node:fs');
const path = require('node:path');
const extractZip = require('extract-zip');
const paths = require('../paths');
const store = require('../store');
const engines = require('./engines');
const log = require('../log');

/**
 * Extensions are downloaded once from the Chrome Web Store, unpacked into the
 * Shark{anty} data folder and loaded into the profiles you pick (--load-extension).
 * This works the same on ungoogled-chromium, Chromium and Chrome for Testing.
 */

const ID_RE = /\b([a-p]{32})\b/;

function parseExtensionId(input) {
  const m = String(input || '').match(ID_RE);
  if (!m) throw new Error('Paste a Chrome Web Store link or a 32-letter extension ID');
  return m[1];
}

async function addFromWebStore(input) {
  const id = parseExtensionId(input);
  const prodversion = (engines.status().version || '150.0.0.0').replace(/^r\d+$/, '150.0.0.0');
  const url =
    'https://clients2.google.com/service/update2/crx?response=redirect&acceptformat=crx2,crx3' +
    `&prodversion=${encodeURIComponent(prodversion)}&x=${encodeURIComponent(`id=${id}&installsource=ondemand&uc`)}`;
  log.info(`Downloading extension ${id}`);
  const res = await fetch(url, { headers: { 'User-Agent': 'SharkAnty' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`Chrome Web Store returned HTTP ${res.status}`);
  const crx = Buffer.from(await res.arrayBuffer());
  if (crx.length < 100) throw new Error('Extension not found in the Chrome Web Store');
  const zip = crxToZip(crx);
  return installZip(id, zip, 'webstore');
}

async function addFromFolder(folder) {
  const manifest = readManifest(folder);
  if (!manifest) throw new Error('This folder does not contain a manifest.json');
  const id = 'local-' + Buffer.from(path.resolve(folder)).toString('base64url').slice(-16);
  const target = path.join(paths.extensionsDir(), id);
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(folder, target, { recursive: true });
  return register(id, target, 'local');
}

async function addFromCrxFile(file) {
  const zip = crxToZip(fs.readFileSync(file));
  const id = 'crx-' + path.basename(file).replace(/\W+/g, '').slice(0, 24) + '-' + Date.now().toString(36);
  return installZip(id, zip, 'crx');
}

async function installZip(id, zipBuf, origin) {
  const target = path.join(paths.extensionsDir(), id);
  const tmpZip = path.join(paths.tmpDir(), `${id}.zip`);
  fs.writeFileSync(tmpZip, zipBuf);
  try {
    fs.rmSync(target, { recursive: true, force: true });
    await extractZip(tmpZip, { dir: target });
  } finally {
    fs.rmSync(tmpZip, { force: true });
  }
  // Chromium refuses unpacked extensions that contain this folder.
  fs.rmSync(path.join(target, '_metadata'), { recursive: true, force: true });
  return register(id, target, origin);
}

function register(id, dir, origin) {
  const manifest = readManifest(dir);
  if (!manifest) throw new Error('Invalid extension (missing manifest.json)');
  const existing = store.listExtensions().find((e) => e.id === id);
  const ext = {
    id,
    name: localize(dir, manifest, manifest.name) || id,
    version: manifest.version || '',
    description: localize(dir, manifest, manifest.description) || '',
    path: dir,
    origin,
    icon: iconDataUrl(dir, manifest),
    enabledByDefault: existing ? existing.enabledByDefault : false,
    addedAt: existing ? existing.addedAt : Date.now(),
  };
  store.upsertExtension(ext);
  return ext;
}

function remove(id) {
  const ext = store.listExtensions().find((e) => e.id === id);
  if (ext && ext.path && ext.path.startsWith(paths.extensionsDir())) {
    fs.rmSync(ext.path, { recursive: true, force: true });
  }
  store.removeExtension(id);
}

async function update(id) {
  const ext = store.listExtensions().find((e) => e.id === id);
  if (!ext || ext.origin !== 'webstore') throw new Error('Only Web Store extensions can be updated');
  return addFromWebStore(id);
}

// CRX2/CRX3 -> plain ZIP
function crxToZip(buf) {
  if (buf.slice(0, 4).toString() !== 'Cr24') {
    if (buf.slice(0, 2).toString() === 'PK') return buf;
    throw new Error('Downloaded file is not a Chrome extension');
  }
  const version = buf.readUInt32LE(4);
  if (version === 3) {
    const headerSize = buf.readUInt32LE(8);
    return buf.slice(12 + headerSize);
  }
  if (version === 2) {
    const pubLen = buf.readUInt32LE(8);
    const sigLen = buf.readUInt32LE(12);
    return buf.slice(16 + pubLen + sigLen);
  }
  throw new Error(`Unsupported CRX version ${version}`);
}

function readManifest(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8').replace(/^﻿/, ''));
  } catch {
    return null;
  }
}

// Resolves "__MSG_appName__" style strings from _locales.
function localize(dir, manifest, value) {
  if (typeof value !== 'string') return value;
  const m = value.match(/^__MSG_(.+)__$/);
  if (!m) return value;
  const key = m[1].toLowerCase();
  const locales = [manifest.default_locale, 'en', 'en_US'].filter(Boolean);
  for (const loc of locales) {
    try {
      const msgs = JSON.parse(fs.readFileSync(path.join(dir, '_locales', loc, 'messages.json'), 'utf8').replace(/^﻿/, ''));
      for (const [k, v] of Object.entries(msgs)) if (k.toLowerCase() === key) return v.message;
    } catch {}
  }
  return value;
}

function iconDataUrl(dir, manifest) {
  const icons = manifest.icons || (manifest.action && manifest.action.default_icon) || {};
  const entries = typeof icons === 'string' ? [[128, icons]] : Object.entries(icons);
  if (!entries.length) return null;
  entries.sort((a, b) => Number(b[0]) - Number(a[0]));
  try {
    const file = path.join(dir, entries[0][1]);
    const ext = path.extname(file).slice(1).toLowerCase();
    const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
    const data = fs.readFileSync(file);
    if (data.length > 200 * 1024) return null;
    return `data:${mime};base64,${data.toString('base64')}`;
  } catch {
    return null;
  }
}

module.exports = { addFromWebStore, addFromFolder, addFromCrxFile, remove, update, parseExtensionId, crxToZip };
