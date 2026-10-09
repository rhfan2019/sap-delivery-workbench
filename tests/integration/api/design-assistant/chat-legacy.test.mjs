import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { transaction, fixture } from '../../../fixtures/fs-workspace/database.mjs';
import {
  listLegacyChatSessions,
  legacyChatRun,
  legacyChatArtifact,
} from '../../../../apps/api/src/modules/design-assistant/chat-legacy.mjs';
import { registerChatFiles } from '../../../../apps/api/src/modules/design-assistant/chat-files.mjs';

test('legacy design reads preserve history and files without allowing foreign scope or restarting runs', async () =>
  transaction(async (db) => {
    const scope = await fixture(db),
      session = randomUUID(),
      run = randomUUID(),
      artifact = randomUUID(),
      file = randomUUID();
    await db.query(
      'INSERT INTO app.fsd_agent_session(id,organization_id,actor_id,selection) VALUES($1,$2,$3,$4)',
      [
        session,
        scope.organizationId,
        scope.actorId,
        { projectId: scope.projectId, itemId: scope.itemId, workspaceStage: 'design' },
      ],
    );
    await db.query(
      "INSERT INTO app.fsd_agent_run(id,organization_id,actor_id,conversation_id,request_id,request_hash,state,snapshot) VALUES($1,$2,$3,$4,$5,'legacy','running',$6)",
      [
        run,
        scope.organizationId,
        scope.actorId,
        session,
        randomUUID(),
        { prompt: '历史需求', text: '历史正文' },
      ],
    );
    await db.query(
      "INSERT INTO app.fsd_agent_revision(id,organization_id,actor_id,conversation_id,run_id,revision,spec,markdown,content_hash,evidence,manifest) VALUES($1,$2,$3,$4,$5,1,'{}','保留的成果','hash','{}','{}')",
      [artifact, scope.organizationId, scope.actorId, session, run],
    );
    await db.query(
      "INSERT INTO app.fsd_agent_attachment(id,organization_id,actor_id,conversation_id,name,bytes,content_hash,state,extraction) VALUES($1,$2,$3,$4,'原始需求.txt',12,'hash','ready',$5)",
      [
        file,
        scope.organizationId,
        scope.actorId,
        session,
        { regions: [{ text: '保留的附件', locator: 'lines:1' }], warnings: [] },
      ],
    );
    const sessions = await listLegacyChatSessions(db, scope);
    assert.equal(sessions[0].id, session);
    assert.equal(sessions[0].legacy, true);
    const snapshot = await legacyChatRun(db, scope, run);
    assert.equal(snapshot.legacy, true);
    assert.equal(snapshot.state, 'failed');
    assert.equal(snapshot.history[1].content, '历史正文');
    assert.equal(snapshot.artifact.markdown, '保留的成果');
    assert.equal((await legacyChatArtifact(db, scope, artifact)).contentHash, 'hash');
    assert.equal(
      (await db.query('SELECT state FROM app.fsd_agent_run WHERE id=$1', [run])).rows[0].state,
      'running',
    );
    const foreign = { ...scope, itemId: randomUUID() };
    assert.deepEqual(await listLegacyChatSessions(db, foreign), []);
    await assert.rejects(legacyChatRun(db, foreign, run), { statusCode: 404 });
    await assert.rejects(legacyChatArtifact(db, foreign, artifact), { statusCode: 404 });
    const app = Fastify();
    registerChatFiles(app, db, '/chat', {
      authorize: async () => scope,
      write: async (req, fn) => fn(db, scope),
    });
    try {
      assert.equal((await app.inject(`/chat/sessions/${session}/files`)).json().inputs[0].id, file);
      assert.equal(
        (await app.inject(`/chat/sessions/${session}/files/${file}`)).json().extraction.regions[0]
          .text,
        '保留的附件',
      );
      assert.equal(
        (
          await app.inject({
            method: 'DELETE',
            url: `/chat/conversations/${session}/attachments/${file}`,
          })
        ).statusCode,
        404,
      );
    } finally {
      await app.close();
    }
    await db.query(
      'UPDATE app.fsd_agent_session SET selection=selection || \'{"workspaceStage":"development"}\'::jsonb WHERE id=$1',
      [session],
    );
    assert.deepEqual(await listLegacyChatSessions(db, scope), []);
    await assert.rejects(legacyChatRun(db, scope, run), { statusCode: 404 });
  }));
