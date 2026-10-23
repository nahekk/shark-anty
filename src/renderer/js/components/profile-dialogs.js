import { h, api, modal, field, icon, toast, toastError, confirmDialog } from '../ui.js';
import { t } from '../i18n.js';
import { refresh, groups, proxyById } from '../state.js';

// ======================= Cookies dialog =======================
export function cookiesDialog(profile) {
  const format = h('select', { class: 'input' }, h('option', { value: 'json' }, 'JSON (Cookie-Editor / EditThisCookie)'), h('option', { value: 'netscape' }, 'Netscape cookies.txt'));
  const domain = h('input', { class: 'input', placeholder: t('cookies.domainPh'), spellcheck: 'false' });
  const out = h('textarea', { class: 'input mono', rows: 8, readonly: true, spellcheck: 'false' });
  let lastExport = null;

  const runExport = async () => {
    exportBtn.disabled = true;
    try {
      lastExport = await api('cookies:export', profile.id, { format: format.value, domain: domain.value });
      out.value = lastExport.text;
      toast(t('cookies.exported', { n: lastExport.count }), 'success');
    } catch (e) {
      toastError(e);
    } finally {
      exportBtn.disabled = false;
    }
  };
  const exportBtn = h('button', { class: 'btn primary', onclick: runExport }, icon('download', 15), t('common.export'));
  const copyBtn = h(
    'button',
    {
      class: 'btn ghost',
      onclick: async () => {
        if (!out.value) await runExport();
        if (out.value) {
          await api('app:copy', out.value);
          toast(t('common.copied'), 'success');
        }
      },
    },
    icon('copy', 15),
    t('common.copy'),
  );
  const saveBtn = h(
    'button',
    {
      class: 'btn ghost',
      onclick: async () => {
        if (!out.value) await runExport();
        if (!out.value) return;
        const safe = profile.name.replace(/[^\w.-]+/g, '_');
        const fname = `${safe}-cookies${domain.value ? '-' + domain.value.replace(/[^\w.-]+/g, '_') : ''}.${format.value === 'netscape' ? 'txt' : 'json'}`;
        try {
          const path = await api('cookies:saveFile', out.value, fname);
          if (path) toast(path, 'success');
        } catch (e) {
          toastError(e);
        }
      },
    },
    icon('folder', 15),
    t('cookies.saveFile'),
  );
  format.addEventListener('change', () => (out.value = ''));
  domain.addEventListener('input', () => (out.value = ''));

  const input = h('textarea', { class: 'input mono', rows: 8, placeholder: t('cookies.importPh'), spellcheck: 'false' });
  const replace = h('input', { type: 'checkbox' });
  const importBtn = h(
    'button',
    {
      class: 'btn primary',
      onclick: async () => {
        if (!input.value.trim()) return input.focus();
        importBtn.disabled = true;
        try {
          const r = await api('cookies:import', profile.id, input.value, { replace: replace.checked });
          toast(r.failed ? t('cookies.importedFailed', { n: r.imported, f: r.failed }) : t('cookies.imported', { n: r.imported }), 'success');
          input.value = '';
        } catch (e) {
          toastError(e);
        } finally {
          importBtn.disabled = false;
        }
      },
    },
    icon('upload', 15),
    t('common.import'),
  );
  const loadBtn = h(
    'button',
    {
      class: 'btn ghost',
      onclick: async () => {
        try {
          const f = await api('cookies:openFile');
          if (f) input.value = f.text;
        } catch (e) {
          toastError(e);
        }
      },
    },
    icon('folder', 15),
    t('common.browse'),
  );
  const clearBtn = h(
    'button',
    {
      class: 'btn danger-text',
      onclick: async () => {
        if (!(await confirmDialog(t('cookies.confirmClear'), { danger: true }))) return;
        try {
          await api('cookies:clear', profile.id);
          toast(t('cookies.cleared'), 'success');
        } catch (e) {
          toastError(e);
        }
      },
    },
    icon('trash', 15),
    t('cookies.clear'),
  );

  const m = modal({
    title: t('cookies.title', { name: profile.name }),
    width: 680,
    body: [
      h(
        'section',
        { class: 'card-section' },
        h('h3', null, icon('download', 16), t('common.export')),
        h('div', { class: 'row' }, h('div', { class: 'grow' }, field(t('cookies.format'), format)), h('div', { class: 'grow' }, field(t('cookies.domain'), domain))),
        out,
        h('div', { class: 'row' }, exportBtn, copyBtn, saveBtn),
      ),
      h(
        'section',
        { class: 'card-section' },
        h('h3', null, icon('upload', 16), t('common.import')),
        input,
        h('div', { class: 'row center' }, importBtn, loadBtn, h('label', { class: 'check' }, replace, t('cookies.replace'))),
      ),
      h('p', { class: 'muted small' }, t('cookies.note')),
    ],
    footer: [clearBtn, h('div', { class: 'grow' }), h('button', { class: 'btn ghost', onclick: () => m.close() }, t('common.close'))],
  });
}

// ======================= Bulk create =======================
export function bulkCreateDialog() {
  const count = h('input', { class: 'input', type: 'number', min: 1, max: 500, value: 5 });
  const prefix = h('input', { class: 'input', value: 'Profile' });
  const group = h('input', { class: 'input', placeholder: t('editor.groupPh'), list: 'groups-dl2' });
  const dl = h('datalist', { id: 'groups-dl2' }, groups().map((g) => h('option', { value: g })));
  const proxyType = h('select', { class: 'input' }, ['socks5', 'http', 'socks4'].map((v) => h('option', { value: v }, v.toUpperCase())));
  const proxies = h('textarea', { class: 'input mono', rows: 6, placeholder: 'socks5://user:pass@1.2.3.4:1080\n5.6.7.8:8080:user:pass', spellcheck: 'false' });
  const startUrls = h('textarea', { class: 'input mono', rows: 2, placeholder: t('editor.startUrlsPh'), spellcheck: 'false' });
  const go = h(
    'button',
    {
      class: 'btn primary',
      onclick: async () => {
        go.disabled = true;
        try {
          const n = await api('profiles:bulkCreate', {
            count: Number(count.value),
            prefix: prefix.value,
            group: group.value,
            proxyType: proxyType.value,
            proxies: proxies.value,
            startUrls: startUrls.value,
          });
          toast(t('profiles.bulkCreated', { n }), 'success');
          m.close();
          refresh();
        } catch (e) {
          toastError(e);
        } finally {
          go.disabled = false;
        }
      },
    },
    t('common.create'),
  );
  const m = modal({
    title: t('bulk.title'),
    width: 600,
    body: [
      dl,
      h('div', { class: 'row' }, h('div', { style: { width: '120px' } }, field(t('bulk.count'), count)), h('div', { class: 'grow' }, field(t('bulk.prefix'), prefix)), h('div', { class: 'grow' }, field(t('editor.group'), group))),
      h('div', { class: 'row' }, h('div', { style: { width: '160px' } }, field(t('bulk.proxyType'), proxyType))),
      field(t('bulk.proxies'), proxies),
      field(t('editor.startUrls'), startUrls),
      h('div', { class: 'muted small' }, t('bulk.fp')),
    ],
    footer: [h('button', { class: 'btn ghost', onclick: () => m.close() }, t('common.cancel')), go],
  });
}

export function proxyLabel(proxyId) {
  const p = proxyById(proxyId);
  return p ? `${p.type} ${p.host}:${p.port}` : '';
}
