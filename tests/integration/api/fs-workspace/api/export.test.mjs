import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { apiFixture } from '../../../../fixtures/fs-workspace/api.mjs';
import pg from 'pg';
import { databaseConfig } from '../../../../../apps/api/src/platform/database.mjs';
import { claimRun } from '../../../../../apps/api/src/modules/fs-workspace/runs/queue.mjs';
import { runOne } from '../../../../../apps/api/src/modules/fs-workspace/runs/worker.mjs';
import { assertCurrentExport } from '../../../../../apps/api/src/modules/fs-workspace/export/service.mjs';
test('export pins the requested version and identical manifests reuse one queued job', async () => {
  const f = await apiFixture();
  try {
    const body = { document_version_id: f.workspace.draft_head.id, format: 'docx' };
    const first = await f.request('POST', '/exports', body, { 'idempotency-key': randomUUID() });
    assert.equal(first.statusCode, 202, first.body);
    const repeated = await f.request('POST', '/exports', body, { 'idempotency-key': randomUUID() });
    assert.equal(repeated.json().data.id, first.json().data.id);
    const row = (
      await f.db.query('SELECT * FROM app.fs_export WHERE workspace_id=$1', [f.workspace.id])
    ).rows[0];
    assert.equal(row.document_revision_id, body.document_version_id);
    assert.equal(row.manifest.watermark_policy, 'discussion');
    await assert.rejects(
      assertCurrentExport(
        f.db,
        { ...f.scope, workspaceId: f.workspace.id },
        { ...row, manifest: { ...row.manifest, watermark_policy: 'approved' } },
      ),
      /EXPORT_AUTHORITY_CHANGED/,
    );
    assert.equal((await f.request('GET', `/exports/${row.id}/download`)).statusCode, 422);
    assert.equal((await f.request('GET', `/exports/${randomUUID()}`)).statusCode, 404);
  } finally {
    await f.close();
  }
});

test('export worker produces a real downloadable file and rechecks download membership', async () => {
  const prior = { file: process.env.FS_FONT_FILE, name: process.env.FS_FONT_NAME };
  process.env.FS_FONT_FILE = 'C:/Windows/Fonts/msyh.ttc';
  process.env.FS_FONT_NAME = 'Microsoft YaHei';
  const f = await apiFixture(),
    pool = new pg.Pool(databaseConfig({ runtime: true }));
  try {
    await f.db.query(
      "UPDATE app.organization_member SET access_level='member' WHERE organization_id=$1 AND user_id=$2",
      [f.scope.organizationId, f.scope.actorId],
    );
    const owner = randomUUID();
    await f.db.query('INSERT INTO app.app_user(id,login_name,display_name) VALUES($1,$2,$2)', [
      owner,
      'export-owner-' + owner,
    ]);
    await f.db.query('INSERT INTO app.organization_member(organization_id,user_id) VALUES($1,$2)', [
      f.scope.organizationId,
      owner,
    ]);
    await f.db.query(
      'INSERT INTO app.project_member(organization_id,project_id,user_id) VALUES($1,$2,$3)',
      [f.scope.organizationId, f.scope.projectId, owner],
    );
    await f.db.query('UPDATE app.development_item SET business_owner_id=$2 WHERE id=$1', [
      f.scope.itemId,
      owner,
    ]);
    const response = await f.request(
      'POST',
      '/exports',
      { document_version_id: f.workspace.draft_head.id, format: 'docx' },
      { 'idempotency-key': randomUUID() },
    );
    assert.equal(response.statusCode, 202, response.body);
    delete process.env.FS_FONT_NAME;
    const failedLease = await claimRun(pool, 'export-test', f.scope.organizationId);
    assert.equal((await runOne(pool, failedLease)).status, 'waiting_evidence');
    process.env.FS_FONT_NAME = 'Microsoft YaHei';
    const resumed = await f.request(
      'POST',
      `/runs/${failedLease.id}/resume`,
      { checkpoint_id: null, reason: '字体已配置' },
      { 'idempotency-key': randomUUID() },
    );
    assert.equal(resumed.statusCode, 202, resumed.body);
    const lease = await claimRun(pool, 'export-test', f.scope.organizationId);
    const outcome = await runOne(pool, lease);
    assert.equal(outcome.status, 'completed');
    const download = await f.request('GET', `/exports/${response.json().data.id}/download`);
    assert.equal(download.statusCode, 200, download.body);
    assert.equal(download.rawPayload.subarray(0, 2).toString(), 'PK');
    await f.db.query(
      "UPDATE app.project_member SET status='removed' WHERE project_id=$1 AND user_id=$2",
      [f.scope.projectId, f.scope.actorId],
    );
    assert.equal(
      (await f.request('GET', `/exports/${response.json().data.id}/download`)).statusCode,
      404,
    );
  } finally {
    await pool.end();
    await f.close();
    if (prior.file === undefined) delete process.env.FS_FONT_FILE;
    else process.env.FS_FONT_FILE = prior.file;
    if (prior.name === undefined) delete process.env.FS_FONT_NAME;
    else process.env.FS_FONT_NAME = prior.name;
  }
});
