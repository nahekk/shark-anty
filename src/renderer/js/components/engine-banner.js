import { h, api, icon, toast, toastError, clear, bytes } from '../ui.js';
import { t } from '../i18n.js';
import { state, refresh } from '../state.js';

const LABELS = { ungoogled: 'ungoogled-chromium', chromium: 'Chromium' };

export function progressText(p) {
  if (!p) return '';
  if (p.stage === 'resolve') return t('engine.resolving');
  if (p.stage === 'extract') return t('engine.extracting');
  const pct = p.total ? `${Math.floor((p.received / p.total) * 100)}% (${bytes(p.received)} / ${bytes(p.total)})` : bytes(p.received);
  return t('engine.downloading', { source: LABELS[p.source] || p.source, pct });
}

export function progressBar(p) {
  const pct = p && p.stage === 'download' && p.total ? (p.received / p.total) * 100 : p && p.stage === 'extract' ? 100 : 4;
  return h('div', { class: `progress${p && p.stage !== 'download' ? ' indeterminate' : ''}` }, h('div', { class: 'progress-bar', style: { width: `${pct}%` } }));
}

export async function installEngine(source) {
  try {
    if (source !== state.engine.source) await api('engine:setSource', source);
    await api('engine:install', source);
    await refresh();
    toast(t('engine.ready', { version: state.engine.version }), 'success');
  } catch (e) {
    toastError(e);
    refresh();
  }
}

// First start: pick Chromium or ungoogled-chromium.
export function renderEngineBanner(host) {
  clear(host);
  const eng = state.engine || {};
  const prog = state.engineProgress;
  if (eng.ready && !prog) return;
  if (prog) {
    host.append(h('div', { class: 'card' }, h('div', { class: 'card-body' }, h('div', null, progressText(prog)), progressBar(prog))));
    return;
  }
  if (eng.source === 'custom') return;
  const option = (id, recommended) =>
    h(
      'div',
      { class: 'engine-option' },
      h('div', { class: 'title' }, icon('globe', 16), `${LABELS[id]} (latest)`, recommended ? h('span', { class: 'badge accent' }, t('engine.recommended')) : null),
      h('div', { class: 'muted small' }, t(`engine.${id}.desc`)),
      h('button', { class: `btn ${recommended ? 'primary' : 'ghost'}`, onclick: () => installEngine(id) }, icon('download', 15), t('engine.download')),
    );
  const ids = (eng.sources || []).map((s) => s.id).filter((id) => id !== 'custom');
  host.append(
    h(
      'section',
      { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', null, t('engine.choose.title'))),
      h('div', { class: 'card-body' }, h('div', { class: 'muted' }, t('engine.choose.text')), h('div', { class: 'engine-pick' }, ids.map((id) => option(id, id === 'chromium')))),
    ),
  );
}

// Shown at the top of every page when a newer Chromium build is available.
export function renderUpdateBanner(host) {
  const u = state.engine && state.engine.update;
  const prog = state.engineProgress;
  if (!u || (prog && prog.source === u.source)) return;
  host.append(
    h(
      'div',
      { class: 'banner top-banner' },
      icon('download', 16),
      h('span', { class: 'grow' }, t('engine.update', { source: LABELS[u.source] || u.source, latest: u.latest, current: u.current })),
      h('button', { class: 'btn primary sm', onclick: () => installEngine(u.source) }, t('engine.updateNow')),
    ),
  );
}
