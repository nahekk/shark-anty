'use strict';
const launcher = require('../browser/launcher');
const formats = require('./formats');
const log = require('../log');

/**
 * Reads/writes cookies of a profile through the DevTools protocol, so the
 * browser itself handles cookie encryption. If the profile is closed it is
 * started headless (invisible) for a moment and closed again.
 */
async function withProfile(id, fn) {
  const wasRunning = launcher.isRunning(id);
  if (!wasRunning) await launcher.start(id, { headless: true });
  let cdp;
  try {
    cdp = await launcher.connect(id);
    return await fn(cdp);
  } finally {
    if (cdp) cdp.close();
    if (!wasRunning) await launcher.stop(id).catch((e) => log.warn('Headless stop failed', e.message));
  }
}

async function exportCookies(id, { format = 'json', domain = '' } = {}) {
  const raw = await withProfile(id, async (cdp) => (await cdp.send('Storage.getCookies')).cookies || []);
  const cookies = formats.filterByDomain(raw.map(formats.fromCdp), domain);
  const text = format === 'netscape' ? formats.toNetscape(cookies) : formats.toJson(cookies);
  return { count: cookies.length, text };
}

async function importCookies(id, text, { replace = false } = {}) {
  const parsed = formats.parseCookies(text);
  const params = parsed.map(formats.toCdpParam);
  return withProfile(id, async (cdp) => {
    if (replace) await cdp.send('Storage.clearCookies');
    // Try the whole batch first; if Chromium rejects it, fall back to one-by-one
    // so a single bad cookie doesn't block the rest.
    try {
      await cdp.send('Storage.setCookies', { cookies: params });
      return { imported: params.length, failed: 0 };
    } catch (e) {
      log.warn('Batch cookie import failed, retrying individually:', e.message);
    }
    let imported = 0;
    let failed = 0;
    for (const p of params) {
      try {
        await cdp.send('Storage.setCookies', { cookies: [p] });
        imported++;
      } catch {
        failed++;
      }
    }
    return { imported, failed };
  });
}

async function clearCookies(id) {
  return withProfile(id, (cdp) => cdp.send('Storage.clearCookies'));
}

module.exports = { exportCookies, importCookies, clearCookies };
