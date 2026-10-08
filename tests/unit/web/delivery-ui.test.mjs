import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { renderToString } from '@vue/server-renderer';
import { createSSRApp, h } from 'vue';
test('delivery UI protects pending edits and ignores stale project responses', async () => {
  const vite = await createServer({
    root: fileURLToPath(new URL('../../../apps/web/', import.meta.url)),
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  });
  try {
    const { default: FieldInput } = await vite.ssrLoadModule(
      '/src/features/delivery/FieldInput.vue',
    );
    for (const field of [
      { key: 'name', label: '名称' },
      { key: 'notes', label: '备注', type: 'long' },
      { key: 'kind', label: '类型', options: { report: '报表' } },
    ]) {
      const html = await renderToString(
        createSSRApp({
          render: () => h(FieldInput, { field, members: [], modelValue: '值', disabled: true }),
        }),
      );
      assert.match(
        html,
        /<(?:input|textarea|select)\b[^>]*\sdisabled(?:[\s=>])/,
        'saving must lock the actual editor control',
      );
    }
    const { default: EditableField } = await vite.ssrLoadModule(
      '/src/features/delivery/EditableField.vue',
    );
    const editor = await renderToString(
      createSSRApp({
        render: () =>
          h(EditableField, {
            item: { id: 'i', code: 'DEV-0001' },
            field: { key: 'name', label: '名称' },
            members: [],
            editing: true,
            value: '输入',
            readOnly: false,
            busy: true,
          }),
      }),
    );
    assert.match(editor, /<input\b[^>]*\sdisabled(?:[\s=>])/, 'inline save must lock its input');
    const { scopedRequest } = await vite.ssrLoadModule('/src/features/delivery/scopedRequest.ts');
    let scope = 'project-A/item-1',
      resolve;
    const results = [],
      errors = [];
    const pending = scopedRequest(
      () => scope,
      () =>
        new Promise((r) => {
          resolve = r;
        }),
      (v) => results.push(v),
      (e) => errors.push(e),
    );
    scope = 'project-B/item-2';
    resolve({ id: 'A-private' });
    await pending;
    assert.deepEqual(results, [], 'late response must not enter another project list');
    let reject;
    const failed = scopedRequest(
      () => scope,
      () =>
        new Promise((_, r) => {
          reject = r;
        }),
      (v) => results.push(v),
      (e) => errors.push(e),
    );
    scope = 'project-C';
    reject(new Error('old request'));
    await failed;
    assert.deepEqual(errors, [], 'late errors must not replace current project status');
    await scopedRequest(
      () => scope,
      async () => ({ id: 'current' }),
      (v) => results.push(v),
      (e) => errors.push(e),
    );
    assert.deepEqual(results, [{ id: 'current' }]);
    const context = await vite.ssrLoadModule('/src/services/projectContext.ts');
    const originalFetch = globalThis.fetch;
    let resolvePreference, sent;
    try {
      globalThis.fetch = async (_url, options) => {
        sent = JSON.parse(options.body);
        return new Promise((r) => {
          resolvePreference = r;
        });
      };
      context.currentProject.value = 'A';
      const saving = context.setDefaultProject();
      context.currentProject.value = 'B';
      resolvePreference({ ok: true, json: async () => ({ projectId: 'A' }) });
      await saving;
      assert.equal(sent.projectId, 'A');
      assert.equal(
        context.defaultProject.value,
        'A',
        'default indicator must reflect the saved project, not a later selection',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  } finally {
    await vite.close();
  }
});
