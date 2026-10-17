import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkImport,
  importsOf,
  checkTestDiscovery,
  checkDesignTokens,
  checkLegacy,
} from '../../../scripts/checks/architecture.mjs';

const files = new Set([
  'apps/web/src/main.ts',
  'apps/api/src/app.mjs',
  'apps/api/src/platform/database.mjs',
  'scripts/dev/dev.mjs',
  'packages/contracts/abap-fsd-agent/node.mjs',
]);
const options = { files, allowedModuleEdges: new Set() };
test('abap-fsd-agent must use public facades even when the module edge is registered', () => {
  const opts = {
    files: new Set([
      'apps/api/src/modules/models/store.mjs',
      'apps/api/src/modules/models/public.mjs',
    ]),
    allowedModuleEdges: new Set(['abap-fsd-agent->models']),
  };
  assert.match(
    checkImport('apps/api/src/modules/abap-fsd-agent/loop.mjs', '../models/store.mjs', opts).join(),
    /public facade/,
  );
  assert.deepEqual(
    checkImport('apps/api/src/modules/abap-fsd-agent/loop.mjs', '../models/public.mjs', opts),
    [],
  );
});

test('architecture rejects frontend access to backend and Node-only contracts', () => {
  assert.match(
    checkImport('apps/web/src/main.ts', '../../api/src/app.mjs', options).join(),
    /web.*api/,
  );
  assert.match(
    checkImport(
      'apps/web/src/main.ts',
      '@sap-delivery-workbench/contracts/abap-fsd-agent/node',
      options,
    ).join(),
    /browser/,
  );
});

test('architecture rejects application dependencies on engineering scripts', () => {
  assert.match(
    checkImport('apps/api/src/app.mjs', '../../../scripts/dev/dev.mjs', options).join(),
    /scripts/,
  );
});

test('architecture rejects physical cross-package imports and missing files', () => {
  assert.match(
    checkImport(
      'apps/api/src/app.mjs',
      '../../../packages/contracts/abap-fsd-agent/node.mjs',
      options,
    ).join(),
    /public exports/,
  );
  assert.match(checkImport('apps/api/src/app.mjs', './missing.mjs', options).join(), /Missing/);
});

test('architecture rejects contracts depending on applications', () => {
  assert.match(
    checkImport(
      'packages/contracts/abap-fsd-agent/node.mjs',
      '../../../apps/api/src/app.mjs',
      options,
    ).join(),
    /contracts/,
  );
});

test('architecture accepts internal implementation and browser-safe contract imports', () => {
  assert.deepEqual(checkImport('apps/api/src/app.mjs', './platform/database.mjs', options), []);
  assert.deepEqual(
    checkImport(
      'apps/web/src/main.ts',
      '@sap-delivery-workbench/contracts/agent-core/sse',
      options,
    ),
    [],
  );
});

test('architecture requires registration of new cross-business dependencies', () => {
  const opts = {
    files: new Set(['apps/api/src/modules/sap/service.mjs']),
    allowedModuleEdges: new Set(),
  };
  assert.match(
    checkImport('apps/api/src/modules/delivery/routes.mjs', '../sap/service.mjs', opts).join(),
    /Unregistered module/,
  );
});

test('CommonJS and aliased createRequire cannot bypass dependency checks', () => {
  assert.deepEqual(importsOf('probe.cjs', "const api = require('../apps/api/src/app.mjs');"), [
    '../apps/api/src/app.mjs',
  ]);
  assert.deepEqual(
    importsOf(
      'probe.mjs',
      "import { createRequire as makeRequire } from 'node:module'; const load = makeRequire(import.meta.url); load('pg');",
    ),
    ['node:module', 'pg'],
  );
});

test('backend and contracts cannot depend on the frontend workspace by package name', () => {
  for (const file of ['apps/api/src/app.mjs', 'packages/contracts/abap-fsd-agent/node.mjs'])
    assert.match(checkImport(file, '@sap-delivery-workbench/web', options).join(), /web/);
});

test('test discovery rejects browser specs and misplaced node tests', () => {
  assert.match(checkTestDiscovery(['tests/e2e/other/lost.spec.ts']).join(), /Playwright/);
  assert.match(checkTestDiscovery(['tests/misc/lost.test.mjs']).join(), /not discovered/);
  assert.deepEqual(checkTestDiscovery(['tests/unit/api/models.test.mjs']), []);
});

