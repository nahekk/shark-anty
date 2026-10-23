'use strict';
const path = require('node:path');
const { app, BrowserWindow, Tray, Menu, nativeImage, shell, dialog } = require('electron');

app.setName('Shark{anty}');
if (process.platform === 'win32') app.setAppUserModelId('com.nahekk.sharkanty');

// Custom data location: SHARK_DATA_DIR env var, or a "data" folder next to the exe
// when a file named "portable" exists there (portable mode, e.g. on a USB stick).
{
  const fs = require('node:fs');
  const exeDir = path.dirname(process.execPath);
  if (process.env.SHARK_DATA_DIR) app.setPath('userData', path.resolve(process.env.SHARK_DATA_DIR));
  else if (app.isPackaged && fs.existsSync(path.join(exeDir, 'portable'))) app.setPath('userData', path.join(exeDir, 'data'));
  // The single-instance lock lives in userData, so the folder must exist first.
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
}

// One Shark{anty} window at a time; a second launch just focuses the first.
// The manager window is simple 2D UI; skipping the GPU avoids driver problems on some PCs.
app.disableHardwareAcceleration();

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const paths = require('./paths');
const log = require('./log');
const store = require('./store');

let mainWindow = null;
let tray = null;
let quitting = false;
const isDev = process.argv.includes('--dev');

function createWindow() {
  const theme = require('./ipc').THEME_COLORS[store.settings.theme === 'light' ? 'light' : 'dark'];
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 820,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    backgroundColor: theme.color,
    title: 'Shark{anty}',
    icon: path.join(__dirname, '..', 'renderer', 'assets', 'logo.png'),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay: process.platform === 'darwin' ? undefined : { ...theme, height: 51 },
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      devTools: isDev || !app.isPackaged,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // The UI never navigates; external links open in the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());

  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });

  mainWindow.on('close', (e) => {
    if (quitting) return;
    const launcher = require('./browser/launcher');
    // With open profiles, always ask - even in tray mode.
    if (launcher.visibleCount() > 0) {
      e.preventDefault();
      confirmQuit();
      return;
    }
    if (store.settings.closeToTray && tray) {
      e.preventDefault();
      mainWindow.hide();
    } else {
      quit();
    }
  });
}

// Localised strings used by the native quit dialog.
function L(key) {
  const lang = ['pl', 'ru'].includes(store.settings.language) ? store.settings.language : 'en';
  const S = {
    en: { title: 'Shark{anty}', msg: 'Profiles are still open', detail: (n) => `${n} profile(s) are open. Close them and quit Shark{anty}? Cookies are saved safely.`, ok: 'Close profiles and quit', cancel: 'Cancel' },
    pl: { title: 'Shark{anty}', msg: 'Profile są nadal otwarte', detail: (n) => `Otwarte profile: ${n}. Zamknąć je i wyłączyć Shark{anty}? Cookies zostaną bezpiecznie zapisane.`, ok: 'Zamknij profile i wyłącz', cancel: 'Anuluj' },
    ru: { title: 'Shark{anty}', msg: 'Профили ещё открыты', detail: (n) => `Открыто профилей: ${n}. Закрыть их и выйти из Shark{anty}? Cookie будут сохранены.`, ok: 'Закрыть профили и выйти', cancel: 'Отмена' },
  };
  return S[lang][key];
}

async function confirmQuit() {
  const launcher = require('./browser/launcher');
  const n = launcher.visibleCount();
  if (n === 0) return quit();
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  else showWindow();
  const r = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: [L('ok'), L('cancel')],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    title: L('title'),
    message: L('msg'),
    detail: L('detail')(n),
  });
  if (r.response === 0) quit();
}

function showWindow() {
  if (!mainWindow) return createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'renderer', 'assets', 'tray.png'));
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('Shark{anty}');
  tray.on('click', showWindow);
  const launcher = require('./browser/launcher');
  const rebuild = () => {
    const open = launcher
      .list()
      .filter((r) => !r.headless)
      .map((r) => store.getProfile(r.id))
      .filter(Boolean);
    tray.setToolTip(`Shark{anty} - ${open.length} profile(s) open`);
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open Shark{anty}', click: showWindow },
        { type: 'separator' },
        ...(open.length
          ? open.map((p) => ({ label: `■ Stop "${p.name}"`, click: () => launcher.stop(p.id) }))
          : [{ label: 'No open profiles', enabled: false }]),
        { label: 'Stop all profiles', enabled: open.length > 0, click: () => launcher.stopAll() },
        { type: 'separator' },
        { label: 'Quit', click: confirmQuit },
      ]),
    );
  };
  launcher.on('changed', rebuild);
  rebuild();
}

async function quit() {
  if (quitting) return;
  quitting = true;
  log.info('Quitting…');
  try {
    const launcher = require('./browser/launcher');
    const presence = require('./rpc/presence');
    presence.stop();
    require('./browser/taskbar').dispose();
    await Promise.race([launcher.stopAll(), new Promise((r) => setTimeout(r, 12000))]);
  } catch (e) {
    log.error('Error while quitting', e);
  }
  await store.flush();
  if (tray) tray.destroy();
  app.exit(0);
}

app.on('second-instance', showWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !tray) quit();
});
app.on('activate', showWindow);
app.on('before-quit', (e) => {
  if (!quitting) {
    e.preventDefault();
    confirmQuit();
  }
});

app.whenReady().then(async () => {
  log.init(paths.logsDir());
  log.info(`Shark{anty} ${app.getVersion()} starting (Electron ${process.versions.electron}, ${process.platform}-${process.arch})`);
  await store.load();

  const launcher = require('./browser/launcher');
  const presence = require('./rpc/presence');
  const localApi = require('./api/local-api');
  const ipc = require('./ipc');

  Menu.setApplicationMenu(null);
  ipc.register(() => mainWindow);
  createWindow();
  createTray();

  await launcher.adoptOrphans().catch((e) => log.warn('adoptOrphans failed', e.message));
  presence.start();
  localApi.start();
  require('./browser/engines').startAutoCheck();
});

process.on('uncaughtException', (e) => log.error('Uncaught exception', e));
process.on('unhandledRejection', (e) => log.error('Unhandled rejection', e));
