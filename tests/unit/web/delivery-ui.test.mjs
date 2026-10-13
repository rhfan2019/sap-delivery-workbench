import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { renderToString } from '@vue/server-renderer';
import { createSSRApp, h } from 'vue';

const root = fileURLToPath(new URL('../../../apps/web/', import.meta.url));

test('development list editors lock while saving and render the shared catalog', async () => {
  const vite = await createServer({
    root,
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  });
  try {
    const model = await vite.ssrLoadModule('/src/features/delivery/model.ts');
    const { default: FieldEditor } = await vite.ssrLoadModule(
      '/src/features/delivery/FieldEditor.vue',
    );
    const { default: InlineCell } = await vite.ssrLoadModule(
      '/src/features/delivery/InlineCell.vue',
    );
    const ctx = { members: [{ id: 'u1', displayName: '顾问甲', active: true }], tags: [] };
    const fields = model.catalog([]);
    for (const key of [
      'name',
      'kind',
      'fsd.assigneeId',
      'fsd.plannedEnd',
      'development.effortDays',
      'fsd.progress',
    ]) {
      const field = fields.find((f) => f.key === key);
      const html = await renderToString(
        createSSRApp({
          render: () => h(FieldEditor, { field, ctx, modelValue: null, disabled: true }),
        }),
      );
      assert.match(
        html,
        /<(?:input|select)\b[^>]*\sdisabled(?:[\s=>])/,
        `${key} must lock while saving`,
      );
    }
    const item = model.emptyItem();
    Object.assign(item, { id: 'i', code: '00007', name: '库存报表', priority: 'high' });
    item.phases.fsd = {
      ...item.phases.fsd,
      status: 'in_progress',
      plannedEnd: '2000-01-01',
      assigneeId: 'u1',
    };
    const cell = (key, readOnly = false) =>
      renderToString(
        createSSRApp({
          render: () =>
            h(InlineCell, {
              item,
              field: fields.find((f) => f.key === key),
              ctx,
              readOnly,
              save: async () => {},
            }),
        }),
      );
    const status = await cell('fsd.status');
    assert.match(status, /进行中/);
    assert.match(status, /逾期/, 'an open phase past its planned end shows a reminder');
    assert.match(status, /编辑 00007 的FSD状态/);
    assert.doesNotMatch(
      await cell('fsd.status', true),
      /编辑 00007/,
      'read-only cells have no editor',
    );
    assert.doesNotMatch(
      await cell('businessFunction'),
      /编辑 00007/,
      'rich text is edited in the drawer',
    );
    assert.match(await cell('fsd.assigneeId'), /顾问甲/);
  } finally {
    await vite.close();
  }
});

test('development list model: labels, change detection and completed progress', async () => {
  const vite = await createServer({
    root,
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  });
  try {
    const model = await vite.ssrLoadModule('/src/features/delivery/model.ts');
    const custom = [
      {
        id: 'c1',
        label: '上线批次',
        fieldType: 'select',
        options: [{ id: 'o1', label: '第一批' }],
        groupKey: 'basic',
        sortOrder: 10,
        required: false,
        archivedAt: null,
        rowVersion: '1',
      },
      {
        id: 'c2',
        label: '旧列',
        fieldType: 'text',
        options: [],
        groupKey: 'custom',
        sortOrder: 20,
        required: false,
        archivedAt: '2026-10-01',
        rowVersion: '1',
      },
    ];
    const fields = model.catalog(custom);
    assert.ok(fields.some((f) => f.key === 'custom.c1' && f.group === 'basic'));
    assert.ok(!fields.some((f) => f.key === 'custom.c2'), 'archived columns are hidden');
    const byKey = (k) => fields.find((f) => f.key === k);
    assert.equal(model.columnLabel(byKey('fsd.status')), 'FSD状态');
    assert.equal(model.columnLabel(byKey('development.plannedEnd')), '开发计划完成');
    assert.equal(model.columnLabel(byKey('development.assigneeId')), '开发人员');
    const before = model.emptyItem();
    const after = structuredClone(before);
    model.setFieldValue(after, 'consultant_test.status', 'completed');
    model.setFieldValue(after, 'custom.c1', 'o1');
    assert.equal(after.phases.consultant_test.progress, 100);
    assert.deepEqual(model.changedKeys(before, after, fields).sort(), [
      'consultant_test.progress',
      'consultant_test.status',
      'custom.c1',
    ]);
    const ctx = { members: [], tags: [] };
    assert.equal(model.displayText(after, byKey('custom.c1'), ctx), '第一批');
    assert.equal(model.displayText(after, byKey('consultant_test.status'), ctx), '已完成');
  } finally {
    await vite.close();
  }
});

test('project context keeps the saved default when the selection changes mid-request', async () => {
  const vite = await createServer({
    root,
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  });
  try {
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
      assert.equal(context.defaultProject.value, 'A');
    } finally {
      globalThis.fetch = originalFetch;
    }
  } finally {
    await vite.close();
  }
});
