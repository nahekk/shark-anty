import { h, api, field, icon, modal, toast, toastError, clear, debounce, PROFILE_COLORS } from '../ui.js';
import { t } from '../i18n.js';
import { state, refresh, groups, proxyById } from '../state.js';
import { proxyPasteField, categoryBadge, uriOf } from '../components/proxy-form.js';
import { cookiesDialog } from '../components/profile-dialogs.js';

let metaCache = null;
async function fpMeta() {
  if (!metaCache) metaCache = await api('fingerprint:meta');
  return metaCache;
}

const PROFILE_TYPES = [
  ['none', 'None', ''],
  ['fb', 'FB', 'https://facebook.com'],
  ['google', 'Google', 'https://google.com'],
  ['tiktok', 'TikTok', 'https://tiktok.com'],
  ['crypto', 'Crypto', 'https://binance.com'],
];

// Opens the profile editor popup. profile = null → create.
export function ProfileEditor(profile = null) {
  const isNew = !profile;
  // For a new profile, pre-fill the most recently added proxy (auto-paste).
  const recentProxy = isNew && state.proxies.length ? [...state.proxies].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] : null;
  const p = profile || { name: '', group: '', tags: [], notes: '', color: '', startUrls: [], proxyId: null, fingerprint: null };
  let fp = p.fingerprint ? { ...p.fingerprint } : null;
  let proxyMode = p.proxyId ? 'saved' : recentProxy ? 'new' : 'none';
  let selectedProxy = p.proxyId ? proxyById(p.proxyId) : recentProxy;

  // ---------- shell ----------
  const summary = h('div', { class: 'overview' });
  const formGeneral = h('div', { class: 'editor-pane' });
  const formAdvanced = h('div', { class: 'editor-pane', style: { display: 'none' } });
  const tabs = h('div', { class: 'tabs' });
  let activeTab = 'general';
  const makeTab = (id, pane) =>
    h('button', {
      class: `tab${id === activeTab ? ' active' : ''}`,
      type: 'button',
      onclick: (e) => {
        activeTab = id;
        tabs.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        formGeneral.style.display = id === 'general' ? '' : 'none';
        formAdvanced.style.display = id === 'advanced' ? '' : 'none';
      },
    }, t(`editor.tab.${id}`));
  tabs.append(makeTab('general'), makeTab('advanced'));

  const body = h(
    'div',
    { class: 'editor-modal' },
    tabs,
    h('div', { class: 'editor-grid' }, h('div', { class: 'editor-form' }, formGeneral, formAdvanced), h('aside', { class: 'editor-summary' }, h('div', { class: 'summary-head' }, h('h3', null, t('editor.summary'))), summary)),
  );

  // ---------- General ----------
  const name = h('input', { class: 'input', value: p.name, placeholder: isNew ? nextName() : '', oninput: () => updateSummary() });
  const group = h('input', { class: 'input', value: p.group || '', placeholder: t('editor.groupPh'), list: 'groups-dl' });
  const tags = h('input', { class: 'input', value: (p.tags || []).join(', '), placeholder: t('editor.tagsPh') });
  const notes = h('textarea', { class: 'input', rows: 2 });
  notes.value = p.notes || '';
  let color = p.color || '';
  const swatches = h(
    'div',
    { class: 'swatches' },
    PROFILE_COLORS.map((c) =>
      h('button', {
        type: 'button',
        class: `swatch${c === color ? ' active' : ''}${c ? '' : ' none'}`,
        style: c ? { background: c, borderColor: c } : null,
        onclick: (e) => {
          color = c;
          swatches.querySelectorAll('.swatch').forEach((s) => s.classList.remove('active'));
          e.currentTarget.classList.add('active');
        },
      }),
    ),
  );

  const startUrls = h('textarea', { class: 'input mono', rows: 2, placeholder: t('editor.startUrlsPh'), spellcheck: 'false' });
  startUrls.value = (p.startUrls || []).join('\n');
  const typeRow = h(
    'div',
    { class: 'type-row' },
    PROFILE_TYPES.map(([id, label, url]) =>
      h('button', {
        type: 'button',
        class: 'type-btn',
        onclick: (e) => {
          typeRow.querySelectorAll('.type-btn').forEach((b) => b.classList.remove('active'));
          e.currentTarget.classList.add('active');
          if (url) {
            const lines = startUrls.value.split('\n').map((l) => l.trim()).filter(Boolean);
            if (!lines.includes(url)) startUrls.value = [url, ...lines].join('\n');
          }
        },
      }, label),
    ),
  );

  // Proxy
  const proxyPanes = h('div');
  const savedSelect = h(
    'select',
    { class: 'input', onchange: () => { selectedProxy = proxyById(savedSelect.value); updateSummary(); } },
    h('option', { value: '' }, `— ${t('editor.proxy.pick')} —`),
    state.proxies.map((x) => h('option', { value: x.id, selected: selectedProxy && x.id === x.id && selectedProxy.id === x.id }, `${x.type.toUpperCase()}  ${x.name}${x.lastCheck && x.lastCheck.ok ? `  ${x.lastCheck.countryCode || ''}` : ''}`)),
  );
  if (selectedProxy && proxyMode === 'saved') savedSelect.value = selectedProxy.id;
  const pasteField = proxyPasteField({
    initialProxy: proxyMode === 'new' ? selectedProxy : null,
    onResolved: (proxy) => {
      selectedProxy = proxy;
      if (proxy) toast(t('editor.proxy.autosaved'), 'success', 1500);
      refresh();
      updateSummary();
    },
  });
  function renderProxyPane() {
    clear(proxyPanes);
    if (proxyMode === 'none') proxyPanes.append(h('div', { class: 'muted small' }, t('editor.proxy.direct')));
    else if (proxyMode === 'new') proxyPanes.append(pasteField.el);
    else proxyPanes.append(state.proxies.length ? savedSelect : h('div', { class: 'muted small' }, t('editor.proxy.noneSaved')));
  }
  const proxySeg = h(
    'div',
    { class: 'segmented' },
    ['none', 'new', 'saved'].map((m) =>
      h('button', {
        type: 'button',
        class: m === proxyMode ? 'active' : '',
        onclick: (e) => {
          proxyMode = m;
          proxySeg.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
          e.currentTarget.classList.add('active');
          if (m === 'none') selectedProxy = null;
          else if (m === 'new') selectedProxy = pasteField.getProxy();
          else selectedProxy = proxyById(savedSelect.value);
          renderProxyPane();
          updateSummary();
        },
      }, t(`editor.proxy.${m}`)),
    ),
  );
  renderProxyPane();

  // Cookies
  const cookieText = h('textarea', { class: 'input mono', rows: 4, placeholder: t('cookies.importPh'), spellcheck: 'false' });
  const cookieBox = isNew
    ? h('div', { class: 'col', style: { gap: '8px' } },
        h('div', { class: 'muted small' }, t('editor.cookiesHint')),
        cookieText,
        h('button', { class: 'btn ghost sm', type: 'button', onclick: loadCookieFile }, icon('upload', 14), t('common.browse')))
    : h('button', { class: 'btn ghost', type: 'button', onclick: () => cookiesDialog(profile) }, icon('cookie', 15), t('editor.cookiesManage'));
  async function loadCookieFile() {
    try {
      const f = await api('cookies:openFile');
      if (f) cookieText.value = f.text;
    } catch (e) {
      toastError(e);
    }
  }

  const card = (title, ...children) => h('section', { class: 'ed-card' }, h('div', { class: 'ed-card-title' }, title), h('div', { class: 'ed-card-body' }, children));
  formGeneral.append(
    h('datalist', { id: 'groups-dl' }, groups().map((g) => h('option', { value: g }))),
    card(t('editor.name'),
      h('div', { class: 'grid2' }, field(t('editor.name'), name), field(t('editor.group'), group), field(t('editor.tags'), tags), field(t('editor.color'), swatches))),
    card(t('editor.profileType'), typeRow, field(t('editor.startUrls'), startUrls)),
    card(t('editor.proxy'), proxySeg, proxyPanes),
    card(t('editor.cookies'), cookieBox),
  );

  // ---------- Advanced (fingerprint) ----------
  renderAdvanced();
  async function renderAdvanced() {
    const meta = await fpMeta();
    if (!fp) fp = await api('fingerprint:random', meta.realOs);
    clear(formAdvanced);

    const set = (k, v) => { fp[k] = v; updateSummary(); };
    const sel = (value, options, onChange) =>
      h('select', { class: 'input', onchange: (e) => onChange(e.target.value) }, options.map(([v, label]) => h('option', { value: v, selected: String(v) === String(value) }, label)));
    const modeSel = (key, options) => sel(fp[key], options, (v) => set(key, v));
    const noiseReal = (key) => modeSel(key, [['noise', t('common.noise')], ['real', t('common.real')]]);

    const enabledToggle = h('label', { class: 'toggle' },
      h('input', { type: 'checkbox', checked: fp.enabled, onchange: (e) => {
        fp.enabled = e.target.checked;
        formAdvanced.classList.toggle('fp-off', !fp.enabled);
        offNote.style.display = fp.enabled ? 'none' : '';
        updateSummary();
      } }),
      h('span', { class: 'toggle-track' }, h('span', { class: 'toggle-thumb' })),
      h('span', null, t('fp.enabled')));
    const offNote = h('div', { class: 'muted small', style: { display: fp.enabled ? 'none' : '' } }, t('fp.off'));
    const newBtn = h('button', { class: 'btn ghost sm', type: 'button', onclick: async () => { fp = { ...(await api('fingerprint:random', fp.os)), enabled: true }; renderAdvanced(); } }, icon('dice', 14), t('fp.new'));

    const gpus = meta.gpus[fp.os] || [];
    const gpuOptions = gpus.map((g) => [g.renderer, g.renderer.replace(/^ANGLE \(/, '').replace(/\)$/, '').slice(0, 60)]);
    if (fp.webglRenderer && !gpus.find((g) => g.renderer === fp.webglRenderer)) gpuOptions.unshift([fp.webglRenderer, fp.webglRenderer.slice(0, 60)]);
    const tzList = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
    const screens = meta.screens[fp.os] || meta.screens.windows;

    formAdvanced.className = `editor-pane${fp.enabled ? '' : ' fp-off'}`;
    formAdvanced.append(
      h('div', { class: 'fp-head' }, enabledToggle, h('div', { class: 'grow' }), newBtn),
      offNote,
      h('div', { class: 'fp-fields col', style: { gap: '12px' } },
        card(t('fp.os'),
          h('div', { class: 'grid2' },
            field(t('fp.os'), sel(fp.os, meta.os.map((o) => [o.id, o.label]), async (v) => { fp = { ...(await api('fingerprint:random', v)), enabled: fp.enabled, timezone: fp.timezone, language: fp.language, geolocation: fp.geolocation, webrtc: fp.webrtc }; renderAdvanced(); }), fp.os !== meta.realOs ? t('fp.osWarn') : null),
            field(t('fp.ua'), h('input', { class: 'input mono', value: fp.userAgent || '', placeholder: t('fp.uaAuto', { v: state.engine.major || '' }), oninput: debounce((e) => set('userAgent', e.target.value.trim()), 250) }))),
        ),
        card(t('fp.hardwareMain'),
          h('div', { class: 'grid2' },
            field(t('fp.webrtc'), modeSel('webrtc', ['proxy', 'real', 'disabled'].map((v) => [v, t(`fp.webrtc.${v}`)]))),
            field(t('fp.canvas'), noiseReal('canvas')),
            field(t('fp.webgl'), noiseReal('webglImage')),
            field(t('fp.webgpu'), modeSel('webgpu', [['noise', t('common.masked')], ['real', t('common.real')], ['block', t('common.block')]])),
            field(t('fp.clientRects'), noiseReal('clientRects'))),
          field(t('fp.webglInfo'), h('div', { class: 'grid2' },
            field(t('fp.vendor'), sel(fp.webglInfo, [['custom', t('fp.custom')], ['real', t('common.real')]], (v) => set('webglInfo', v))),
            field(t('fp.renderer'), sel(fp.webglRenderer, gpuOptions, (v) => { const g = gpus.find((x) => x.renderer === v); fp.webglVendor = g ? g.vendor : fp.webglVendor; set('webglRenderer', v); })))),
        ),
        card(t('fp.general'),
          h('div', { class: 'grid3' },
            field(t('fp.timezone'), sel(fp.timezone, [['ip', t('fp.ip')], ['real', t('common.real')], ...tzList.map((z) => [z, z])], (v) => set('timezone', v))),
            field(t('fp.language'), sel(fp.language, [['ip', t('fp.ip')], ['real', t('common.real')], ...meta.languages.map((l) => [l, l])], (v) => set('language', v))),
            field(t('fp.geo'), sel(fp.geolocation, [['ip', t('fp.ip')], ['ask', t('fp.ask')], ['block', t('common.block')]], (v) => set('geolocation', v)))),
        ),
        card(t('fp.hardwareExtra'),
          h('div', { class: 'grid3' },
            field(t('fp.cpu'), sel(fp.cpu, [['real', t('common.real')], ...meta.cpu.map((c) => [c, String(c)])], (v) => set('cpu', v === 'real' ? v : Number(v)))),
            field(t('fp.memory'), sel(fp.memory, [['real', t('common.real')], ...meta.memory.map((m) => [m, String(m)])], (v) => set('memory', v === 'real' ? v : Number(v)))),
            field(t('fp.audio'), noiseReal('audio')),
            field(t('fp.fonts'), modeSel('fonts', [['mask', t('common.masked')], ['real', t('common.real')]])),
            field(t('fp.mac'), h('div', { class: 'input-wrap' }, h('input', { class: 'input mono', value: fp.macAddress || '', oninput: (e) => set('macAddress', e.target.value) }), h('button', { class: 'icon-btn inset', type: 'button', title: t('fp.randomMac'), onclick: async () => { fp.macAddress = (await api('fingerprint:random', fp.os)).macAddress; renderAdvanced(); } }, icon('dice', 14)))),
            field(t('fp.deviceName'), h('input', { class: 'input', value: fp.deviceName || '', oninput: (e) => set('deviceName', e.target.value) }))),
        ),
        card(t('fp.screenMedia'),
          h('div', { class: 'grid2' },
            field(t('fp.screen'), sel(fp.screen, [['real', t('common.real')], ...[...new Set([fp.screen, ...screens])].filter((s) => s !== 'real').map((s) => [s, s.replace('x', ' × ')])], (v) => set('screen', v))),
            field(t('fp.mediaDevices'), noiseReal('mediaDevices'))),
        ),
        card(t('fp.extra'),
          h('div', { class: 'grid2' },
            field(t('fp.portsProtect'), h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: fp.portsProtection, onchange: (e) => set('portsProtection', e.target.checked) }), h('span', { class: 'toggle-track' }, h('span', { class: 'toggle-thumb' })), h('span', null, t('common.on')))),
            field(t('fp.dnt'), h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: fp.doNotTrack, onchange: (e) => set('doNotTrack', e.target.checked) }), h('span', { class: 'toggle-track' }, h('span', { class: 'toggle-thumb' })), h('span', null, t('common.on')))),
            field(t('fp.hideName'), h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: fp.hideNameInBrowser, onchange: (e) => set('hideNameInBrowser', e.target.checked) }), h('span', { class: 'toggle-track' }, h('span', { class: 'toggle-thumb' })), h('span', null, t('common.on'))))),
          field(t('fp.ports'), h('input', { class: 'input mono', value: fp.ports || '', oninput: (e) => set('ports', e.target.value) })),
          field(t('fp.cmd'), (() => { const ta = h('textarea', { class: 'input mono', rows: 2, placeholder: t('fp.cmdPh'), spellcheck: 'false', oninput: (e) => (fp.commandSwitches = e.target.value) }); ta.value = fp.commandSwitches || ''; return ta; })()),
        ),
      ),
    );
    updateSummary();
  }

  // ---------- summary ----------
  function currentProxy() {
    if (proxyMode === 'saved') return proxyById(savedSelect.value);
    if (proxyMode === 'new') return pasteField.getProxy();
    return null;
  }
  const updateSummary = debounce(async () => {
    if (!fp) return;
    const proxy = currentProxy();
    const lc = proxy && proxy.lastCheck && proxy.lastCheck.ok ? proxy.lastCheck : null;
    let r = null;
    try {
      r = await api('fingerprint:preview', fp, proxy ? { lastCheck: lc } : null);
    } catch {}
    const real = t('common.real');
    const rows = [];
    const row = (label, value, mono) => rows.push(h('div', { class: 'ov-row' }, h('div', { class: 'ov-label' }, label), h('div', { class: `ov-value${mono ? ' mono' : ''}` }, value)));
    const ipDep = (value, from) => value || (from === 'ip' ? (proxy ? (lc ? '-' : h('span', { class: 'muted' }, t('ov.checkProxy'))) : real) : real);

    if (!isNew) row(t('ov.id'), h('span', { class: 'mono' }, String(profile.id).slice(0, 8)));
    row(t('ov.name'), name.value || h('span', { class: 'muted' }, '—'));
    row(t('ov.browser'), state.engine.ready ? `Chromium ${state.engine.version}` : '—');
    row(t('ov.proxy'), proxy ? h('span', { class: 'row center', style: { gap: '6px' } }, `${proxy.type.toUpperCase()} ${proxy.host}:${proxy.port}`, categoryBadge(proxy.category)) : t('profiles.noProxy'));
    row(t('ov.ip'), lc ? `${lc.ip} · ${[lc.city, lc.countryCode].filter(Boolean).join(', ')}` : proxy ? h('span', { class: 'muted' }, t('ov.checkProxy')) : real);
    if (!fp.enabled || !r) {
      row(t('fp.title'), h('span', { class: 'muted' }, t('fp.off')));
    } else {
      row(t('ov.platform'), { windows: 'Windows 11', macos: 'macOS', linux: 'Linux' }[fp.os]);
      row(t('ov.ua'), r.userAgent || h('span', { class: 'muted' }, t('fp.uaAuto', { v: state.engine.major || '' })), Boolean(r.userAgent));
      row(t('ov.webgl'), r.webgl ? h('span', null, h('div', null, r.webgl.vendor), h('div', { class: 'muted' }, r.webgl.renderer.replace(/^ANGLE \(/, '').replace(/\)$/, ''))) : real);
      row(t('ov.cpu'), r.hardwareConcurrency ? `${r.hardwareConcurrency} cores` : real);
      row(t('ov.memory'), r.deviceMemory ? `${r.deviceMemory} GB` : real);
      row(t('ov.screen'), r.screen ? `${r.screen.width} × ${r.screen.height}` : real);
      row(t('ov.timezone'), ipDep(r.timezone, fp.timezone));
      row(t('ov.language'), ipDep(r.locale, fp.language));
      row(t('ov.geo'), fp.geolocation === 'block' ? t('common.block') : fp.geolocation === 'ask' ? t('fp.ask') : ipDep(r.geo ? `${r.geo.latitude.toFixed(3)}, ${r.geo.longitude.toFixed(3)}` : null, 'ip'));
      row(t('ov.webrtc'), t(`fp.webrtc.${fp.webrtc}`));
      row(t('ov.noise'), `${fp.canvas === 'noise' ? t('common.noise') : real} / ${fp.audio === 'noise' ? t('common.noise') : real}`);
    }
    clear(summary).append(...rows);
  }, 100);

  // ---------- save ----------
  const saveBtn = h('button', { class: 'btn primary', onclick: save }, isNew ? t('common.create') : t('common.save'));
  const m = modal({
    title: isNew ? t('editor.new') : t('editor.edit'),
    width: 1080,
    body,
    footer: [h('button', { class: 'btn ghost', onclick: () => m.close() }, t('common.cancel')), saveBtn],
  });
  m.el.classList.add('editor-dialog');
  setTimeout(() => name.focus(), 50);

  async function save() {
    let proxy = { mode: 'none' };
    if (proxyMode === 'saved') {
      if (!savedSelect.value) return toast(t('editor.proxy.pick'), 'error');
      proxy = { mode: 'saved', proxyId: savedSelect.value };
    } else if (proxyMode === 'new') {
      const pr = pasteField.getProxy();
      if (pr) proxy = { mode: 'saved', proxyId: pr.id };
    }
    const input = { name: name.value.trim() || (isNew ? nextName() : p.name), group: group.value.trim(), tags: tags.value, notes: notes.value, color, startUrls: startUrls.value, fingerprint: fp, proxy };
    saveBtn.disabled = true;
    try {
      if (isNew) {
        const created = await api('profiles:create', input);
        toast(t('profiles.created', { name: created.name }), 'success');
        m.close();
        await refresh();
        if (cookieText.value.trim()) {
          try {
            const r = await api('cookies:import', created.id, cookieText.value, {});
            toast(r.failed ? t('cookies.importedFailed', { n: r.imported, f: r.failed }) : t('cookies.imported', { n: r.imported }), 'success');
          } catch (e) {
            toastError(e);
          }
        }
      } else {
        await api('profiles:update', profile.id, input);
        toast(t('profiles.updated'), 'success');
        m.close();
        refresh();
      }
    } catch (e) {
      toastError(e);
    } finally {
      saveBtn.disabled = false;
    }
  }

  updateSummary();
}

function nextName() {
  const used = new Set(state.profiles.map((p) => p.name));
  let n = state.profiles.length + 1;
  while (used.has(`Profile ${n}`)) n++;
  return `Profile ${n}`;
}
