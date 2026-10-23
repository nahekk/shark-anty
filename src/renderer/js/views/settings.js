import { h, api, icon, toast, toastError, field, clear, toggle, debounce, duration } from '../ui.js';
import { t, getLanguage, languages } from '../i18n.js';
import { state, refresh } from '../state.js';
import { installEngine, progressText, progressBar } from '../components/engine-banner.js';

export function SettingsView(app) {
  const s = () => state.settings;
  const save = async (patch) => {
    try {
      state.settings = await api('settings:update', patch);
    } catch (e) {
      toastError(e);
    }
  };
  const saveLater = debounce(save, 400);

  const section = (iconName, title, ...children) =>
    h('section', { class: 'card' }, h('div', { class: 'card-head' }, icon(iconName, 16), h('h2', null, title)), h('div', { class: 'card-body' }, children));
  const seg = (value, options, onPick) =>
    h(
      'div',
      { class: 'segmented' },
      options.map(([v, label]) => h('button', { class: v === value ? 'active' : '', onclick: () => v !== value && onPick(v) }, label)),
    );

  // ---------------- appearance ----------------
  const appearance = section(
    'sun',
    t('settings.appearance'),
    h('div', { class: 'settings-row' }, h('span', { class: 'label' }, t('settings.language')), seg(getLanguage(), languages(), (v) => app.setLanguage(v))),
    h(
      'div',
      { class: 'settings-row' },
      h('span', { class: 'label' }, t('settings.theme')),
      seg(s().theme === 'light' ? 'light' : 'dark', [['dark', t('common.dark')], ['light', t('common.light')]], async (v) => {
        await app.setTheme(v);
        app.go('settings');
      }),
    ),
  );

  // ---------------- general ----------------
  const general = section(
    'settings',
    t('settings.general'),
    toggle(s().closeToTray, (v) => save({ closeToTray: v }), t('settings.closeToTray')),
    toggle(s().webrtcProtection, (v) => save({ webrtcProtection: v }), t('settings.webrtc')),
  );

  // ---------------- engine ----------------
  const engineBox = h('div', { class: 'col', style: { gap: '10px' } });
  let latestInfo = null;
  function renderEngine() {
    clear(engineBox);
    const eng = state.engine;
    const prog = state.engineProgress;
    const cards = h(
      'div',
      { class: 'engine-cards' },
      (eng.sources || []).map((src) => {
        const inst = eng.installed && eng.installed[src.id];
        return h(
          'button',
          {
            class: `engine-card${eng.source === src.id ? ' active' : ''}`,
            disabled: Boolean(prog),
            onclick: async () => {
              state.engine = src.id === 'custom' && !s().engine.customPath ? await api('engine:pickCustom') : await api('engine:setSource', src.id);
              latestInfo = null;
              await refresh();
            },
          },
          h('div', { class: 'engine-card-title' }, h('span', { class: 'radio' }), src.label),
          h('div', { class: 'muted small' }, t(`engine.${src.id}.desc`)),
          src.id === 'custom'
            ? h('div', { class: 'mono small ellipsis muted' }, s().engine.customPath || '-')
            : h('div', { class: `small ${inst ? 'ok-text' : 'muted'}` }, inst ? t('settings.engine.installed', { version: inst.chromeVersion || inst.version }) : t('settings.engine.notInstalled')),
        );
      }),
    );
    const status = h(
      'div',
      { class: 'engine-status' },
      prog
        ? h('div', { class: 'grow' }, h('div', null, progressText(prog)), progressBar(prog))
        : h(
            'div',
            { class: 'grow' },
            h('div', null, eng.ready ? t('engine.ready', { version: eng.version }) : t('settings.engine.notInstalled')),
            latestInfo ? h('div', { class: 'muted small' }, latestInfo.update ? t('settings.engine.latest', { version: latestInfo.latest }) : t('settings.engine.upToDate')) : null,
          ),
      eng.source === 'custom'
        ? h('button', { class: 'btn ghost', onclick: async () => ((state.engine = await api('engine:pickCustom')), refresh()) }, icon('folder', 15), t('settings.engine.pick'))
        : [
            h(
              'button',
              {
                class: 'btn ghost',
                disabled: Boolean(prog),
                onclick: async (e) => {
                  e.currentTarget.disabled = true;
                  try {
                    latestInfo = await api('engine:checkUpdate');
                  } catch (err) {
                    toastError(err);
                  }
                  renderEngine();
                },
              },
              t('settings.engine.checkUpdate'),
            ),
            h('button', { class: 'btn primary', disabled: Boolean(prog), onclick: () => installEngine(eng.source) }, icon('download', 15), t('settings.engine.install')),
          ],
    );
    engineBox.append(cards, status);
  }
  const engine = section('globe', t('settings.engine'), engineBox);

  // ---------------- Discord RPC ----------------
  const rpc = s().rpc;
  const proxyDisplay = h(
    'select',
    { class: 'input', onchange: (e) => save({ rpc: { proxyDisplay: e.target.value } }).then(renderPreview) },
    ['type', 'country', 'hidden'].map((v) => h('option', { value: v, selected: rpc.proxyDisplay === v }, t(`settings.rpc.proxy.${v}`))),
  );
  const rpcStatus = h('div', { class: 'rpc-status' });
  const preview = h('div', { class: 'discord-preview' });

  function renderRpcStatus() {
    clear(rpcStatus);
    const st = state.rpc || {};
    const key = st.state || 'disabled';
    const text =
      key === 'connected'
        ? t('settings.rpc.status.connected', { user: st.user ? ` - ${st.user}` : '' })
        : key === 'error'
          ? t('settings.rpc.status.error', { error: st.error || '' })
          : t(`settings.rpc.status.${key}`);
    rpcStatus.className = `rpc-status ${key}`;
    rpcStatus.append(h('span', { class: 'dot' }), text);
  }

  async function renderPreview() {
    let p;
    try {
      p = await api('rpc:preview');
    } catch {
      return;
    }
    clear(preview).append(
      h('div', { class: 'dp-head' }, 'PLAYING A GAME'),
      h(
        'div',
        { class: 'dp-body' },
        h('div', { class: 'dp-images' }, h('img', { src: 'assets/logo.png', class: 'dp-large' }), h('img', { src: 'assets/logo.png', class: 'dp-small' })),
        h(
          'div',
          { class: 'dp-text' },
          h('div', { class: 'dp-title' }, 'Shark{anty}'),
          h('div', null, p.details),
          h('div', null, p.state),
          h('div', { class: 'dp-time', 'data-since': p.startedAt }, `${duration(Date.now() - p.startedAt)} elapsed`),
        ),
      ),
    );
  }

  const rpcSection = section(
    'discord',
    t('settings.rpc'),
    h(
      'div',
      { class: 'rpc-grid' },
      h(
        'div',
        { class: 'col', style: { gap: '12px' } },
        toggle(rpc.enabled, (v) => save({ rpc: { enabled: v } }), t('settings.rpc.enabled')),
        rpcStatus,
        h('div', { class: 'muted small' }, t('settings.rpc.clientIdHint')),
        toggle(rpc.showNames, (v) => save({ rpc: { showNames: v } }).then(renderPreview), t('settings.rpc.showNames')),
        field(t('settings.rpc.proxyDisplay'), proxyDisplay),
      ),
      h('div', { class: 'col' }, h('div', { class: 'field-label' }, t('settings.rpc.preview')), preview),
    ),
  );

  // ---------------- local API ----------------
  const apiCfg = s().api;
  const tokenInput = h('input', { class: 'input mono', value: apiCfg.token, readonly: true, type: 'password' });
  const port = h('input', { class: 'input mono', type: 'number', value: apiCfg.port, min: 1024, max: 65535, oninput: (e) => saveLater({ api: { port: Number(e.target.value) || 3030 } }) });
  const example = h('pre', { class: 'code' });
  const renderExample = () => {
    example.textContent = `curl -H "Authorization: Bearer <token>" http://127.0.0.1:${s().api.port}/v1/profiles\ncurl -H "Authorization: Bearer <token>" http://127.0.0.1:${s().api.port}/v1/profiles/<id>/start`;
  };
  renderExample();
  const apiSection = section(
    'code',
    t('settings.api'),
    toggle(apiCfg.enabled, (v) => save({ api: { enabled: v } }), t('settings.api.enabled')),
    h(
      'div',
      { class: 'row' },
      h('div', { style: { width: '110px' } }, field(t('settings.api.port'), port)),
      h('div', { class: 'grow' }, field(t('settings.api.token'), h('div', { class: 'input-wrap' }, tokenInput, h('button', { class: 'icon-btn inset', onclick: () => (tokenInput.type = tokenInput.type === 'password' ? 'text' : 'password') }, icon('key', 14))))),
      h('button', { class: 'btn ghost', onclick: () => api('app:copy', tokenInput.value).then(() => toast(t('common.copied'), 'success')) }, icon('copy', 14), t('common.copy')),
      h(
        'button',
        {
          class: 'btn ghost',
          onclick: async () => {
            state.settings = await api('api:regenerateToken');
            tokenInput.value = state.settings.api.token;
          },
        },
        t('settings.api.regen'),
      ),
    ),
    example,
  );

  // ---------------- about ----------------
  const updateLine = h('div', { class: 'muted small' });
  const about = section(
    'info',
    t('settings.about'),
    h(
      'div',
      { class: 'about' },
      h('img', { src: 'assets/logo.png', width: 48, height: 48 }),
      h(
        'div',
        { class: 'grow col', style: { gap: '2px' } },
        h('div', null, h('strong', null, 'Shark{anty}'), h('span', { class: 'muted' }, `  v${state.info.version}`)),
        h('div', { class: 'muted small' }, t('settings.about.text')),
        updateLine,
      ),
      h(
        'div',
        { class: 'col' },
        h(
          'button',
          {
            class: 'btn ghost',
            onclick: async () => {
              try {
                const r = await api('app:checkUpdate');
                clear(updateLine).append(r.available ? h('a', { href: r.url, target: '_blank' }, t('settings.about.available', { v: r.latest })) : t('settings.about.upToDate', { v: r.current }));
              } catch (e) {
                toastError(e);
              }
            },
          },
          t('settings.about.check'),
        ),
        state.info.website ? h('button', { class: 'btn ghost', onclick: () => api('app:openExternal', state.info.website) }, icon('external', 14), t('settings.about.website')) : null,
        h('button', { class: 'btn ghost', onclick: () => api('app:openDataFolder') }, icon('folder', 14), t('settings.about.data')),
      ),
    ),
  );

  const el = h('div', { class: 'view' }, h('div', { class: 'settings-wrap col', style: { gap: '14px' } }, appearance, general, engine, rpcSection, apiSection, about));

  return {
    el,
    title: t('settings.title'),
    update(reason) {
      renderEngine();
      renderRpcStatus();
      if (reason !== 'engine-progress') renderPreview();
      renderExample();
    },
  };
}
