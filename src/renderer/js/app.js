import { h, api, icon, clear, duration, closeDropdown, toastError } from './ui.js';
import { t, setLanguage, getLanguage, languages } from './i18n.js';
import { state, subscribe, emit, refresh } from './state.js';
import { ProfilesView } from './views/profiles.js';
import { ProxiesView } from './views/proxies.js';
import { ExtensionsView } from './views/extensions.js';
import { SettingsView } from './views/settings.js';
import { ProfileEditor } from './views/profile-editor.js';
import { renderUpdateBanner } from './components/engine-banner.js';

const NAV = [
  { id: 'profiles', icon: 'users', view: ProfilesView },
  { id: 'proxies', icon: 'network', view: ProxiesView },
  { id: 'extensions', icon: 'puzzle', view: ExtensionsView },
  { id: 'settings', icon: 'settings', view: SettingsView },
];

let current = 'profiles';
let views = {};

const app = {
  go,
  openEditor: (profile = null) => ProfileEditor(profile),
  setLanguage: async (lang) => {
    state.settings = await api('settings:update', { language: lang });
    relocalize();
  },
  setTheme: async (theme) => {
    state.settings = await api('settings:update', { theme });
    applyTheme();
    renderFoot();
    if (views[current] && current === 'settings') views[current].update('theme');
  },
};
window.__shark = app;

function buildViews() {
  views = {};
  for (const n of NAV) views[n.id] = n.view(app);
}

function renderNav() {
  const nav = clear(document.getElementById('nav'));
  const runningCount = state.running.filter((r) => !r.headless).length;
  for (const n of NAV) {
    const count = n.id === 'profiles' ? state.profiles.length : n.id === 'proxies' ? state.proxies.length : n.id === 'extensions' ? state.extensions.length : null;
    nav.append(
      h(
        'button',
        { class: `nav-item${current === n.id ? ' active' : ''}`, onclick: () => go(n.id) },
        icon(n.icon, 17),
        h('span', { class: 'grow' }, t(`nav.${n.id}`)),
        n.id === 'profiles' && runningCount ? h('span', { class: 'nav-live', title: t('profiles.running') }, `● ${runningCount}`) : null,
        count !== null ? h('span', { class: 'nav-count' }, String(count)) : null,
      ),
    );
  }
}

function renderFoot() {
  const foot = clear(document.getElementById('sidebar-foot'));
  const eng = state.engine || {};
  const lang = getLanguage();
  const dark = state.settings.theme !== 'light';
  foot.append(
    h(
      'div',
      { class: 'foot-row' },
      h('div', { class: 'segmented sm' }, languages().map(([l]) => h('button', { class: l === lang ? 'active' : '', onclick: () => l !== lang && app.setLanguage(l) }, l.toUpperCase()))),
      h('div', { class: 'grow' }),
      h('button', { class: 'icon-btn', title: dark ? t('common.light') : t('common.dark'), onclick: () => app.setTheme(dark ? 'light' : 'dark') }, icon(dark ? 'sun' : 'moon', 16)),
    ),
    h('div', { class: 'foot-meta' }, h('button', { onclick: () => go('settings'), title: eng.exePath || '' }, eng.ready ? `Chromium ${eng.version}` : t('settings.engine.notInstalled')), h('div', null, `v${state.info.version || ''}`)),
  );
}

function go(id) {
  current = id;
  closeDropdown();
  const v = views[id];
  document.getElementById('page-title').textContent = v.title;
  const host = clear(document.getElementById('view'));
  host.append(v.el);
  host.scrollTop = 0;
  v.update('nav');
  renderNav();
}

function applyTheme() {
  const theme = state.settings.theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  api('app:setTheme', theme).catch(() => {});
}

function relocalize() {
  setLanguage(state.settings.language);
  buildViews();
  go(current);
  renderFoot();
  renderBanners();
}

let appUpdate = null;
function renderBanners() {
  const host = clear(document.getElementById('banners'));
  renderUpdateBanner(host);
  if (appUpdate) {
    host.append(
      h(
        'div',
        { class: 'banner top-banner' },
        icon('download', 16),
        h('span', { class: 'grow' }, t('update.banner', { v: appUpdate.latest })),
        h('button', { class: 'btn primary sm', onclick: () => api('app:openExternal', appUpdate.url) }, t('update.download')),
        h('button', { class: 'icon-btn', onclick: () => ((appUpdate = null), renderBanners()) }, icon('x', 15)),
      ),
    );
  }
}

async function checkAppUpdate() {
  if (!state.settings.checkUpdates) return;
  try {
    const r = await api('app:checkUpdate');
    if (r.available) {
      appUpdate = r;
      renderBanners();
    }
  } catch {
    /* offline or no release yet */
  }
}

function hideSplash() {
  const s = document.getElementById('splash');
  if (!s) return;
  s.classList.add('hide');
  setTimeout(() => s.remove(), 450);
}

async function main() {
  state.info = await api('app:info');
  await refresh('init');
  setLanguage(state.settings.language);
  applyTheme();
  document.body.classList.add(`platform-${state.info.platform}`);
  buildViews();
  go('profiles');
  renderFoot();
  renderBanners();
  setTimeout(hideSplash, 500);

  subscribe((reason) => {
    renderNav();
    renderFoot();
    if (reason === 'engine-update' || reason === 'engine') renderBanners();
    if (views[current]) views[current].update(reason);
  });

  window.shark.on('state:running', (running) => {
    state.running = running;
    emit('running');
    refresh('running').catch(() => {});
  });
  window.shark.on('state:changed', (snap) => {
    Object.assign(state, snap);
    emit('changed');
  });
  window.shark.on('engine:progress', (p) => {
    const wasNull = !state.engineProgress;
    state.engineProgress = p;
    emit(p && !wasNull ? 'engine-progress' : 'engine');
  });
  window.shark.on('engine:update', (u) => {
    state.engine = { ...state.engine, update: u };
    emit('engine-update');
  });
  window.shark.on('rpc:status', (s) => {
    const changed = !state.rpc || state.rpc.state !== s.state;
    state.rpc = s;
    if (changed) emit('rpc');
  });

  setInterval(() => {
    for (const el of document.querySelectorAll('[data-since]')) {
      const since = Number(el.dataset.since);
      el.textContent = el.classList.contains('dp-time') ? `${duration(Date.now() - since)} elapsed` : duration(Date.now() - since);
    }
  }, 1000);

  document.addEventListener('keydown', (e) => {
    if (document.querySelector('.overlay')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      app.openEditor();
    }
  });

  setTimeout(checkAppUpdate, 5000);
}

main().catch((e) => {
  hideSplash();
  toastError(e);
  document.body.append(h('pre', { class: 'fatal' }, String(e && e.stack ? e.stack : e)));
});
