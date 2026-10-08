import test from 'node:test';
import assert from 'node:assert/strict';
import { transaction, fixture } from '../../../../fixtures/fs-workspace/database.mjs';
import { createWorkspace } from '../../../../../apps/api/src/modules/fs-workspace/workspace/service.mjs';
import Fastify from 'fastify';
import { fsRoutes } from '../../../../../apps/api/src/modules/delivery/fs.mjs';

test('legacy_import_idempotent_preserves_original_and_does_not_create_approvals', () =>
  transaction(async (db) => {
    const scope = await fixture(db);
    const input = {
      template_id: 'traditional-abap-five',
      template_version: '1.0.0',
      profile: 'report',
      legacy_source_id: null,
    };
    const a = await createWorkspace(db, scope, input);
    const b = await createWorkspace(db, scope, input);
    assert.equal(a.id, b.id);
    const { rows } = await db.query(
      'SELECT ast,legacy_manifest FROM app.fs_document_revision WHERE workspace_id=$1',
      [a.id],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].legacy_manifest.sections.background, '保留原文');
    assert.equal(rows[0].legacy_manifest.sections.exceptions, '未归属例外');
    const mapped = Object.fromEntries(
      rows[0].ast.sections.flatMap((section) =>
        section.blocks.map((block) => [block.id.replace(/^legacy-/, ''), block.text]),
      ),
    );
    assert.deepEqual(
      mapped,
      rows[0].legacy_manifest.sections,
      'all nine chapter texts must survive mapping',
    );
    assert.match(rows[0].legacy_manifest.sha256, /^[a-f0-9]{64}$/);
    const context = rows[0].ast.context;
    assert.match(
      context.context_snapshot_id,
      /^[0-9a-f-]{36}$/,
      'migration context must reference an actual snapshot',
    );
    assert.equal(
      (
        await db.query(
          'SELECT count(*)::int AS n FROM app.fs_context_snapshot WHERE id=$1 AND workspace_id=$2',
          [context.context_snapshot_id, a.id],
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM app.fs_run WHERE id=$1 AND workspace_id=$2 AND intent='legacy_import' AND status='completed'",
          [context.run_id, a.id],
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await db.query('SELECT count(*)::int AS n FROM app.fs_approval WHERE workspace_id=$1', [
          a.id,
        ])
      ).rows[0].n,
      0,
    );
  }));

test('migrated_item_old_submit_denied_for_all_legacy_write_routes_even_when_inactive', () =>
  transaction(async (db) => {
    const scope = await fixture(db);
    await createWorkspace(db, scope, {
      template_id: 'traditional-abap-five',
      template_version: '1.0.0',
      profile: 'report',
      legacy_source_id: null,
    });
    await db.query('UPDATE app.fs_workspace SET active=false WHERE item_id=$1', [scope.itemId]);
    const app = Fastify();
    fsRoutes(app, {
      organizationId: scope.organizationId,
      item: async () => ({ id: scope.itemId, created_by: scope.actorId }),
      write: async (req, operation) =>
        operation(db, { user: { id: scope.actorId } }, { access_level: 'admin' }),
    });
    try {
      for (const [method, suffix] of [
        ['PATCH', ''],
        ['POST', '/versions'],
        ['POST', '/submit'],
      ]) {
        const response = await app.inject({
          method,
          url: `/api/projects/${scope.projectId}/development-items/${scope.itemId}/fs${suffix}`,
          payload: { rowVersion: '1' },
        });
        assert.equal(response.statusCode, 409, response.body);
        assert.equal(response.json().code, 'FS_WORKSPACE_ENABLED');
      }
      assert.equal(
        (
          await db.query('SELECT count(*)::int AS n FROM app.fs_version WHERE item_id=$1', [
            scope.itemId,
          ])
        ).rows[0].n,
        0,
      );
    } finally {
      await app.close();
    }
  }));

test('legacy baseline remains separate and preserves version provenance', () =>
  transaction(async (db) => {
    const scope = await fixture(db);
    const {
      rows: [version],
    } = await db.query(
      "INSERT INTO app.fs_version(organization_id,project_id,item_id,version_number,fs_number,sections,created_by) VALUES($1,$2,$3,1,'FS-OLD',$4,$5) RETURNING id",
      [
        scope.organizationId,
        scope.projectId,
        scope.itemId,
        { background: '已提交原文' },
        scope.actorId,
      ],
    );
    await db.query('UPDATE app.fs_draft SET submitted_version_id=$1 WHERE item_id=$2', [
      version.id,
      scope.itemId,
    ]);
    const workspace = await createWorkspace(db, scope, {
      template_id: 'traditional-abap-five',
      template_version: '1.0.0',
      profile: 'report',
      legacy_source_id: null,
    });
    assert.notEqual(workspace.baseline_head.id, workspace.draft_head.id);
    const {
      rows: [baseline],
    } = await db.query('SELECT ast,legacy_manifest FROM app.fs_document_revision WHERE id=$1', [
      workspace.baseline_head.id,
    ]);
    assert.equal(baseline.legacy_manifest.approval_source, 'legacy_submission');
    assert.equal(baseline.ast.lifecycle, 'draft');
    assert.deepEqual(baseline.ast.approval_refs, []);
  }));
