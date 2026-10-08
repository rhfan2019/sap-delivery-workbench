import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { apiFixture } from '../../../../fixtures/fs-workspace/api.mjs';

function multipart(uploadId, text = '%PDF-1.7\nsynthetic') {
  const boundary = 'fs-test-boundary';
  return {
    body: Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="client_upload_id"\r\n\r\n${uploadId}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.pdf"\r\nContent-Type: application/pdf\r\n\r\n${text}\r\n--${boundary}--\r\n`,
    ),
    type: `multipart/form-data; boundary=${boundary}`,
  };
}
test('multipart upload persists quarantine, replays without duplicates and blocks source download', async () => {
  const f = await apiFixture();
  try {
    const uploadId = randomUUID(),
      key = randomUUID();
    const send = (text, keyOverride = key) => {
      const p = multipart(uploadId, text);
      return f.request('POST', '/attachments', p.body, {
        'content-type': p.type,
        'idempotency-key': keyOverride,
      });
    };
    const first = await send();
    assert.equal(first.statusCode, 202, first.body);
    const attachment = first.json().data;
    assert.equal(attachment.scan_state, 'quarantined');
    assert.equal((await send()).json().data.id, attachment.id);
    assert.equal((await send(undefined, randomUUID())).json().data.id, attachment.id);
    assert.equal((await send('%PDF-1.7\ndifferent')).statusCode, 409);
    const rows = await f.db.query('SELECT id FROM app.fs_attachment WHERE workspace_id=$1', [
      f.workspace.id,
    ]);
    assert.equal(rows.rowCount, 1);
    const retry = await f.request(
      'POST',
      `/attachments/${attachment.id}/parse`,
      { region_ids: [] },
      { 'idempotency-key': randomUUID() },
    );
    assert.equal(retry.statusCode, 202, retry.body);
    assert.equal(retry.json().data.status, 'queued');
    const runId = retry.json().data.id;
    assert.equal((await f.request('GET', `/runs/${runId}`)).statusCode, 200);
    const cancelled = await f.request(
      'POST',
      `/runs/${runId}/cancel`,
      {},
      { 'idempotency-key': randomUUID() },
    );
    assert.equal(cancelled.statusCode, 200, cancelled.body);
    assert.equal(cancelled.json().data.status, 'cancelled');
    const list = await f.request('GET', '/attachments');
    assert.equal(list.statusCode, 200, list.body);
    assert.equal(list.json().data.items.length, 1);
    const download = await f.request('GET', `/attachments/${attachment.id}/source`);
    assert.equal(download.statusCode, 422, download.body);
    await f.db.query(
      "INSERT INTO app.fs_parse_result(organization_id,project_id,workspace_id,attachment_id,parser_version,revision,state,regions,coverage,warnings,hash) VALUES($1,$2,$3,$4,'synthetic-test',1,'partial','[]',$5,'[\"OCR_UNAVAILABLE\"]','synthetic')",
      [
        f.scope.organizationId,
        f.scope.projectId,
        f.workspace.id,
        attachment.id,
        { unread_regions: ['page:2'] },
      ],
    );
    const parsedList = (await f.request('GET', '/attachments')).json().data.items;
    assert.equal(parsedList[0].parse_result.state, 'partial');
    assert.deepEqual(parsedList[0].parse_result.unread_regions, ['page:2']);
    await f.db.query(
      "UPDATE app.fs_attachment SET scan_status='clean',hash='changed-test-hash' WHERE id=$1",
      [attachment.id],
    );
    assert.equal((await f.request('GET', `/attachments/${attachment.id}/source`)).statusCode, 503);
    await f.db.query(
      "UPDATE app.project_member SET status='removed' WHERE project_id=$1 AND user_id=$2",
      [f.scope.projectId, f.scope.actorId],
    );
    assert.equal((await f.request('GET', '/attachments')).statusCode, 404);
  } finally {
    await f.close();
  }
});
