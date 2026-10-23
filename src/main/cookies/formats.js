'use strict';

/**
 * Cookie format conversion. Internal "normalized" cookie:
 *   { name, value, domain, path, expires (unix seconds, -1 = session),
 *     httpOnly, secure, sameSite ('Strict'|'Lax'|'None'|undefined), hostOnly }
 *
 * Import accepts:
 *   - JSON array from Cookie-Editor, EditThisCookie, Dolphin{Anty}, AdsPower,
 *     GoLogin, Puppeteer/Playwright/CDP (fields are auto-detected)
 *   - JSON object { cookies: [...] }
 *   - Netscape / cookies.txt (curl, yt-dlp, "Get cookies.txt")
 */

function parseCookies(input) {
  const text = String(input || '').replace(/^﻿/, '').trim();
  if (!text) throw new Error('No cookies found');

  if (text.startsWith('[') || text.startsWith('{')) {
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw new Error('Invalid JSON: ' + e.message);
    }
    let list = Array.isArray(json) ? json : json.cookies || json.data || json.Cookies;
    if (!Array.isArray(list)) throw new Error('JSON does not contain a cookie list');
    const out = list.map(fromJsonCookie).filter(Boolean);
    if (!out.length) throw new Error('No valid cookies in JSON');
    return out;
  }

  const out = parseNetscape(text);
  if (!out.length) throw new Error('Unrecognised cookie format (expected JSON or Netscape cookies.txt)');
  return out;
}

function fromJsonCookie(c) {
  if (!c || typeof c !== 'object') return null;
  const name = c.name ?? c.Name ?? c.key;
  if (name === undefined || name === null) return null;
  let domain = String(c.domain ?? c.Domain ?? c.host ?? '').trim();
  if (!domain && c.url) {
    try {
      domain = new URL(c.url).hostname;
    } catch {}
  }
  if (!domain) return null;

  let hostOnly;
  if (typeof c.hostOnly === 'boolean') hostOnly = c.hostOnly;
  else hostOnly = !domain.startsWith('.');

  let expires = -1;
  const exp = c.expirationDate ?? c.expires ?? c.expiry ?? c.Expires;
  const isSession = c.session === true || c.isSession === true;
  if (!isSession && exp !== undefined && exp !== null && exp !== '' && exp !== -1) {
    const n = typeof exp === 'string' && !/^\d+(\.\d+)?$/.test(exp) ? Date.parse(exp) / 1000 : Number(exp);
    // milliseconds -> seconds
    if (Number.isFinite(n) && n > 0) expires = n > 1e11 ? n / 1000 : n;
  }

  return {
    name: String(name),
    value: String(c.value ?? c.Value ?? ''),
    domain,
    path: String(c.path ?? c.Path ?? '/') || '/',
    expires,
    httpOnly: Boolean(c.httpOnly ?? c.HttpOnly ?? c.httponly),
    secure: Boolean(c.secure ?? c.Secure),
    sameSite: normalizeSameSite(c.sameSite ?? c.SameSite ?? c.samesite),
    hostOnly,
  };
}

function normalizeSameSite(v) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).toLowerCase();
  if (s === 'strict') return 'Strict';
  if (s === 'lax') return 'Lax';
  if (s === 'none' || s === 'no_restriction') return 'None';
  return undefined; // unspecified
}

function parseNetscape(text) {
  const out = [];
  for (let line of text.split(/\r?\n/)) {
    let httpOnly = false;
    if (line.startsWith('#HttpOnly_')) {
      httpOnly = true;
      line = line.slice('#HttpOnly_'.length);
    } else if (line.startsWith('#') || !line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 7) continue;
    const [domain, flag, path, secure, expiry, name, ...rest] = parts;
    const exp = Number(expiry);
    out.push({
      name,
      value: rest.join('\t'),
      domain,
      path: path || '/',
      expires: exp > 0 ? exp : -1,
      httpOnly,
      secure: secure.toUpperCase() === 'TRUE',
      sameSite: undefined,
      hostOnly: flag.toUpperCase() !== 'TRUE' && !domain.startsWith('.'),
    });
  }
  return out;
}

/** Normalized -> CDP Network.CookieParam */
function toCdpParam(c) {
  const host = c.domain.replace(/^\./, '');
  const p = {
    name: c.name,
    value: c.value,
    path: c.path || '/',
    secure: Boolean(c.secure),
    httpOnly: Boolean(c.httpOnly),
  };
  if (c.hostOnly) {
    // host-only cookies are set via URL so no Domain attribute is added
    p.url = `${c.secure ? 'https' : 'http'}://${host}${p.path}`;
  } else {
    p.domain = '.' + host;
  }
  if (c.sameSite) p.sameSite = c.sameSite;
  if (p.sameSite === 'None' && !p.secure) p.secure = true; // Chromium rejects SameSite=None without Secure
  if (c.name.startsWith('__Secure-') || c.name.startsWith('__Host-')) p.secure = true;
  if (c.expires && c.expires > 0) p.expires = Math.floor(c.expires);
  return p;
}

/** CDP Network.Cookie -> normalized */
function fromCdp(c) {
  return {
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    expires: c.session || c.expires <= 0 ? -1 : c.expires,
    httpOnly: c.httpOnly,
    secure: c.secure,
    sameSite: c.sameSite,
    hostOnly: !c.domain.startsWith('.'),
  };
}

/** Normalized -> Cookie-Editor / EditThisCookie compatible JSON (most widely supported). */
function toJson(cookies) {
  const sameSiteMap = { Strict: 'strict', Lax: 'lax', None: 'no_restriction' };
  return JSON.stringify(
    cookies.map((c, i) => {
      const o = {
        domain: c.domain,
        expirationDate: c.expires > 0 ? c.expires : undefined,
        hostOnly: c.hostOnly,
        httpOnly: c.httpOnly,
        name: c.name,
        path: c.path,
        sameSite: sameSiteMap[c.sameSite] || 'unspecified',
        secure: c.secure,
        session: !(c.expires > 0),
        storeId: '0',
        value: c.value,
        id: i + 1,
      };
      if (o.expirationDate === undefined) delete o.expirationDate;
      return o;
    }),
    null,
    2,
  );
}

function toNetscape(cookies) {
  const lines = ['# Netscape HTTP Cookie File', '# Exported by Shark{anty}', ''];
  for (const c of cookies) {
    const domain = c.hostOnly ? c.domain.replace(/^\./, '') : c.domain.startsWith('.') ? c.domain : '.' + c.domain;
    lines.push(
      [
        (c.httpOnly ? '#HttpOnly_' : '') + domain,
        c.hostOnly ? 'FALSE' : 'TRUE',
        c.path || '/',
        c.secure ? 'TRUE' : 'FALSE',
        c.expires > 0 ? Math.floor(c.expires) : 0,
        c.name,
        c.value,
      ].join('\t'),
    );
  }
  return lines.join('\n') + '\n';
}

function filterByDomain(cookies, domainFilter) {
  const f = String(domainFilter || '').trim().toLowerCase().replace(/^\./, '');
  if (!f) return cookies;
  return cookies.filter((c) => {
    const d = c.domain.toLowerCase().replace(/^\./, '');
    return d === f || d.endsWith('.' + f) || f.endsWith('.' + d);
  });
}

module.exports = { parseCookies, toCdpParam, fromCdp, toJson, toNetscape, filterByDomain };
