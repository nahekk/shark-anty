'use strict';

const TYPES = ['http', 'socks4', 'socks5'];
const ALIASES = { https: 'http', socks: 'socks5', socks5h: 'socks5', socks4a: 'socks4' };

function normalizeType(t, fallback = 'http') {
  const v = String(t || '').toLowerCase().trim();
  if (TYPES.includes(v)) return v;
  if (ALIASES[v]) return ALIASES[v];
  return fallback;
}

const isPort = (s) => /^\d{1,5}$/.test(String(s)) && Number(s) > 0 && Number(s) < 65536;

/**
 * Parses one proxy line. Accepted formats (type prefix optional):
 *   socks5://user:pass@host:port
 *   host:port
 *   host:port:user:pass
 *   user:pass@host:port
 *   user:pass:host:port
 *   [ipv6]:port
 * Returns { type, host, port, username, password } or throws.
 */
function parseProxy(line, defaultType = 'http') {
  let s = String(line || '').trim();
  if (!s) throw new Error('Empty proxy');

  let type = defaultType;
  const scheme = s.match(/^([a-z0-9]+):\/\//i);
  if (scheme) {
    type = normalizeType(scheme[1], null);
    if (!type) throw new Error(`Unsupported proxy type: ${scheme[1]}`);
    s = s.slice(scheme[0].length);
  }
  s = s.replace(/\/+$/, '');

  let username = '';
  let password = '';
  let hostPort = s;

  const at = s.lastIndexOf('@');
  if (at !== -1) {
    const left = s.slice(0, at);
    const right = s.slice(at + 1);
    // user:pass@host:port   or   host:port@user:pass
    if (looksLikeHostPort(right)) {
      [username, password] = splitOnce(left, ':');
      hostPort = right;
    } else if (looksLikeHostPort(left)) {
      [username, password] = splitOnce(right, ':');
      hostPort = left;
    } else {
      throw new Error('Cannot parse proxy');
    }
  } else if (!s.startsWith('[')) {
    const parts = s.split(':');
    if (parts.length === 4) {
      if (isPort(parts[1])) {
        hostPort = `${parts[0]}:${parts[1]}`;
        username = parts[2];
        password = parts[3];
      } else if (isPort(parts[3])) {
        username = parts[0];
        password = parts[1];
        hostPort = `${parts[2]}:${parts[3]}`;
      }
    } else if (parts.length > 4 && isPort(parts[1])) {
      // host:port:user:pass-with:colons
      hostPort = `${parts[0]}:${parts[1]}`;
      username = parts[2];
      password = parts.slice(3).join(':');
    }
  }

  const { host, port } = splitHostPort(hostPort);
  if (!host) throw new Error('Missing proxy host');
  if (!isPort(port)) throw new Error('Invalid proxy port');

  return {
    type,
    host,
    port: Number(port),
    username: decodeSafe(username),
    password: decodeSafe(password),
  };
}

function looksLikeHostPort(s) {
  try {
    const { host, port } = splitHostPort(s);
    return Boolean(host) && isPort(port);
  } catch {
    return false;
  }
}

function splitHostPort(s) {
  if (s.startsWith('[')) {
    const end = s.indexOf(']');
    return { host: s.slice(1, end), port: s.slice(end + 2) };
  }
  const i = s.lastIndexOf(':');
  if (i === -1) return { host: s, port: '' };
  return { host: s.slice(0, i), port: s.slice(i + 1) };
}

function splitOnce(s, sep) {
  const i = s.indexOf(sep);
  return i === -1 ? [s, ''] : [s.slice(0, i), s.slice(i + 1)];
}

function decodeSafe(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Parses many lines; returns { ok: [...], errors: [{ line, error }] }. */
function parseProxyList(text, defaultType = 'http') {
  const ok = [];
  const errors = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    try {
      ok.push(parseProxy(line, defaultType));
    } catch (e) {
      errors.push({ line, error: e.message });
    }
  }
  return { ok, errors };
}

function formatProxy(p, withAuth = true) {
  if (!p) return '';
  const host = p.host.includes(':') ? `[${p.host}]` : p.host;
  const auth =
    withAuth && p.username ? `${encodeURIComponent(p.username)}:${encodeURIComponent(p.password || '')}@` : '';
  return `${p.type}://${auth}${host}:${p.port}`;
}

function validateProxy(p) {
  if (!p || typeof p !== 'object') throw new Error('Invalid proxy');
  const type = normalizeType(p.type, null);
  if (!type) throw new Error('Invalid proxy type');
  const host = String(p.host || '').trim();
  if (!host || /[\s/@]/.test(host)) throw new Error('Invalid proxy host');
  if (!isPort(p.port)) throw new Error('Invalid proxy port');
  return { type, host, port: Number(p.port), username: String(p.username || ''), password: String(p.password || '') };
}

module.exports = { TYPES, parseProxy, parseProxyList, formatProxy, validateProxy, normalizeType };
