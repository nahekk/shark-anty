import { baseDomain, activeTabUrl, getCookies, toJson, toNetscape, download, removeCookies } from './cookies.js';

const $ = (id) => document.getElementById(id);
const msg = (text, ok = true) => {
  const el = $('msg');
  el.textContent = text;
  el.className = `msg ${ok ? 'ok' : 'err'}`;
};
const stamp = () => new Date().toISOString().slice(0, 10);

let domain = null;

async function counts() {
  $('all-count').textContent = (await getCookies()).length;
  $('site-count').textContent = domain ? (await getCookies(domain)).length : 0;
}

async function init() {
  const url = await activeTabUrl();
  domain = url ? baseDomain(url.hostname) : null;
  $('site').textContent = domain || 'No website in this tab';
  for (const id of ['site-copy', 'site-json', 'site-txt', 'site-clear']) $(id).disabled = !domain;
  await counts();
}

async function copy(d) {
  const list = await getCookies(d);
  await navigator.clipboard.writeText(toJson(list));
  msg(`Copied ${list.length} cookies`);
}

async function save(d, kind) {
  const list = await getCookies(d);
  const name = `${d || 'profile'}-cookies-${stamp()}`;
  if (kind === 'json') download(toJson(list), `${name}.json`, 'application/json');
  else download(toNetscape(list), `${name}.txt`, 'text/plain');
  msg(`Saved ${list.length} cookies`);
}

$('site-copy').onclick = () => copy(domain).catch((e) => msg(e.message, false));
$('site-json').onclick = () => save(domain, 'json').catch((e) => msg(e.message, false));
$('site-txt').onclick = () => save(domain, 'txt').catch((e) => msg(e.message, false));
$('all-copy').onclick = () => copy(null).catch((e) => msg(e.message, false));
$('all-json').onclick = () => save(null, 'json').catch((e) => msg(e.message, false));
$('all-txt').onclick = () => save(null, 'txt').catch((e) => msg(e.message, false));
$('site-clear').onclick = async () => {
  if (!confirm(`Delete all cookies of ${domain}? You will be logged out of this site.`)) return;
  const list = await getCookies(domain);
  await removeCookies(list);
  msg(`Deleted ${list.length} cookies`);
  counts();
};
$('import').onclick = () => {
  const q = domain ? `?domain=${encodeURIComponent(domain)}` : '';
  chrome.tabs.create({ url: chrome.runtime.getURL(`import.html${q}`) });
  window.close();
};

init();
