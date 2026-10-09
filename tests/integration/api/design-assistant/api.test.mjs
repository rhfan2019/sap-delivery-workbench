import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { apiFixture } from '../../../fixtures/fs-workspace/api.mjs';
test('OBS-08 / DBG-04 scoped API protects tasks, attachments, events and diagnostic export; old routes stay 410', async () => {
  const f = await apiFixture();
  const base = `/api/projects/${f.scope.projectId}/development-items/${f.scope.itemId}/work/design/fsd/v1`;
  const request = (method, path, payload, headers = f.headers) =>
    f.app.inject({ method, url: base + path, payload, headers });
  try {
    const created = await request('POST', '/tasks', {
      request_id: randomUUID(),
      text: 'ZPOC synthetic only',
      mode: 'SYNTHETIC',
    });
    assert.equal(created.statusCode, 200, created.body);
    const t = created.json();
    assert.equal((await request('GET', '/tasks/' + t.id)).statusCode, 200);
    assert.equal((await request('GET', '/tasks/' + t.id, undefined, {})).statusCode, 401);
    assert.equal((await request('GET', '/tasks/' + randomUUID())).statusCode, 404);
    const diag = await request('GET', '/tasks/' + t.id + '/diagnostics');
    assert.equal(diag.statusCode, 200);
    assert.equal(diag.json().source_content_included, false);
    assert.ok(diag.json().sha256);
    assert.equal(
      (await request('GET', '/tasks/' + t.id + '/diagnostics', undefined, {})).statusCode,
      401,
    );
    assert.ok(
      (
        await f.db.query(
          "SELECT 1 FROM app.audit_event WHERE organization_id=$1 AND action='fsd.v1.diagnostic.denied' AND outcome='failure'",
          [f.scope.organizationId],
        )
      ).rowCount > 0,
    );
    const contextPath = '/tasks/' + t.id + '/runs/' + t.active_run_id + '/context';
    assert.equal((await request('GET', contextPath)).json().snapshot.text, 'ZPOC synthetic only');
    assert.equal((await request('GET', contextPath, undefined, {})).statusCode, 401);
    assert.equal(
      (await request('GET', '/tasks/' + t.id + '/runs/' + randomUUID() + '/context')).statusCode,
      404,
    );
    const events = await request('GET', '/tasks/' + t.id + '/events');
    assert.ok(events.json().items.length > 0);
    const cursor = events.json().items.at(-1).cursor;
    assert.equal(
      (await request('GET', '/tasks/' + t.id + '/events?after=' + cursor)).json().items.length,
      0,
    );
    assert.equal(
      (
        await request('POST', '/tasks/' + t.id + '/attachments', {
          revision: t.revision,
          name: '../secret.txt',
          base64: 'YQ==',
        })
      ).statusCode,
      422,
    );
    const attachment = await request('POST', '/tasks/' + t.id + '/attachments', {
      revision: t.revision,
      name: 'synthetic.txt',
      base64: Buffer.from('SYNTHETIC-MARKER').toString('base64'),
    });
    assert.equal(attachment.statusCode, 200, attachment.body);
    assert.equal(
      (await request('GET', '/tasks/' + t.id + '/attachments/' + attachment.json().id)).body,
      'SYNTHETIC-MARKER',
    );
    assert.equal(
      (
        await request(
          'GET',
          '/tasks/' + t.id + '/attachments/' + attachment.json().id,
          undefined,
          {},
        )
      ).statusCode,
      401,
    );
    assert.equal(
      (await request('GET', '/tasks/' + t.id + '/diagnostics')).body.includes('SYNTHETIC-MARKER'),
      false,
    );
    for (const foreignBase of [
      base.replace(f.scope.projectId, randomUUID()),
      base.replace(f.scope.itemId, randomUUID()),
    ]) {
      for (const suffix of [
        '/diagnostics',
        '/events',
        '/runs/' + t.active_run_id + '/context',
        '/attachments/' + attachment.json().id,
      ]) {
        const denied = await f.app.inject({
          url: foreignBase + '/tasks/' + t.id + suffix,
          headers: f.headers,
        });
        assert.ok([403, 404].includes(denied.statusCode), denied.body);
        assert.equal(denied.body.includes('SYNTHETIC-MARKER'), false);
        assert.equal(denied.body.includes('ZPOC synthetic only'), false);
      }
    }
    assert.equal(
      (await f.app.inject({ url: base.replace('/fsd/v1', '/agent/runs'), headers: f.headers }))
        .statusCode,
      410,
    );
  } finally {
    await f.close();
  }
});
