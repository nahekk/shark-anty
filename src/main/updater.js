'use strict';
const { app } = require('electron');
const { UPDATE_FEED, WEBSITE } = require('./config');

function cmp(a, b) {
  const pa = String(a).replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

/**
 * Checks the website update feed for a newer Shark{anty} version. The feed is a
 * JSON file you host yourself:  { "version": "1.3.0", "url": "...", "notes": "..." }
 */
async function checkForUpdate() {
  const res = await fetch(`${UPDATE_FEED}?t=${Date.now()}`, {
    headers: { 'User-Agent': 'SharkAnty', Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Update feed returned HTTP ${res.status}`);
  const feed = await res.json();
  const latest = String(feed.version || '').replace(/^v/, '');
  const current = app.getVersion();
  return {
    current,
    latest,
    available: Boolean(latest) && cmp(latest, current) > 0,
    url: feed.url || WEBSITE,
    notes: feed.notes || '',
  };
}

module.exports = { checkForUpdate };
