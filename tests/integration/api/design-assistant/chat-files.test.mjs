import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { transaction, fixture } from '../../../fixtures/fs-workspace/database.mjs';
import { createChatConversation } from '../../../../apps/api/src/modules/design-assistant/chat-service.mjs';
import { assetManifest } from '../../../../apps/api/src/modules/design-assistant/assets.mjs';
import { registerChatFiles } from '../../../../apps/api/src/modules/design-assistant/chat-files.mjs';

test('chat files preserve bytes, scope and original UI protocol while rejecting active edits', async () => {
  await transaction(async (db) => {
    const scope = await fixture(db),
      assets = await assetManifest();
    const task = await createChatConversation(db, scope, assets);
    let actor = scope;
    const app = Fastify();
    registerChatFiles(app, db, '/chat', {
      authorize: async () => actor,
      write: async (req, fn) => fn(db, actor),
    });
    const upload = (name = 'requirements.txt') =>
      app.inject({
        method: 'POST',
        url: `/chat/conversations/${task.id}/attachments`,
        headers: { 'content-type': 'multipart/form-data; boundary=files' },
        payload: `--files\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: text/plain\r\n\r\nSAP requirement\r\n--files--\r\n`,
      });
    try {
      const created = await upload();
      assert.equal(created.statusCode, 200, created.body);
      const attachment = created.json();
      assert.equal(attachment.state, 'ready');
      assert.ok(Array.isArray(attachment.extraction.warnings));
      assert.equal(attachment.extraction.warnings.join('；'), attachment.warnings.join('；'));
      const list = await app.inject(`/chat/sessions/${task.id}/files`);
      assert.equal(list.json().inputs[0].bytes, 15);
      const preview = await app.inject(`/chat/sessions/${task.id}/files/${attachment.id}`);
      assert.equal(preview.json().extraction.regions[0].text, 'SAP requirement');
      const download = await app.inject(
        `/chat/conversations/${task.id}/attachments/${attachment.id}`,
      );
      assert.equal(download.body, 'SAP requirement');
      assert.equal(download.headers['content-type'], 'application/octet-stream');
      actor = { ...scope, actorId: '00000000-0000-4000-8000-000000000000' };
      assert.equal((await app.inject(`/chat/sessions/${task.id}/files`)).statusCode, 404);
      actor = scope;
      assert.equal((await upload('unsafe.svg')).statusCode, 422);
      assert.equal((await upload('../requirements.txt')).statusCode, 422);
      await db.query("UPDATE app.fsd_v1_run SET status='QUEUED' WHERE id=$1", [task.active_run_id]);
      assert.equal((await upload()).statusCode, 409);
      assert.equal(
        (
          await app.inject({
            method: 'DELETE',
            url: `/chat/conversations/${task.id}/attachments/${attachment.id}`,
          })
        ).statusCode,
        409,
      );
      await db.query("UPDATE app.fsd_v1_run SET status='WAITING' WHERE id=$1", [
        task.active_run_id,
      ]);
      await db.query(
        "UPDATE app.fsd_v1_task SET state=jsonb_set(jsonb_set(state,'{chat,draftApproved}','true'),'{wait_reason}','\"PLAN_CONFIRM\"') WHERE id=$1",
        [task.id],
      );
      assert.equal(
        (
          await app.inject({
            method: 'DELETE',
            url: `/chat/conversations/${task.id}/attachments/${attachment.id}`,
          })
        ).statusCode,
        200,
      );
      const invalidated = (
        await db.query('SELECT state,revision FROM app.fsd_v1_task WHERE id=$1', [task.id])
      ).rows[0];
      assert.equal(invalidated.state.chat.draftApproved, false);
      assert.equal(invalidated.state.wait_reason, 'CHAT_READY');
      assert.equal(
        (await db.query('SELECT status FROM app.fsd_v1_run WHERE id=$1', [task.active_run_id]))
          .rows[0].status,
        'CANCELLED',
      );
      assert.equal((await app.inject(`/chat/sessions/${task.id}/files`)).json().inputs.length, 0);
      assert.equal(
        (await app.inject(`/chat/sessions/${task.id}/files/${attachment.id}`)).statusCode,
        404,
      );
      assert.equal(
        (
          await db.query('SELECT bytes FROM app.fsd_v1_attachment WHERE id=$1', [attachment.id])
        ).rows[0].bytes.toString(),
        'SAP requirement',
      );
      for (let i = 0; i < 10; i++) assert.equal((await upload()).statusCode, 200);
      assert.equal(
        (await upload()).statusCode,
        413,
        'ten active attachments are the conversation limit',
      );
    } finally {
      await app.close();
    }
  });
});