test('contract 1.3 rejects assistant version directories, removed modules and legacy identifiers', () => {
  assert.match(
    checkLegacy('apps/api/src/modules/abap-fsd-agent/prompts/v1/system.md').join(),
    /Version directory/,
  );
  assert.match(
    checkLegacy('apps/web/src/features/fs-assistant-test/View.vue').join(),
    /Removed assistant module/,
  );
  assert.match(
    checkLegacy('apps/api/src/modules/design-assistant/graph.mjs').join(),
    /Removed assistant module/,
  );
  assert.match(
    checkLegacy('apps/api/src/app.mjs', "app.get('/api/admin/abap-fsd-agent/x')").join(),
    /Legacy assistant identifier/,
  );
  assert.match(
    checkLegacy('scripts/database/provision.mjs', 'GRANT SELECT ON app.fsd_v1_task').join(),
    /Legacy assistant identifier/,
  );
  assert.deepEqual(
    checkLegacy('apps/api/src/modules/abap-fsd-agent/loop.mjs', "const base = '/abap-fsd-agent';"),
    [],
  );
  assert.deepEqual(checkLegacy('database/migrations/1.sql', 'DROP TABLE app.fsd_v1_task;'), []);
  // Contract 1.6: the manual FS ledger stays removed.
  assert.match(
    checkLegacy('apps/api/src/modules/delivery/items.mjs', 'INSERT INTO app.fs_draft').join(),
    /Legacy assistant identifier app.fs_draft/,
  );
  assert.deepEqual(checkLegacy('database/migrations/2.sql', 'DROP TABLE app.fs_version;'), []);
});

test('contract 1.7 makes every agent module import other modules through public facades', () => {
  const opts = {
    files: new Set([
      'apps/api/src/modules/sap/service.mjs',
      'apps/api/src/modules/sap/public.mjs',
      'apps/api/src/modules/abap-fsd-agent/repository.mjs',
      'apps/api/src/modules/abap-fsd-agent/public.mjs',
    ]),
    allowedModuleEdges: new Set(['agent-core->sap', 'abap-dev-agent->abap-fsd-agent']),
  };
  assert.match(
    checkImport('apps/api/src/modules/agent-core/loop.mjs', '../sap/service.mjs', opts).join(),
    /agent-core must use an explicit module public facade/,
  );
  assert.deepEqual(
    checkImport('apps/api/src/modules/agent-core/loop.mjs', '../sap/public.mjs', opts),
    [],
  );
  assert.match(
    checkImport(
      'apps/api/src/modules/abap-dev-agent/materials.mjs',
      '../abap-fsd-agent/repository.mjs',
      opts,
    ).join(),
    /abap-dev-agent must use an explicit module public facade/,
  );
  assert.deepEqual(
    checkImport(
      'apps/api/src/modules/abap-dev-agent/materials.mjs',
      '../abap-fsd-agent/public.mjs',
      opts,
    ),
    [],
  );
  // The core never reaches back into an agent unless the edge is registered.
  assert.match(
    checkImport(
      'apps/api/src/modules/agent-core/loop.mjs',
      '../abap-fsd-agent/public.mjs',
      opts,
    ).join(),
    /Unregistered module dependency: agent-core->abap-fsd-agent/,
  );
});

test('contract 1.7 keeps the two assistant features apart', () => {
  const opts = {
    files: new Set([
      'apps/web/src/features/abap-fsd-agent/ChatComposer.vue',
      'apps/web/src/features/agent-workbench/ChatComposer.vue',
    ]),
    allowedModuleEdges: new Set(),
  };
  assert.match(
    checkImport(
      'apps/web/src/features/abap-dev-agent/CodePanel.vue',
      '../abap-fsd-agent/ChatComposer.vue',
      opts,
    ).join(),
    /agent-workbench/,
  );
  assert.deepEqual(
    checkImport(
      'apps/web/src/features/abap-dev-agent/CodePanel.vue',
      '../agent-workbench/ChatComposer.vue',
      opts,
    ),
    [],
  );
});

