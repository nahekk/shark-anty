'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const store = require('../store');
const launcher = require('../browser/launcher');
const cookies = require('../cookies/service');
const { parseProxy } = require('../proxy/parse');
const log = require('../log');

/**
 * Optional local REST API for automation (Puppeteer / Playwright / Selenium).
 * Listens on 127.0.0.1 only and requires the token from Settings:
 *   Authorization: Bearer <token>    or    ?token=<token>
 *
 *   GET    /v1/profiles
 *   POST   /v1/profiles                  { name, group, tags, notes, proxy: "socks5://user:pass@host:port", startUrls }
 *   DELETE /v1/profiles/:id
 *   GET    /v1/profiles/:id/start?headless=1   -> { wsEndpoint, debugPort }
 *   GET    /v1/profiles/:id/stop
 *   GET    /v1/profiles/:id/cookies?format=json|netscape&domain=
 *   POST   /v1/profiles/:id/cookies       body = JSON or Netscape text
 */
let server = null;

function start() {
  stop();
  const cfg = store.settings.api;
  if (!cfg.enabled) return;
  server = http.createServer((req, res) => handle(req, res).catch((e) => send(res, 500, { error: e.message })));
  server.on('error', (e) => log.error('Local API error', e));
  server.listen(cfg.port, '127.0.0.1', () => log.info(`Local API listening on http://127.0.0.1:${cfg.port}`));
}

function stop() {
  if (server) {
    server.close();
    server = null;
  }
}

function send(res, code, body) {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json' });
  res.end(data);
}

function readBody(req, limit = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function authorized(req, url) {
  const expected = Buffer.from(store.settings.api.token);
  const header = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const given = Buffer.from(header || url.searchParams.get('token') || '');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

function profileOut(p) {
  const run = launcher.get(p.id);
  const proxy = store.getProxy(p.proxyId);
  return {
    id: p.id,
    name: p.name,
    group: p.group,
    tags: p.tags,
    notes: p.notes,
    proxy: proxy ? { id: proxy.id, type: proxy.type, host: proxy.host, port: proxy.port } : null,
    running: Boolean(run),
    wsEndpoint: run ? run.wsUrl : null,
  };
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  // Block browser pages from calling the API (CSRF): real API clients send no Origin.
  if (req.headers.origin && req.headers.origin !== 'null') return send(res, 403, { error: 'Forbidden origin' });
  if (!authorized(req, url)) return send(res, 401, { error: 'Invalid or missing token' });

  const parts = url.pathname.split('/').filter(Boolean); // v1, profiles, :id, action
  if (parts[0] !== 'v1' || parts[1] !== 'profiles') return send(res, 404, { error: 'Not found' });

  if (parts.length === 2) {
    if (req.method === 'GET') return send(res, 200, { data: store.listProfiles().map(profileOut) });
    if (req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      let proxyId = null;
      if (body.proxy) proxyId = store.findOrCreateProxy(parseProxy(body.proxy, body.proxyType || 'http')).id;
      const p = store.createProfile({ ...body, proxyId });
      return send(res, 201, { data: profileOut(p) });
    }
  }

  const profile = store.getProfile(parts[2]);
  if (!profile) return send(res, 404, { error: 'Profile not found' });
  const action = parts[3];

  if (!action && req.method === 'GET') return send(res, 200, { data: profileOut(profile) });
  if (!action && req.method === 'DELETE') {
    await launcher.stop(profile.id);
    store.deleteProfile(profile.id);
    return send(res, 200, { success: true });
  }
  if (action === 'start') {
    const headless = ['1', 'true'].includes(url.searchParams.get('headless') || '');
    const info = await launcher.start(profile.id, { headless });
    return send(res, 200, { success: true, wsEndpoint: info.wsEndpoint, debugPort: info.debugPort });
  }
  if (action === 'stop') {
    await launcher.stop(profile.id);
    return send(res, 200, { success: true });
  }
  if (action === 'cookies') {
    if (req.method === 'GET') {
      const out = await cookies.exportCookies(profile.id, {
        format: url.searchParams.get('format') || 'json',
        domain: url.searchParams.get('domain') || '',
      });
      return send(res, 200, out.text);
    }
    if (req.method === 'POST') {
      const r = await cookies.importCookies(profile.id, await readBody(req), { replace: url.searchParams.get('replace') === '1' });
      return send(res, 200, { success: true, ...r });
    }
  }
  return send(res, 404, { error: 'Not found' });
}

module.exports = { start, stop };
