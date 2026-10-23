'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { BrowserWindow } = require('electron');
const paths = require('../paths');
const log = require('../log');

/**
 * Gives each running profile its own blue taskbar icon showing the profile's
 * initials, so several open browsers are easy to tell apart.
 *
 * Chromium sets the browser window's icon from its own resources at runtime, so
 * replacing the exe icon does nothing. The only thing that works is sending
 * WM_SETICON to the window. The catch: the window just stores the icon handle,
 * so the handle must stay alive for the whole session - therefore a tiny
 * PowerShell helper runs alongside each browser, holds the icons and re-applies
 * them every couple of seconds (in case Chromium re-sets its own). Windows only;
 * a no-op elsewhere.
 */
let renderWin = null;

function initials(name) {
  const parts = String(name || '?').trim().split(/[\s_\-.]+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

async function renderPng(profile, size) {
  if (!renderWin || renderWin.isDestroyed()) {
    renderWin = new BrowserWindow({ show: false, width: 64, height: 64, webPreferences: { offscreen: true } });
    await renderWin.loadURL('data:text/html,<body></body>');
  }
  const accent = profile.color && /^#[0-9a-f]{6}$/i.test(profile.color) ? profile.color : '#2f81f7';
  const text = initials(profile.name);
  const dataUrl = await renderWin.webContents.executeJavaScript(`(() => {
    const s = ${size}, c = document.createElement('canvas'); c.width = s; c.height = s;
    const x = c.getContext('2d');
    const r = s * 0.24;
    const g = x.createLinearGradient(0, 0, s, s);
    g.addColorStop(0, '#2f82ff'); g.addColorStop(1, '#0b43a8');
    x.fillStyle = g;
    x.beginPath();
    x.moveTo(r, 0); x.arcTo(s, 0, s, s, r); x.arcTo(s, s, 0, s, r); x.arcTo(0, s, 0, 0, r); x.arcTo(0, 0, s, 0, r); x.closePath(); x.fill();
    x.fillStyle = ${JSON.stringify(accent)};
    x.fillRect(0, s - Math.max(2, s * 0.13), s, Math.max(2, s * 0.13));
    x.fillStyle = '#ffffff';
    x.font = '700 ' + Math.round(s * (${JSON.stringify(text)}.length > 1 ? 0.52 : 0.66)) + 'px "Segoe UI", Arial, sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(${JSON.stringify(text)}, s / 2, s / 2 + s * 0.03);
    return c.toDataURL('image/png');
  })()`);
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

// Pack several PNGs into a single .ico (icons may hold PNG-encoded images).
function pngsToIco(entries) {
  const count = entries.length;
  const header = Buffer.alloc(6 + count * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  let offset = header.length;
  for (let i = 0; i < count; i++) {
    const { size, buf } = entries[i];
    const o = 6 + i * 16;
    header.writeUInt8(size >= 256 ? 0 : size, o);
    header.writeUInt8(size >= 256 ? 0 : size, o + 1);
    header.writeUInt16LE(0, o + 4);
    header.writeUInt16LE(32, o + 6);
    header.writeUInt32LE(buf.length, o + 8);
    header.writeUInt32LE(offset, o + 12);
    offset += buf.length;
  }
  return Buffer.concat([header, ...entries.map((e) => e.buf)]);
}

async function buildIco(profile) {
  const key = crypto.createHash('md5').update(`${profile.name}|${profile.color || ''}|v3`).digest('hex').slice(0, 8);
  const file = path.join(paths.profileDir(profile.id), `taskbar-${key}.ico`);
  if (fs.existsSync(file)) return file;
  const entries = [];
  for (const size of [16, 24, 32, 48]) entries.push({ size, buf: await renderPng(profile, size) });
  fs.writeFileSync(file, pngsToIco(entries));
  return file;
}

// A PowerShell loop that keeps the window's icon set to our icon. It holds the
// icon handles for its whole lifetime, so the taskbar icon persists; Shark kills
// it when the profile stops.
function helperScript(pid, icoPath) {
  const ico = icoPath.replace(/'/g, "''");
  return `
$ErrorActionPreference='SilentlyContinue'
Add-Type -AssemblyName System.Drawing
$sig=@'
using System;using System.Runtime.InteropServices;
public class SI {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint c);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll",CharSet=CharSet.Auto)] public static extern IntPtr SendMessage(IntPtr h,int m,IntPtr w,IntPtr l);
}
'@
Add-Type $sig
try { $big = New-Object System.Drawing.Icon('${ico}',32,32) } catch { exit }
try { $small = New-Object System.Drawing.Icon('${ico}',16,16) } catch { $small = $big }
$target=[uint32]${pid}
for($i=0; $i -lt 100000; $i++){
  $any=$false
  $cb=[SI+EnumWindowsProc]{ param($h,$l)
    $p=0;[SI]::GetWindowThreadProcessId($h,[ref]$p)|Out-Null
    if($p -eq $target -and [SI]::IsWindowVisible($h) -and [SI]::GetWindow($h,4) -eq [IntPtr]::Zero -and [SI]::GetWindowTextLength($h) -gt 0){
      [SI]::SendMessage($h,0x80,[IntPtr]0,$small.Handle)|Out-Null
      [SI]::SendMessage($h,0x80,[IntPtr]1,$big.Handle)|Out-Null
      $script:any=$true
    }
    return $true
  }
  [SI]::EnumWindows($cb,[IntPtr]::Zero)|Out-Null
  Start-Sleep -Milliseconds ($(if($i -lt 15){700}else{2500}))
}
`;
}

// Returns the helper child process (or null). The caller keeps it and kills it
// when the profile stops.
async function apply(pid, profile) {
  if (process.platform !== 'win32' || !pid) return null;
  try {
    const ico = await buildIco(profile);
    const tmp = path.join(os.tmpdir(), `shark-icon-${pid}-${Date.now()}.ps1`);
    fs.writeFileSync(tmp, helperScript(pid, ico), 'utf8');
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', tmp], {
      windowsHide: true,
      stdio: 'ignore',
      detached: false,
    });
    child.on('exit', () => fs.rm(tmp, { force: true }, () => {}));
    child.on('error', () => {});
    return child;
  } catch (e) {
    log.warn('Taskbar icon helper failed:', e.message);
    return null;
  }
}

function stop(child) {
  if (!child) return;
  try {
    const { execFile } = require('node:child_process');
    execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], () => {});
  } catch {}
}

function dispose() {
  if (renderWin && !renderWin.isDestroyed()) renderWin.destroy();
  renderWin = null;
}

module.exports = { apply, stop, dispose, initials };
