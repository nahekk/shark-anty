import { h, api, icon, toast, toastError, confirmDialog, dropdown, timeAgo, duration, clear, debounce } from '../ui.js';
import { t } from '../i18n.js';
import { state, refresh, runningMap, proxyById, groups } from '../state.js';
import { cookiesDialog, bulkCreateDialog } from '../components/profile-dialogs.js';
import { renderEngineBanner } from '../components/engine-banner.js';
import { categoryBadge } from '../components/proxy-form.js';

export function ProfilesView(app) {
  let search = '';
  let group = '__all';
  let onlyRunning = false;
  const selected = new Set();
  const busy = new Set();

  const banner = h('div');
  const searchInput = h('input', {
    class: 'input search',
    placeholder: t('common.search'),
    oninput: debounce((e) => {
      search = e.target.value.trim().toLowerCase();
      renderTable();
    }, 120),
  });
  const groupSelect = h('select', {
    class: 'input',
    onchange: (e) => {
      group = e.target.value;
      renderTable();
    },
  });
  const runningToggle = h(
    'label',
    { class: 'check' },
    h('input', {
      type: 'checkbox',
      onchange: (e) => {
        onlyRunning = e.target.checked;
        renderTable();
      },
    }),
    t('profiles.onlyRunning'),
  );
  const bulkBar = h('div', { class: 'bulk-bar' });

  const toolbar = h(
    'div',
    { class: 'toolbar' },
    h('div', { class: 'search-wrap' }, icon('search', 16), searchInput),
    groupSelect,
    runningToggle,
    h('div', { class: 'grow' }),
    bulkBar,
    h('button', { class: 'btn ghost compact', title: t('profiles.bulk'), onclick: bulkCreateDialog }, icon('layers', 16), h('span', null, t('profiles.bulk'))),
    h('button', { class: 'btn primary', onclick: () => app.openEditor() }, icon('plus', 16), t('profiles.new')),
  );

  const table = h('div', { class: 'table-wrap' });
  const footer = h('div', { class: 'table-foot muted small' });
  const el = h('div', { class: 'view' }, banner, toolbar, table, footer);

  function renderGroups() {
    const gs = groups();
    if (group !== '__all' && group !== '__none' && !gs.includes(group)) group = '__all';
    clear(groupSelect).append(
      h('option', { value: '__all', selected: group === '__all' }, t('profiles.allGroups')),
      ...gs.map((g) => h('option', { value: g, selected: group === g }, g)),
      h('option', { value: '__none', selected: group === '__none' }, t('profiles.noGroup')),
    );
  }

  function filtered() {
    const run = runningMap();
    return state.profiles.filter((p) => {
      if (group === '__none' && p.group) return false;
      if (group !== '__all' && group !== '__none' && p.group !== group) return false;
      if (onlyRunning && !run.has(p.id)) return false;
      if (search) {
        const proxy = proxyById(p.proxyId);
        const hay = [p.name, p.group, p.notes, ...(p.tags || []), proxy ? `${proxy.host} ${proxy.name}` : ''].join(' ').toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });
  }

  async function start(id) {
    busy.add(id);
    renderTable();
    try {
      await api('profiles:start', id);
    } catch (e) {
      toastError(e);
    } finally {
      busy.delete(id);
      renderTable();
    }
  }

  async function stop(id) {
    try {
      await api('profiles:stop', id);
    } catch (e) {
      toastError(e);
    }
  }

  async function remove(ids) {
    if (!(await confirmDialog(t('profiles.confirmDelete', { n: ids.length }), { danger: true, okText: t('common.delete') }))) return;
    try {
      await api('profiles:delete', ids);
      ids.forEach((id) => selected.delete(id));
      toast(t('profiles.deleted', { n: ids.length }), 'success');
      refresh();
    } catch (e) {
      toastError(e);
    }
  }

  function renderBulk() {
    clear(bulkBar);
    const run = runningMap();
    if (run.size) {
      bulkBar.append(h('button', { class: 'btn ghost compact', title: t('profiles.stopAll'), onclick: () => api('profiles:stopAll').catch(toastError) }, icon('stop', 14), h('span', null, t('profiles.stopAll'))));
    }
    if (!selected.size) return;
    const ids = [...selected];
    bulkBar.append(
      h('span', { class: 'muted small' }, t('profiles.selected', { n: ids.length })),
      h('button', { class: 'btn ghost', onclick: () => ids.forEach((id) => !run.has(id) && start(id)) }, icon('play', 14), t('profiles.start')),
      h('button', { class: 'btn ghost', onclick: () => ids.forEach((id) => run.has(id) && stop(id)) }, icon('stop', 14), t('profiles.stop')),
      h('button', { class: 'btn danger-text', onclick: () => remove(ids) }, icon('trash', 14), t('common.delete')),
    );
  }

  function statusCell(p, r) {
    if (busy.has(p.id) && !r) return h('span', { class: 'status starting' }, h('span', { class: 'dot' }), t('profiles.starting'));
    if (!r) return h('span', { class: 'status' }, h('span', { class: 'dot' }), t('profiles.stopped'));
    if (r.state === 'starting') return h('span', { class: 'status starting' }, h('span', { class: 'dot' }), t('profiles.starting'));
    if (r.state === 'stopping') return h('span', { class: 'status stopping' }, h('span', { class: 'dot' }), t('profiles.stopping'));
    if (r.headless) return h('span', { class: 'status starting' }, h('span', { class: 'dot' }), 'cookies…');
    return h('span', { class: 'status running' }, h('span', { class: 'dot' }), t('profiles.running'), h('span', { class: 'uptime', 'data-since': r.startedAt }, duration(Date.now() - r.startedAt)));
  }

  function proxyCell(p) {
    const proxy = proxyById(p.proxyId);
    if (!proxy) return h('span', { class: 'muted' }, t('profiles.noProxy'));
    const lc = proxy.lastCheck;
    return h(
      'div',
      { class: 'proxy-cell' },
      h('span', { class: `badge type-${proxy.type}` }, proxy.type.toUpperCase()),
      proxy.category && proxy.category !== 'unknown' ? categoryBadge(proxy.category) : null,
      h('span', { class: 'mono ellipsis', title: `${proxy.host}:${proxy.port}` }, proxy.name || `${proxy.host}:${proxy.port}`),
      lc ? h('span', { class: `cc ${lc.ok ? 'ok' : 'fail'}`, title: lc.ok ? `${lc.ip} · ${lc.country || ''}` : lc.error }, lc.ok ? lc.countryCode || '✓' : '✕') : null,
    );
  }

  function row(p, run) {
    const r = run.get(p.id);
    const isOn = Boolean(r) && !r.headless;
    const moreBtn = h('button', { class: 'icon-btn', title: '…' }, icon('more', 18));
    moreBtn.addEventListener('click', () =>
      dropdown(moreBtn, [
        { icon: 'edit', label: t('common.edit'), onClick: () => app.openEditor(p) },
        { icon: 'cookie', label: t('profiles.menu.cookies'), onClick: () => cookiesDialog(p) },
        '-',
        { icon: 'copy', label: t('profiles.menu.clone'), onClick: () => api('profiles:clone', p.id, false).then(refresh, toastError) },
        { icon: 'layers', label: t('profiles.menu.cloneData'), disabled: Boolean(r), onClick: () => api('profiles:clone', p.id, true).then(refresh, toastError) },
        { icon: 'folder', label: t('profiles.menu.folder'), onClick: () => api('profiles:openFolder', p.id).catch(toastError) },
        { icon: 'key', label: t('profiles.menu.copyId'), onClick: () => api('app:copy', p.id).then(() => toast(t('common.copied'), 'success')) },
        '-',
        { icon: 'trash', label: t('common.delete'), danger: true, onClick: () => remove([p.id]) },
      ]),
    );

    const cb = h('input', {
      type: 'checkbox',
      checked: selected.has(p.id),
      onchange: (e) => {
        e.target.checked ? selected.add(p.id) : selected.delete(p.id);
        renderBulk();
        syncHeaderCheckbox();
      },
    });

    const action =
      isOn || (r && r.state !== 'running')
        ? h('button', { class: 'btn stop sm', disabled: r && r.state !== 'running', onclick: () => stop(p.id) }, icon('stop', 13), t('profiles.stop'))
        : h('button', { class: 'btn start sm', disabled: busy.has(p.id) || (r && r.headless), onclick: () => start(p.id) }, icon('play', 13), t('profiles.start'));

    return h(
      'tr',
      { class: isOn ? 'is-running' : '', ondblclick: (e) => !e.target.closest('button,input') && app.openEditor(p) },
      h('td', { class: 'td-check' }, cb),
      h(
        'td',
        null,
        h(
          'div',
          { class: 'name-cell' },
          p.color ? h('span', { class: 'color-dot', style: { background: p.color, borderColor: p.color } }) : null,
          h(
            'div',
            { class: 'name-main' },
            h(
              'div',
              { class: 'row center', style: { gap: '6px' } },
              h('span', { class: 'name' }, p.name),
              p.fingerprint && p.fingerprint.enabled
                ? h('span', { class: 'badge accent', title: 'Fingerprint' }, { windows: 'Windows', macos: 'macOS', linux: 'Linux' }[p.fingerprint.os] || 'FP')
                : null,
            ),
            p.tags && p.tags.length ? h('div', { class: 'tags' }, p.tags.map((tg) => h('span', { class: 'tag' }, tg))) : null,
            p.notes ? h('div', { class: 'notes ellipsis', title: p.notes }, p.notes) : null,
          ),
        ),
      ),
      h('td', null, statusCell(p, r)),
      h('td', null, proxyCell(p)),
      h('td', null, p.group ? h('span', { class: 'group-chip' }, p.group) : h('span', { class: 'muted' }, '-')),
      h('td', { class: 'muted small nowrap' }, timeAgo(p.lastLaunchAt)),
      h(
        'td',
        { class: 'td-actions' },
        action,
        h('button', { class: 'icon-btn', title: t('profiles.menu.cookies'), onclick: () => cookiesDialog(p) }, icon('cookie', 17)),
        h('button', { class: 'icon-btn', title: t('common.edit'), onclick: () => app.openEditor(p) }, icon('edit', 17)),
        moreBtn,
      ),
    );
  }

  let headerCb;
  function syncHeaderCheckbox() {
    if (!headerCb) return;
    const list = filtered();
    headerCb.checked = list.length > 0 && list.every((p) => selected.has(p.id));
    headerCb.indeterminate = !headerCb.checked && list.some((p) => selected.has(p.id));
  }

  function renderTable() {
    for (const id of [...selected]) if (!state.profiles.find((p) => p.id === id)) selected.delete(id);
    clear(table);
    const list = filtered();
    if (!state.profiles.length) {
      table.append(
        h(
          'div',
          { class: 'empty' },
          h('img', { src: 'assets/logo.png', width: 88, height: 88 }),
          h('h3', null, t('profiles.empty.title')),
          h('p', { class: 'muted' }, t('profiles.empty.text')),
          h('button', { class: 'btn primary', onclick: () => app.openEditor() }, icon('plus', 16), t('profiles.new')),
        ),
      );
      footer.textContent = '';
      renderBulk();
      return;
    }
    const run = runningMap();
    headerCb = h('input', {
      type: 'checkbox',
      onchange: (e) => {
        for (const p of list) e.target.checked ? selected.add(p.id) : selected.delete(p.id);
        renderTable();
      },
    });
    table.append(
      h(
        'table',
        { class: 'table' },
        h(
          'thead',
          null,
          h(
            'tr',
            null,
            h('th', { class: 'td-check' }, headerCb),
            h('th', null, t('profiles.col.name')),
            h('th', null, t('profiles.col.status')),
            h('th', null, t('profiles.col.proxy')),
            h('th', null, t('profiles.col.group')),
            h('th', null, t('profiles.col.last')),
            h('th', null, ''),
          ),
        ),
        h('tbody', null, list.map((p) => row(p, run))),
      ),
    );
    syncHeaderCheckbox();
    footer.textContent = `${t('profiles.count', { n: list.length })}${list.length !== state.profiles.length ? ` / ${state.profiles.length}` : ''}`;
    renderBulk();
  }

  return {
    el,
    title: t('profiles.title'),
    update(reason) {
      renderEngineBanner(banner);
      if (reason === 'engine-progress') return;
      renderGroups();
      renderTable();
    },
    focusSearch: () => searchInput.focus(),
  };
}
