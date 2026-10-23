'use strict';
const http = require('node:http');
const https = require('node:https');
const tls = require('node:tls');
const { connectThrough } = require('./upstream');

/**
 * Checks a proxy (or the direct connection when proxy is null) and returns
 * { ok, ip, country, countryCode, city, timezone, latency, at, error }.
 * Tries several free IP-info endpoints so one being down doesn't break checks.
 */
async function checkProxy(proxy, timeoutMs = 15000) {
  const started = Date.now();
  const services = [
    {
      secure: false,
      host: 'ip-api.com',
      path: '/json/?fields=status,message,country,countryCode,city,timezone,lat,lon,isp,org,as,proxy,hosting,mobile,query',
      map: (j) =>
        j.status === 'success'
          ? {
              ip: j.query, country: j.country, countryCode: j.countryCode, city: j.city, timezone: j.timezone, lat: j.lat, lon: j.lon,
              isp: j.isp, org: j.org, asn: j.as, category: classify(j.mobile, j.hosting),
            }
          : null,
    },
    {
      secure: true,
      host: 'ipwho.is',
      path: '/?fields=ip,country,country_code,city,timezone,latitude,longitude,connection',
      map: (j) =>
        j.success !== false && j.ip
          ? {
              ip: j.ip, country: j.country, countryCode: j.country_code, city: j.city, timezone: j.timezone && j.timezone.id, lat: j.latitude, lon: j.longitude,
              isp: j.connection && (j.connection.isp || j.connection.org), org: j.connection && j.connection.org, asn: j.connection && j.connection.asn ? 'AS' + j.connection.asn : undefined,
            }
          : null,
    },
    {
      secure: true,
      host: 'ipinfo.io',
      path: '/json',
      map: (j) => (j.ip ? { ip: j.ip, country: j.country, countryCode: j.country, city: j.city, timezone: j.timezone, lat: j.loc ? Number(j.loc.split(',')[0]) : undefined, lon: j.loc ? Number(j.loc.split(',')[1]) : undefined, isp: j.org, org: j.org } : null),
    },
  ];

  // Rough fallback from ip-api's own flags when proxycheck.io is unavailable.
  function classify(mobile, hosting) {
    if (mobile) return 'mobile';
    if (hosting) return 'datacenter';
    return 'residential';
  }

  let lastError = null;
  for (const svc of services) {
    try {
      const json = await fetchJson(proxy, svc, timeoutMs);
      const info = svc.map(json);
      if (info && info.ip) {
        // proxycheck.io is built for classifying proxy exit IPs; it is far more
        // accurate than the hosting/mobile flags, so prefer it when it answers.
        const better = await classifyWithProxyCheck(info.ip).catch(() => null);
        if (better) info.category = better;
        return { ok: true, ...info, latency: Date.now() - started, at: Date.now(), error: null };
      }
    } catch (e) {
      lastError = e;
      // An auth/connection failure is the proxy's fault - no point trying other services.
      if (/authentication|refused|ECONNREFUSED|EHOSTUNREACH|ENOTFOUND|407/i.test(e.message)) break;
    }
  }
  return { ok: false, latency: null, at: Date.now(), error: lastError ? lastError.message : 'No response' };
}

// Queries proxycheck.io for one IP (directly, not through the proxy) and maps
// its "type" to our proxy kind. Returns null if it cannot classify.
function classifyWithProxyCheck(ip) {
  return new Promise((resolve) => {
    const req = https.request(
      { host: 'proxycheck.io', path: `/v2/${ip}?vpn=3&asn=1`, method: 'GET', timeout: 8000, headers: { 'User-Agent': 'SharkAnty' } },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (d) => (body += d.length > 1e5 ? '' : d));
        res.on('end', () => {
          try {
            const j = JSON.parse(body);
            const rec = j[ip] || j[Object.keys(j).find((k) => k !== 'status' && k !== 'node')];
            resolve(mapProxyCheckType(rec && rec.type));
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
    req.end();
  });
}

function mapProxyCheckType(type) {
  const t = String(type || '').toLowerCase();
  if (!t) return null;
  if (t.includes('residential')) return 'residential';
  if (t.includes('wireless') || t.includes('mobile') || t.includes('cellular')) return 'mobile';
  if (t.includes('hosting') || t.includes('data center') || t.includes('datacenter') || t.includes('vpn') || t.includes('tor') || t.includes('proxy') || t.includes('compromised')) return 'datacenter';
  if (t.includes('business') || t.includes('education') || t.includes('government') || t.includes('isp')) return 'isp';
  return null;
}

function fetchJson(proxy, svc, timeoutMs) {
  return new Promise((resolve, reject) => {
    const mod = svc.secure ? https : http;
    const port = svc.secure ? 443 : 80;
    // A custom Agent is required: with `agent: false` Node ignores
    // `createConnection` and dials the host directly, which would report the
    // local IP instead of the proxy's. The Agent's createConnection IS honored.
    const agent = new mod.Agent({ keepAlive: false, maxSockets: 1 });
    agent.createConnection = (_opts, cb) => {
      connectThrough(proxy, svc.host, port, timeoutMs).then(
        (sock) => cb(null, svc.secure ? tls.connect({ socket: sock, servername: svc.host }) : sock),
        (err) => cb(err),
      );
    };
    const req = mod.request(
      {
        host: svc.host,
        port,
        path: svc.path,
        method: 'GET',
        headers: { 'User-Agent': 'SharkAnty-ProxyCheck/1.0', Accept: 'application/json', Connection: 'close' },
        agent,
        timeout: timeoutMs,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (d) => {
          body += d;
          if (body.length > 1e6) req.destroy(new Error('Response too large'));
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error(`Bad response from ${svc.host} (HTTP ${res.statusCode})`));
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('Timed out')));
    req.on('error', reject);
    req.end();
  });
}

module.exports = { checkProxy };
