import { h, api, icon, toast, toastError, confirmDialog, modal, field, clear, timeAgo, debounce, dropdown } from '../ui.js';
import { t } from '../i18n.js';
import { state, refresh } from '../state.js';
import { proxyPasteField, categoryBadge, categorySelect, uriOf } from '../components/proxy-form.js';

export function ProxiesView() {
  let search = '';
  const checking = new Set();
  const selected = new Set();

  const searchInput = h('input', { class: 'input search', placeholder: t('common.search'), oninput: debounce((e) => { search = e.target.value.trim().toLowerCase(); render(); }, 120) });
  const bulkBar = h('div', { class: 'bulk-bar' });
  const toolbar = h(
    'div',
    { class: 'toolbar' },
    h('div', { class: 'search-wrap' }, icon('search', 16), searchInput),
    h('div', { class: 'grow' }),
    bulkBar,
    h('button', { class: 'btn ghost', onclick: checkAll }, icon('shield', 16), t('proxies.checkAll')),
    h('button', { class: 'btn ghost', onclick: bulkImport }, icon('upload', 16), t('proxies.bulk')),
    h('button', { class: 'btn primary', onclick: () => addProxy() }, icon('plus', 16), t('proxies.add')),
  );
  const table = h('div', { class: 'table-wrap' });
  const el = h('div', { class: 'view' }, toolbar, table);

  async function check(id) {
    checking.add(id);
    render();
    try {
      await api('proxies:check', id);
    } catch (e) {
      toastError(e);
    } finally {
      checking.delete(id);
      await refresh();
    }
  }
  async function checkAll() {
    const queue = state.proxies.map((p) => p.id);
    const worker = async () => { while (queue.length) await check(queue.shift()); };
    await Promise.all(Array.from({ length: Math.min(5, queue.length) }, worker));
  }
  async function remove(ids) {
    if (!(await confirmDialog(t('proxies.confirmDelete', { n: ids.length }), { danger: true, okText: t('common.delete') }))) return;
    await api('proxies:delete', ids).catch(toastError);
    ids.forEach((id) => selected.delete(id));
    refresh();
  }

  // Add: a single paste field that parses, saves and checks automatically.
  function addProxy() {
    const catRow = h('div');
    const pf = proxyPasteField({
      onResolved: (p) => {
        refresh();
        clear(catRow);
        if (p) catRow.append(field(t('proxies.category'), categorySelect(p, () => refresh())));
      },
    });
    const m = modal({ title: t('proxies.newTitle'), width: 600, body: [h('p', { class: 'muted small' }, t('proxies.uriPh')), pf.el, catRow], footer: [h('button', { class: 'btn primary', onclick: () => { m.close(); refresh(); } }, t('common.close'))] });
  }

  function editProxy(proxy) {
    const pf = proxyPasteField({ initialProxy: proxy, onResolved: () => refresh() });
    const m = modal({
      title: t('proxies.editTitle'),
      width: 600,
      body: [pf.el, field(t('proxies.category'), categorySelect(proxy, () => refresh()))],
      footer: [h('button', { class: 'btn primary', onclick: () => m.close() }, t('common.close'))],
    });
  }

  function bulkImport() {
    const type = h('select', { class: 'input' }, ['socks5', 'http', 'socks4'].map((v) => h('option', { value: v }, v.toUpperCase())));
    const text = h('textarea', { class: 'input mono', rows: 10, spellcheck: 'false', placeholder: 'socks5://user:pass@1.2.3.4:1080\nhttp://5.6.7.8:3128\n9.9.9.9:1080:user:pass' });
    const go = h('button', { class: 'btn primary', onclick: async () => {
      try {
        const r = await api('proxies:import', text.value, type.value);
        toast(t('proxies.imported', { n: r.added, d: r.duplicates }), 'success');
        if (r.errors.length) toast(`${t('proxies.importErrors', { n: r.errors.length })}: ${r.errors[0].line}`, 'error', 7000);
        m.close();
        refresh();
      } catch (e) {
        toastError(e);
      }
    } }, t('common.import'));
    const m = modal({ title: t('proxies.bulkTitle'), width: 620, body: [h('p', { class: 'muted small' }, t('proxies.bulkHint')), h('div', { style: { width: '160px' } }, field(t('bulk.proxyType'), type)), text], footer: [h('button', { class: 'btn ghost', onclick: () => m.close() }, t('common.cancel')), go] });
  }

  function usage() {
    const m = new Map();
    for (const p of state.profiles) if (p.proxyId) m.set(p.proxyId, (m.get(p.proxyId) || 0) + 1);
    return m;
  }
  function renderBulk() {
    clear(bulkBar);
    if (!selected.size) return;
    const ids = [...selected];
    bulkBar.append(
      h('span', { class: 'muted small' }, t('profiles.selected', { n: ids.length })),
      h('button', { class: 'btn ghost', onclick: () => ids.forEach(check) }, icon('shield', 14), t('common.check')),
      h('button', { class: 'btn danger-text', onclick: () => remove(ids) }, icon('trash', 14), t('common.delete')),
    );
  }

  function render() {
    clear(table);
    for (const id of [...selected]) if (!state.proxies.find((p) => p.id === id)) selected.delete(id);
    if (!state.proxies.length) {
      table.append(h('div', { class: 'empty' }, icon('network', 52), h('h3', null, t('proxies.empty.title')), h('p', { class: 'muted' }, t('proxies.empty.text')), h('button', { class: 'btn primary', onclick: () => addProxy() }, icon('plus', 16), t('proxies.add'))));
      renderBulk();
      return;
    }
    const used = usage();
    const list = state.proxies.filter((p) => !search || `${p.name} ${p.host} ${p.type} ${p.category} ${p.lastCheck ? p.lastCheck.ip : ''}`.toLowerCase().includes(search));
    table.append(
      h('table', { class: 'table' },
        h('thead', null, h('tr', null,
          h('th', { class: 'td-check' }, ''),
          h('th', null, t('proxies.col.name')),
          h('th', null, t('proxies.col.type')),
          h('th', null, t('proxies.col.category')),
          h('th', null, t('proxies.col.address')),
          h('th', null, t('proxies.col.status')),
          h('th', null, t('proxies.col.used')),
          h('th', null, ''))),
        h('tbody', null, list.map((p) => {
          const lc = p.lastCheck;
          const more = h('button', { class: 'icon-btn' }, icon('more', 18));
          more.addEventListener('click', () => dropdown(more, [
            { icon: 'edit', label: t('common.edit'), onClick: () => editProxy(p) },
            { icon: 'copy', label: t('common.copy'), onClick: () => api('app:copy', uriOf(p)).then(() => toast(t('common.copied'), 'success')) },
            '-',
            { icon: 'trash', label: t('common.delete'), danger: true, onClick: () => remove([p.id]) },
          ]));
          return h('tr', { ondblclick: () => editProxy(p) },
            h('td', { class: 'td-check' }, h('input', { type: 'checkbox', checked: selected.has(p.id), onchange: (e) => { e.target.checked ? selected.add(p.id) : selected.delete(p.id); renderBulk(); } })),
            h('td', null, h('div', { class: 'name' }, p.name)),
            h('td', null, h('span', { class: `badge type-${p.type}` }, p.type.toUpperCase())),
            h('td', null, categoryBadge(p.category)),
            h('td', { class: 'mono' }, `${p.host}:${p.port}`),
            h('td', null, checking.has(p.id)
              ? h('span', { class: 'check-result loading' }, h('span', { class: 'spinner' }), t('check.running'))
              : lc
                ? h('div', { class: `check-inline ${lc.ok ? 'ok' : 'fail'}`, title: lc.ok ? (lc.isp || '') : lc.error },
                    lc.ok ? [h('span', { class: 'cc ok' }, lc.countryCode || '?'), h('span', { class: 'mono' }, lc.ip), h('span', { class: 'muted small' }, `${lc.latency} ms · ${timeAgo(lc.at)}`)] : [h('span', { class: 'cc fail' }, '✕'), h('span', { class: 'ellipsis small' }, lc.error)])
                : h('span', { class: 'muted small' }, t('proxies.notChecked'))),
            h('td', { class: 'muted' }, String(used.get(p.id) || 0)),
            h('td', { class: 'td-actions' },
              h('button', { class: 'icon-btn', title: t('common.check'), disabled: checking.has(p.id), onclick: () => check(p.id) }, icon('refresh', 17)),
              more));
        }))),
    );
    renderBulk();
  }

  return { el, title: t('proxies.title'), update: (reason) => reason !== 'engine-progress' && reason !== 'running' && render() };
}
