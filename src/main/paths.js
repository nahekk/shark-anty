'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { app } = require('electron');

// Everything Shark{anty} stores lives under the Electron userData folder:
//   %APPDATA%/Shark{anty}/
//     shark-data.json      profiles, proxies, settings
//     profiles/<id>/       Chromium user-data-dir of each profile
//     engines/<source>/    downloaded Chromium builds
//     extensions/<id>/     unpacked extensions from the Chrome Web Store
//     logs/                main.log

function root() {
  return app.getPath('userData');
}

function ensure(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const paths = {
  root,
  dataFile: () => path.join(root(), 'shark-data.json'),
  profilesDir: () => ensure(path.join(root(), 'profiles')),
  profileDir: (id) => path.join(paths.profilesDir(), String(id).replace(/[^a-zA-Z0-9_-]/g, '')),
  enginesDir: () => ensure(path.join(root(), 'engines')),
  extensionsDir: () => ensure(path.join(root(), 'extensions')),
  logsDir: () => ensure(path.join(root(), 'logs')),
  tmpDir: () => ensure(path.join(root(), 'tmp')),
  // The built-in cookie extension ships with the app. When packaged it is unpacked
  // from the asar archive because Chromium cannot read files inside asar.
  builtinExtension: () => {
    const base = app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar.unpacked')
      : path.join(__dirname, '..', '..');
    return path.join(base, 'extension', 'shark-cookies');
  },
};

module.exports = paths;
