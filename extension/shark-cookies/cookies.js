// Shared helpers for the popup and the import page.

const TWO_LEVEL = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.pl', 'net.pl', 'org.pl', 'waw.pl', 'com.au', 'net.au', 'org.au',
  'co.jp', 'co.kr', 'com.br', 'com.mx', 'com.ar', 'com.tr', 'co.in', 'co.nz', 'co.za', 'com.cn', 'com.hk',
  'com.tw', 'com.sg', 'com.ua', 'com.ru', 'github.io', 'herokuapp.com', 'vercel.app', 'netlify.app', 'pages.dev',
]);

export function baseDomain(hostname) {
  const parts = hostname.replace(/^\./, '').split('.');
  if (parts.length <= 2 || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return hostname;
  const last2 = parts.slice(-2).join('.');
  return TWO_LEVEL.has(last2) ? parts.slice(-3).join('.') : last2;
}

export async function activeTabUrl() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const u = new URL(tab && tab.url);
    return /^https?:$/.test(u.protocol) ? u : null;
  } catch {
    return null;
  }
}

export async function getCookies(domain) {
  return chrome.cookies.getAll(domain ? { domain } : {});
}

// chrome.cookies objects already match the Cookie-Editor / EditThisCookie format.
export function toJson(cookies) {
  return JSON.stringify(
    cookies.map((c, i) => ({
      domain: c.domain,
      ...(c.session ? {} : { expirationDate: c.expirationDate }),
      hostOnly: c.hostOnly,
      httpOnly: c.httpOnly,
      name: c.name,
      path: c.path,
      sameSite: c.sameSite,
      secure: c.secure,
      session: c.session,
      storeId: c.storeId,
      value: c.value,
      id: i + 1,
    })),
    null,
    2,
  );
}

export function toNetscape(cookies) {
  const lines = ['# Netscape HTTP Cookie File', '# Exported by Shark{anty} - Shark Cookies', ''];
  for (const c of cookies) {
    lines.push(
      [
        (c.httpOnly ? '#HttpOnly_' : '') + c.domain,
        c.hostOnly ? 'FALSE' : 'TRUE',
        c.path,
        c.secure ? 'TRUE' : 'FALSE',
        c.session ? 0 : Math.floor(c.expirationDate),
        c.name,
        c.value,
      ].join('\t'),
    );
  }
  return lines.join('\n') + '\n';
}

// Accepts Cookie-Editor / EditThisCookie / Dolphin / Puppeteer JSON or Netscape cookies.txt
export function parseCookies(text) {
  text = String(text || '').replace(/^﻿/, '').trim();
  if (!text) throw new Error('Nothing to import');
  if (text.startsWith('[') || text.startsWith('{')) {
    const json = JSON.parse(text);
    const list = Array.isArray(json) ? json : json.cookies || json.data;
    if (!Array.isArray(list)) throw new Error('JSON does not contain a cookie list');
    return list.map(fromJson).filter(Boolean);
  }
  const out = [];
  for (let line of text.split(/\r?\n/)) {
    let httpOnly = false;
    if (line.startsWith('#HttpOnly_')) {
      httpOnly = true;
      line = line.slice(10);
    } else if (line.startsWith('#') || !line.trim()) continue;
    const p = line.split('\t');
    if (p.length < 7) continue;
    const exp = Number(p[4]);
    out.push({
      domain: p[0],
      hostOnly: p[1].toUpperCase() !== 'TRUE' && !p[0].startsWith('.'),
      path: p[2] || '/',
      secure: p[3].toUpperCase() === 'TRUE',
      expirationDate: exp > 0 ? exp : undefined,
      name: p[5],
      value: p.slice(6).join('\t'),
      httpOnly,
      sameSite: 'unspecified',
    });
  }
  if (!out.length) throw new Error('Unrecognised format (expected JSON or Netscape cookies.txt)');
  return out;
}

function fromJson(c) {
  if (!c || c.name === undefined) return null;
  const domain = String(c.domain || c.host || '');
  if (!domain) return null;
  let exp = c.expirationDate ?? c.expires ?? c.expiry;
  exp = Number(exp);
  if (!(exp > 0) || c.session === true) exp = undefined;
  else if (exp > 1e11) exp = exp / 1000;
  const ss = String(c.sameSite || '').toLowerCase();
  return {
    domain,
    hostOnly: typeof c.hostOnly === 'boolean' ? c.hostOnly : !domain.startsWith('.'),
    path: c.path || '/',
    secure: Boolean(c.secure),
    httpOnly: Boolean(c.httpOnly),
    expirationDate: exp,
    name: String(c.name),
    value: String(c.value ?? ''),
    sameSite: ss === 'strict' ? 'strict' : ss === 'lax' ? 'lax' : ss === 'none' || ss === 'no_restriction' ? 'no_restriction' : 'unspecified',
  };
}

export async function importCookies(list) {
  let ok = 0;
  let failed = 0;
  for (const c of list) {
    const host = c.domain.replace(/^\./, '');
    const secure = c.secure || c.sameSite === 'no_restriction' || c.name.startsWith('__Secure-') || c.name.startsWith('__Host-');
    const details = {
      url: `${secure ? 'https' : 'http'}://${host}${c.path || '/'}`,
      name: c.name,
      value: c.value,
      path: c.path || '/',
      secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite || 'unspecified',
    };
    if (!c.hostOnly) details.domain = '.' + host;
    if (c.expirationDate) details.expirationDate = c.expirationDate;
    try {
      const r = await chrome.cookies.set(details);
      r ? ok++ : failed++;
    } catch {
      failed++;
    }
  }
  return { ok, failed };
}

export async function removeCookies(cookies) {
  for (const c of cookies) {
    const host = c.domain.replace(/^\./, '');
    await chrome.cookies.remove({ url: `http${c.secure ? 's' : ''}://${host}${c.path}`, name: c.name, storeId: c.storeId });
  }
}

export function download(text, filename, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
