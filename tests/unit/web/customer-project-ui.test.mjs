import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { renderToString } from '@vue/server-renderer';
import { createSSRApp, h } from 'vue';

test('customer tree preserves project children without customer count badges', async () => {
  const vite = await createServer({
    root: fileURLToPath(new URL('../../../apps/web/', import.meta.url)),
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  });
  try {
    const { default: RelationTree } = await vite.ssrLoadModule(
      '/src/features/admin/components/RelationTree.vue',
    );
    const customers = [
      { id: 'a', name: '客户甲' },
      { id: 'b', name: '客户乙' },
    ];
    const projects = [
      { id: 'p1', name: '项目一', customerId: 'a' },
      { id: 'p2', name: '项目二', customerId: 'a' },
    ];
    const render = () =>
      renderToString(
        createSSRApp({
          render: () => h(RelationTree, { organizationName: '动态企业', customers, projects }),
        }),
      );
    let html = await render();
    assert.match(html, /动态企业/);
    assert.doesNotMatch(html, /aria-label="[0-9]+ 个项目"/);
    assert.match(html, /项目一/);
    assert.match(html, /客户乙/);
    projects.push({ id: 'p3', name: '项目三', customerId: 'b' });
    html = await render();
    assert.match(html, /项目三/);
    assert.doesNotMatch(html, /aria-label="0 个项目"/);
  } finally {
    await vite.close();
  }
});
