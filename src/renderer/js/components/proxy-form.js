import { h, api, icon, clear } from '../ui.js';
import { t } from '../i18n.js';

export const CAT_COLORS = { residential: '#22c55e', isp: '#3b82f6', datacenter: '#f97316', mobile: '#a855f7', unknown: '#8b8b8b' };

export function categoryBadge(cat) {
  const c = cat && CAT_COLORS[cat] ? cat : 'unknown';
  return h('span', { class: 'cat-badge', style: { color: CAT_COLORS[c], borderColor: CAT_COLORS[c] } }, t(`cat.${c}`));
}

// A dropdown to correct the auto-detected proxy kind; saves on change.
export function categorySelect(proxy, onChange = () => {}) {
  const cats = ['residential', 'isp', 'datacenter', 'mobile', 'unknown'];
  const sel = h(
    'select',
    {
      class: 'input',
      style: { width: 'auto' },
      onchange: async (e) => {
        try {
          await api('proxies:setCategory', proxy.id, e.target.value);
          onChange(e.target.value);
        } catch {}
      },
    },
    cats.map((c) => h('option', { value: c, selected: (proxy.category || 'unknown') === c }, t(`cat.${c}`))),
  );
  return sel;
}

export function uriOf(p) {
  if (!p) return '';
  const auth = p.username ? `${encodeURIComponent(p.username)}:${encodeURIComponent(p.password || '')}@` : '';
  const host = p.host.includes(':') ? `[${p.host}]` : p.host;
  return `${p.type}://${auth}${host}:${p.port}`;
}

/**
 * One field: paste a proxy URI, it is parsed, saved and checked automatically.
 * onResolved(proxy) fires with the saved proxy after a successful check.
 */
export function proxyPasteField({ initialProxy = null, onResolved = () => {}, placeholder } = {}) {
  let proxy = initialProxy;
  const type = h(
    'select',
    { class: 'input', style: { width: '92px', flexShrink: 0 } },
    ['socks5', 'http', 'socks4'].map((v) => h('option', { value: v }, v.toUpperCase())),
  );
  const input = h('input', {
    class: 'input mono grow',
    value: initialProxy ? uriOf(initialProxy) : '',
    placeholder: placeholder || t('editor.proxy.uriPh'),
    spellcheck: 'false',
  });
  const result = h('div', { class: 'check-result' });
  const btn = h('button', { class: 'btn ghost', type: 'button', onclick: run }, icon('shield', 15), t('common.check'));

  if (initialProxy && initialProxy.lastCheck) showCheck(result, initialProxy.lastCheck, false, initialProxy);

  async function run() {
    const raw = input.value.trim();
    if (!raw) {
      proxy = null;
      clear(result);
      onResolved(null);
      return;
    }
    btn.disabled = true;
    showCheck(result, null, true);
    try {
      const r = await api('proxies:add', raw, type.value);
      proxy = r.proxy;
      input.value = uriOf(proxy);
      showCheck(result, r.check, false, proxy);
      onResolved(proxy);
    } catch (e) {
      proxy = null;
      showCheck(result, { ok: false, error: e.message });
      onResolved(null);
    } finally {
      btn.disabled = false;
    }
  }

  let pasteTimer;
  input.addEventListener('paste', () => {
    clearTimeout(pasteTimer);
    pasteTimer = setTimeout(run, 60);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      run();
    }
  });
  input.addEventListener('blur', () => {
    if (input.value.trim() && (!proxy || uriOf(proxy) !== input.value.trim())) run();
  });

  const el = h('div', { class: 'col', style: { gap: '8px' } }, h('div', { class: 'row', style: { alignItems: 'stretch' } }, type, input, btn), result);
  return { el, getProxy: () => proxy, run };
}

export function showCheck(el, res, loading = false, proxy = null) {
  clear(el);
  el.className = 'check-result';
  if (loading) {
    el.classList.add('loading');
    el.append(h('span', { class: 'spinner' }), t('check.running'));
    return;
  }
  if (!res) return;
  if (res.ok) {
    el.classList.add('ok');
    el.append(
      icon('check', 15),
      categoryBadge(res.category || (proxy && proxy.category)),
      h('span', null, t('check.ok', { ip: res.ip, country: [res.city, res.country].filter(Boolean).join(', ') || res.countryCode || '?', ms: res.latency })),
      res.isp ? h('span', { class: 'muted small ellipsis' }, `· ${res.isp}`) : null,
    );
  } else {
    el.classList.add('fail');
    el.append(icon('x', 15), t('check.fail', { error: res.error || '?' }));
  }
}