test('contract 1.7 names agent prompts and framework copies', () => {
  for (const file of [
    'apps/api/src/modules/abap-dev-agent/prompts/system.md',
    'apps/api/src/modules/abap-dev-agent/prompts/report.md',
    'apps/api/src/modules/abap-dev-agent/prompts/report-example.abap',
    'apps/api/src/modules/abap-dev-agent/frameworks/ycl_frh_report.abap',
    'apps/api/src/modules/abap-fsd-agent/prompts/system.md',
  ])
    assert.deepEqual(checkLegacy(file), [], file);
  for (const file of [
    'apps/api/src/modules/abap-dev-agent/prompts/dev-system.txt',
    'apps/api/src/modules/abap-dev-agent/prompts/report/example.abap',
    'apps/api/src/modules/abap-dev-agent/prompts/YDEMO.abap',
    'apps/api/src/modules/abap-dev-agent/frameworks/ycl_frh_report.txt',
  ])
    assert.match(checkLegacy(file).join(), /naming rule/, file);
  assert.match(
    checkLegacy('apps/api/src/modules/agent-core/v2/loop.mjs').join(),
    /Version directory/,
  );
  assert.match(
    checkLegacy('apps/web/src/features/agent-workbench/v1/Shell.vue').join(),
    /Version directory/,
  );
});

test('contract 1.8 keeps SAP write tools inside the test data executor', () => {
  assert.match(
    checkLegacy('apps/api/src/modules/agent-core/sap-tools.mjs', "call('runClass', {})").join(),
    /SAP write tool runClass/,
  );
  assert.deepEqual(
    checkLegacy('apps/api/src/modules/sap/test-data.mjs', "call('setObjectSource', {})"),
    [],
  );
  assert.deepEqual(checkLegacy('apps/web/src/views/LoginView.vue', "icon: 'lock'"), []);
});

test('web styles use design tokens, never literal colours, fonts, sizes, spacing or radii', () => {
  const css = (body) => checkDesignTokens('apps/web/src/features/x/x.css', `.a {\n${body}\n}`);
  for (const [body, error] of [
    ['  color: #1f2328;', /literal colour/],
    ['  background: rgba(0, 0, 0, 0.1);', /literal colour/],
    ['  border-color: white;', /literal colour/],
    ['  --local: #e4e9f0;', /literal colour/],
    ['  font-family: Consolas, monospace;', /literal font/],
    ['  font: 12px/1.8 inherit;', /literal font/],
    ['  font-size: 13px;', /literal font size/],
    ['  font-weight: 650;', /literal font weight/],
    ['  padding: 6px var(--space-2);', /literal spacing/],
    ['  gap: 0.5rem;', /literal spacing/],
    ['  border-radius: 50%;', /literal radius/],
  ])
    assert.match(css(body).join(), error, body);
  assert.deepEqual(
    css(
      [
        '  color: var(--text);',
        '  background: color-mix(in srgb, var(--primary) 10%, transparent);',
        '  font-family: var(--font-mono);',
        '  font: var(--font-size-sm)/1.6 inherit;',
        '  font-size: 0.85em;',
        '  font-weight: var(--font-weight-semibold);',
        '  padding: 0 calc(-1 * var(--space-2));',
        '  margin-left: calc(var(--layout-sidebar) + var(--space-6));',
        '  border-radius: var(--radius-full);',
        '  width: 240px;',
      ].join('\n'),
    ),
    [],
  );
  // Vue: style blocks and palette classes in templates; theme.css and vendored components are exempt.
  assert.match(
    checkDesignTokens(
      'apps/web/src/a.vue',
      '<template><p class="text-amber-700"/></template>',
    ).join(),
    /Palette colour class text-amber-700/,
  );
  assert.match(
    checkDesignTokens('apps/web/src/a.vue', '<style scoped>.a { color: #fff; }</style>').join(),
    /literal colour/,
  );
  assert.deepEqual(
    checkDesignTokens('apps/web/src/assets/theme.css', ':root { --text: #1f2328; }'),
    [],
  );
  assert.deepEqual(
    checkDesignTokens(
      'apps/web/src/components/ui/button/Button.vue',
      '<style>.a{color:#000}</style>',
    ),
    [],
  );
});
