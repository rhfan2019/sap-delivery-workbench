import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { apiFixture, etag } from '../../../../fixtures/fs-workspace/api.mjs';
import { digest } from '../../../../../apps/api/src/platform/auth.mjs';
test('early review allows release gaps but author cannot approve and reviewer cannot bypass gates', async () => {
  const f = await apiFixture();
  try {
    const input = {
      document_version_id: f.workspace.draft_head.id,
      document_hash: f.workspace.draft_head.content_hash,
    };
    const submitted = await f.request('POST', '/reviews', input, {
      'idempotency-key': randomUUID(),
      'if-match': etag(f.workspace),
    });
    assert.equal(submitted.statusCode, 201, submitted.body);
    const review = submitted.json().data;
    assert.ok(review.gates.some((g) => !g.passed && g.blocking === 'release'));
    const workspace = (await f.request('GET')).json().data.workspace;
    const body = { ...input, action: 'approve', review_role: 'technical_reviewer', reason: '审阅' };
    assert.equal(
      (
        await f.request('POST', `/reviews/${review.id}/approvals`, body, {
          'idempotency-key': randomUUID(),
          'if-match': etag(workspace),
        })
      ).statusCode,
      403,
    );
    const reviewer = randomUUID(),
      session = randomUUID(),
      token = randomBytes(32).toString('hex');
    await f.db.query('INSERT INTO app.app_user(id,login_name,display_name) VALUES($1,$2,$2)', [
      reviewer,
      'review-' + reviewer,
    ]);
    await f.db.query('INSERT INTO app.organization_member(organization_id,user_id) VALUES($1,$2)', [
      f.scope.organizationId,
      reviewer,
    ]);
    await f.db.query(
      'INSERT INTO app.project_member(organization_id,project_id,user_id) VALUES($1,$2,$3)',
      [f.scope.organizationId, f.scope.projectId, reviewer],
    );
    await f.db.query(
      "INSERT INTO app.user_password(user_id,password_hash,must_change_password) VALUES($1,'unused',false)",
      [reviewer],
    );
    await f.db.query(
      "INSERT INTO app.auth_session(id,organization_id,user_id,token_hash,idle_expires_at,expires_at) VALUES($1,$2,$3,$4,now()+interval '30 minutes',now()+interval '8 hours')",
      [session, f.scope.organizationId, reviewer, digest(token)],
    );
    await f.db.query(
      "INSERT INTO app.fs_project_role(organization_id,project_id,user_id,role,enabled) VALUES($1,$2,$3,'technical_reviewer',true)",
      [f.scope.organizationId, f.scope.projectId, reviewer],
    );
    const denied = await f.request('POST', `/reviews/${review.id}/approvals`, body, {
      cookie: 'sapwb_local_session=' + token,
      'idempotency-key': randomUUID(),
      'if-match': etag(workspace),
    });
    assert.equal(denied.statusCode, 422, denied.body);
    assert.equal(
      (
        await f.db.query('SELECT count(*)::int AS n FROM app.fs_approval WHERE workspace_id=$1', [
          workspace.id,
        ])
      ).rows[0].n,
      0,
    );
    assert.equal((await f.request('GET')).json().data.workspace.baseline_head, null);
    const publication = {
      review_id: review.id,
      document_version_id: input.document_version_id,
      expected_baseline_id: null,
    };
    const publishHeaders = { 'idempotency-key': randomUUID(), 'if-match': etag(workspace) };
    assert.equal(
      (await f.request('POST', '/publications', publication, publishHeaders)).statusCode,
      403,
    );
    await f.db.query(
      "INSERT INTO app.fs_project_role(organization_id,project_id,user_id,role,enabled) VALUES($1,$2,$3,'publisher',true)",
      [f.scope.organizationId, f.scope.projectId, f.scope.actorId],
    );
    assert.equal(
      (await f.request('POST', '/publications', publication, publishHeaders)).statusCode,
      422,
    );
    assert.equal(
      (
        await f.request(
          'POST',
          '/publications/withdraw',
          { document_version_id: input.document_version_id, reason: '无可撤回基线' },
          publishHeaders,
        )
      ).statusCode,
      409,
    );
  } finally {
    await f.close();
  }
});
