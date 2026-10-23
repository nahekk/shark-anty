import { parseCookies, importCookies, getCookies, removeCookies, baseDomain } from './cookies.js';

const $ = (id) => document.getElementById(id);
const msg = (text, ok = true) => {
  $('msg').textContent = text;
  $('msg').className = `msg ${ok ? 'ok' : 'err'}`;
};

$('file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  $('text').value = await f.text();
  msg(`Loaded ${f.name}`);
});

$('go').addEventListener('click', async () => {
  let list;
  try {
    list = parseCookies($('text').value);
  } catch (e) {
    return msg(e.message, false);
  }
  $('go').disabled = true;
  try {
    if ($('replace').checked) {
      const domains = new Set(list.map((c) => baseDomain(c.domain.replace(/^\./, ''))));
      for (const d of domains) await removeCookies(await getCookies(d));
    }
    const r = await importCookies(list);
    msg(r.failed ? `Imported ${r.ok} cookies, ${r.failed} rejected by the browser` : `Imported ${r.ok} cookies ✓  - reload the site to use them.`, r.ok > 0);
  } catch (e) {
    msg(e.message, false);
  } finally {
    $('go').disabled = false;
  }
});
