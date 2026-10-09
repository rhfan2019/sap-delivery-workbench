import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkImport,
  importsOf,
  checkTestDiscovery,
} from '../../../scripts/checks/architecture.mjs';

const files = new Set([
  'apps/web/src/main.ts',
  'apps/api/src/app.mjs',
  'apps/api/src/platform/database.mjs',
  'scripts/dev/dev.mjs',
  'packages/contracts/fs-workspace/index.mjs',
]);
const options = { files, allowedModuleEdges: new Set() };
test('new design module must use public facades even when the module edge is registered', () => {
  const opts = {
    files: new Set([
      'apps/api/src/modules/models/store.mjs',
      'apps/api/src/modules/models/public.mjs',
    ]),
    allowedModuleEdges: new Set(['design-assistant->models']),
  };
  assert.match(
    checkImport(
      'apps/api/src/modules/design-assistant/model.mjs',
      '../models/store.mjs',
      opts,
    ).join(),
    /public facade/,
  );
  assert.deepEqual(
    checkImport('apps/api/src/modules/design-assistant/model.mjs', '../models/public.mjs', opts),
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
      '@sap-delivery-workbench/contracts/fs-workspace',
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
      '../../../packages/contracts/fs-workspace/index.mjs',
      options,
    ).join(),
    /public exports/,
  );
  assert.match(checkImport('apps/api/src/app.mjs', './missing.mjs', options).join(), /Missing/);
});

test('architecture rejects contracts depending on applications', () => {
  assert.match(
    checkImport(
      'packages/contracts/fs-workspace/index.mjs',
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
      '@sap-delivery-workbench/contracts/fs-workspace/canonical',
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
  for (const file of ['apps/api/src/app.mjs', 'packages/contracts/fs-workspace/index.mjs'])
    assert.match(checkImport(file, '@sap-delivery-workbench/web', options).join(), /web/);
});

test('test discovery rejects a browser spec outside the configured directory or without an all-spec command', () => {
  const scripts = {
    'test:e2e': 'npm run test:e2e:node && npm run test:playwright',
    'test:playwright':
      'node scripts/testing/test-elements-e2e.mjs node_modules/@playwright/test/cli.js test --config playwright.fs.config.mjs',
  };
  assert.deepEqual(
    checkTestDiscovery(
      ['tests/e2e/fs-workspace/workspace.spec.ts'],
      'tests/e2e/fs-workspace',
      scripts,
    ),
    [],
  );
  assert.match(
    checkTestDiscovery(['tests/e2e/other/lost.spec.ts'], 'tests/e2e/fs-workspace', scripts).join(),
    /not discovered/,
  );
  assert.match(
    checkTestDiscovery(
      ['tests/e2e/fs-workspace/workspace.spec.ts'],
      'tests/e2e/fs-workspace',
      {},
    ).join(),
    /Playwright/,
  );
});
