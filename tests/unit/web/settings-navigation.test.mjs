import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { renderToString } from '@vue/server-renderer';
import { createSSRApp, h } from 'vue';

const root = fileURLToPath(new URL('../../../apps/web/', import.meta.url));

// docs/specs/project-access-admin.md 4.3: every page is listed (planned ones too), and each
// person sees what their permissions open.
test('the settings menu lists every page and follows the permissions', async () => {
  const vite = await createServer({
    root,
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  });
  try {
    const nav = await vite.ssrLoadModule('/src/features/navigation.ts');
    const ids = nav.settingsSections.flatMap((s) => s.items.map((i) => i.id));
    for (const id of [
      'profile',
      'sap-credentials',
      'project-general',
      'project-members',
      'project-sap',
      'users',
      'positions',
      'roles',
      'security',
      'models',
      'audit',
      'sap-directory',
      'diagnostics',
    ])
      assert.ok(ids.includes(id), id);
    const planned = nav.settingsSections.flatMap((s) =>
      s.items.filter((i) => i.planned).map((i) => i.id),
    );
    assert.deepEqual(
      planned.sort(),
      [
        'notifications',
        'project-delivery',
        'project-fields',
        'project-models',
        'prompts',
        'runs',
      ].sort(),
    );
    assert.ok(
      nav.settingsSections.flatMap((s) => s.items).every((i) => i.path.startsWith('/settings/')),
    );

    // A consultant with a project role and no organization permissions.
    const consultant = nav.visibleSections(nav.settingsSections, {
      organization: [],
      project: {
        projectId: 'p',
        permissions: ['project:view', 'project.member:view', 'project.sap:view'],
        limits: {},
      },
    });
    assert.deepEqual(
      consultant.map((s) => s.id),
      ['personal', 'project'],
    );
    const projectItems = consultant.find((s) => s.id === 'project').items.map((i) => i.id);
    assert.ok(projectItems.includes('project-sap'));
    assert.ok(
      !projectItems.includes('project-commercial'),
      'commercial needs its field permission',
    );
    // Without any project, only personal settings remain.
    assert.deepEqual(
      nav
        .visibleSections(nav.settingsSections, { organization: [], project: null })
        .map((s) => s.id),
      ['personal'],
    );
    // A role administrator sees the organization group with roles but not models.
    const admin = nav.visibleSections(nav.settingsSections, {
      organization: ['user:view', 'role:view'],
      project: null,
    });
    const org = admin.find((s) => s.id === 'organization').items.map((i) => i.id);
    assert.deepEqual(org, ['users', 'positions', 'roles']);
    assert.equal(
      admin.some((s) => s.id === 'agents'),
      false,
    );

    assert.equal(nav.moduleOf('/settings/users/42').id, 'settings');
    assert.equal(nav.entryOf('/settings/users/42').id, 'users');
    assert.equal(nav.entryOf('/settings/audit/runs/1').id, 'audit');
    assert.equal(nav.moduleOf('/projects/1/development-items/2/design').id, 'delivery');
  } finally {
    await vite.close();
  }
});

// Module scope and "own items only" decide edits on one item; any single grant may allow it.
test('project permissions narrow by module and own items', async () => {
  const vite = await createServer({
    root,
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  });
  try {
    const { allows } = await vite.ssrLoadModule('/src/features/access/permissions.ts');
    const access = {
      projectId: 'p',
      permissions: ['delivery.item:view', 'delivery.item:edit', 'project:view'],
      limits: {
        'delivery.item:edit': [
          { modules: ['MM'], ownOnly: false },
          { modules: [], ownOnly: true },
        ],
      },
    };
    assert.equal(allows(access, 'delivery.item:edit'), true);
    assert.equal(allows(access, 'delivery.item:edit', { module: 'MM', owners: [] }, 'u'), true);
    assert.equal(
      allows(access, 'delivery.item:edit', { module: 'FICO', owners: ['x'] }, 'u'),
      false,
    );
    assert.equal(
      allows(access, 'delivery.item:edit', { module: 'FICO', owners: ['u'] }, 'u'),
      true,
    );
    assert.equal(allows(access, 'delivery.item:delete', { module: 'MM' }, 'u'), false);
    assert.equal(allows(null, 'project:view'), false);
  } finally {
    await vite.close();
  }
});

// Assistant entry (docs/specs/agent-workspace-start-and-composer.md 6.3): "own items only" means
// the stage's assignee, else the creator — the rule the API applies, not the item-edit owners.
test('assistant entry follows the stage owner', async () => {
  const vite = await createServer({
    root,
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  });
  try {
    const { allows } = await vite.ssrLoadModule('/src/features/access/permissions.ts');
    const { stageOwner, AGENT_STAGES } =
      await import('@sap-delivery-workbench/contracts/delivery/fields');
    assert.equal(AGENT_STAGES.design.phase, 'fsd');
    assert.equal(stageOwner('a', 'c'), 'a');
    assert.equal(stageOwner(null, 'c'), 'c');
    assert.equal(stageOwner('', null), null);
    const access = {
      projectId: 'p',
      permissions: ['agent.dev:view', 'agent.dev:run'],
      limits: { 'agent.dev:run': [{ modules: [], ownOnly: true }] },
    };
    // The subcontractor assigned to FSD (not development) may not open the development page.
    const owners = [stageOwner('someone-else', 'u')];
    assert.equal(allows(access, 'agent.dev:run', { module: 'MM', owners }, 'u'), false);
    assert.equal(
      allows(access, 'agent.dev:run', { module: 'MM', owners: [stageOwner(null, 'u')] }, 'u'),
      true,
    );
  } finally {
    await vite.close();
  }
});

// The settings card saves only itself and stays quiet while nothing changed.
test('a settings card offers saving only when editable and changed', async () => {
  const vite = await createServer({
    root,
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  });
  try {
    const { default: SettingsCard } = await vite.ssrLoadModule(
      '/src/features/settings/SettingsCard.vue',
    );
    const render = (props) =>
      renderToString(
        createSSRApp({
          render: () => h(SettingsCard, { title: '项目信息', ...props }, () => '内容'),
        }),
      );
    assert.doesNotMatch(await render({}), /保存/);
    assert.match(
      await render({ editable: true, dirty: false }),
      /<button[^>]*disabled[^>]*>[\s\S]*保存/,
    );
    assert.match(
      await render({ editable: true, dirty: true, error: '数据已被其他操作更新' }),
      /数据已被其他操作更新/,
    );
  } finally {
    await vite.close();
  }
});
