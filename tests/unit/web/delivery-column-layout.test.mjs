import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

test('name absorbs spare width after a persisted resize; auxiliary widths remain stable', async () => {
  const vite = await createServer({
    root: 'apps/web',
    server: { middlewareMode: true, hmr: false },
  });
  try {
    const { layoutColumns } = await vite.ssrLoadModule('/src/components/workbench-table/layout.ts');
    const columns = [
      { key: 'code', width: 112 },
      { key: 'name', width: 300, minWidth: 240, flex: true },
      { key: 'module', width: 112 },
      { key: 'actions', width: 124 },
    ];
    const wide = layoutColumns(columns, 1500);
    assert.equal(wide.find((c) => c.key === 'name').width, 1108);
    assert.equal(
      wide.reduce((n, c) => n + c.width, 44),
      1500,
    );
    assert.equal(wide[0].width, 112);
    assert.equal(layoutColumns(columns, 500)[1].width, 300);
    assert.equal(columns[1].width, 300, 'never overwrite user preference with viewport expansion');
  } finally {
    await vite.close();
  }
});
