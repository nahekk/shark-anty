import { h, api, icon, toast, toastError, confirmDialog, clear, toggle } from '../ui.js';
import { t } from '../i18n.js';
import { state, refresh } from '../state.js';

// Global extensions: every enabled extension loads in every profile.
export function ExtensionsView() {
  const input = h('input', { class: 'input', placeholder: t('ext.addPh'), spellcheck: 'false' });
  const addBtn = h('button', { class: 'btn primary', onclick: add }, icon('plus', 15), t('ext.addStore'));
  input.addEventListener('keydown', (e) => e.key === 'Enter' && add());

  async function add() {
    const v = input.value.trim();
    if (!v) return input.focus();
    addBtn.disabled = true;
    try {
      const ext = await api('extensions:addWebStore', v);
      toast(t('ext.added', { name: ext.name }), 'success');
      input.value = '';
      refresh();
    } catch (e) {
      toastError(e);
    } finally {
      addBtn.disabled = false;
    }
  }

  const addLocal = (channel) => async () => {
    try {
      const ext = await api(channel);
      if (ext) {
        toast(t('ext.added', { name: ext.name }), 'success');
        refresh();
      }
    } catch (e) {
      toastError(e);
    }
  };

  const list = h('div', { class: 'ext-list' });
  const el = h(
    'div',
    { class: 'view' },
    h(
      'div',
      { class: 'toolbar' },
      h('div', { class: 'grow', style: { maxWidth: '520px' } }, input),
      addBtn,
      h('div', { class: 'grow' }),
      h('button', { class: 'btn ghost', onclick: addLocal('extensions:addFolder') }, icon('folder', 15), t('ext.addFolder')),
      h('button', { class: 'btn ghost', onclick: addLocal('extensions:addCrx') }, icon('puzzle', 15), t('ext.addCrx')),
    ),
    h('div', { class: 'card' }, list),
  );

  function render() {
    clear(list).append(
      h(
        'div',
        { class: 'ext-row' },
        h('img', { src: 'assets/logo.png', width: 32, height: 32 }),
        h('div', { class: 'grow' }, h('div', { class: 'name' }, t('ext.builtinTitle')), h('div', { class: 'muted small' }, t('ext.builtinText'))),
        h('span', { class: 'badge' }, t('ext.builtin')),
      ),
    );
    if (!state.extensions.length) {
      list.append(h('div', { class: 'ext-row muted' }, t('ext.empty')));
      return;
    }
    for (const e of state.extensions) {
      list.append(
        h(
          'div',
          { class: 'ext-row' },
          e.icon ? h('img', { src: e.icon, width: 32, height: 32 }) : icon('puzzle', 30),
          h(
            'div',
            { class: 'grow' },
            h('div', null, h('span', { class: 'name' }, e.name), h('span', { class: 'muted small' }, `  ${e.version}`)),
            e.description ? h('div', { class: 'muted small clamp2' }, e.description) : null,
          ),
          toggle(e.enabled !== false, (v) => api('extensions:setEnabled', e.id, v).then(refresh, toastError)),
          e.origin === 'webstore'
            ? h(
                'button',
                {
                  class: 'icon-btn',
                  title: t('common.update'),
                  onclick: async (ev) => {
                    ev.currentTarget.disabled = true;
                    try {
                      const x = await api('extensions:update', e.id);
                      toast(`${x.name} ${x.version}`, 'success');
                      refresh();
                    } catch (err) {
                      toastError(err);
                    }
                  },
                },
                icon('refresh', 16),
              )
            : null,
          h(
            'button',
            {
              class: 'icon-btn danger',
              title: t('common.remove'),
              onclick: async () => {
                if (!(await confirmDialog(t('ext.confirmRemove', { name: e.name }), { danger: true }))) return;
                api('extensions:remove', e.id).then(refresh, toastError);
              },
            },
            icon('trash', 16),
          ),
        ),
      );
    }
  }

  return { el, title: t('ext.title'), update: (reason) => reason !== 'engine-progress' && reason !== 'running' && render() };
}
