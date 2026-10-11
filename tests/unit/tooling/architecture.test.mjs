import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkImport,
  importsOf,
  checkTestDiscovery,
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
      '@sap-delivery-workbench/contracts/abap-fsd-agent/sse',
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
});
