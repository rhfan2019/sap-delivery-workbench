import test from 'node:test';
import assert from 'node:assert/strict';
import { apiFixture } from '../../../fixtures/fs-workspace/api.mjs';
import { randomUUID } from 'node:crypto';
import { saveModel } from '../../../../apps/api/src/modules/models/store.mjs';
import { transaction } from '../../../../apps/api/src/platform/auth.mjs';
import { createChatConversation } from '../../../../apps/api/src/modules/design-assistant/chat-service.mjs';
import { saveTask } from '../../../../apps/api/src/modules/design-assistant/repository.mjs';
import { assetManifest } from '../../../../apps/api/src/modules/design-assistant/assets.mjs';

test('versioned chat creates private idle conversations without restoring legacy endpoints', async () => {
  const f = await apiFixture();
  const work = `/api/projects/${f.scope.projectId}/development-items/${f.scope.itemId}/work/design`;
  try {
    const created = await f.app.inject({
      method: 'POST',
      url: work + '/fsd/v1/chat/conversations',
      payload: {},
      headers: f.headers,
    });
    assert.equal(created.statusCode, 200, created.body);
    assert.ok(created.json().conversationId);
    const list = await f.app.inject({ url: work + '/fsd/v1/chat/sessions', headers: f.headers });
    assert.equal(list.json().items[0].id, created.json().conversationId);
    assert.equal(list.json().items[0].runId, null);
    assert.equal((await f.app.inject({ url: work + '/fsd/v1/chat/sessions' })).statusCode, 401);
    assert.equal(
      (
        await f.app.inject({
          method: 'POST',
          url: work + '/agent/runs',
          headers: f.headers,
          payload: {},
        })
      ).statusCode,
      410,
    );
  } finally {
    await f.close();
  }
});

test('chat HTTP receipts deduplicate and candidate adoption preserves existing editable content', async () => {
  const priorKey = process.env.LLM_CREDENTIAL_KEY,
    priorApproval = process.env.FSD_REAL_INPUT_APPROVED;
  process.env.LLM_CREDENTIAL_KEY = 'a'.repeat(64);
  process.env.FSD_REAL_INPUT_APPROVED = 'true';
  const f = await apiFixture();
  const work = `/api/projects/${f.scope.projectId}/development-items/${f.scope.itemId}/work/design`,
    base = work + '/fsd/v1/chat';
  const req = (method, path, payload) =>
    f.app.inject({ method, url: path, payload, headers: f.headers });
  try {
    const model = await saveModel(f.db, f.scope.organizationId, f.scope.actorId, {
      name: 'chat-api-test',
      provider: 'Synthetic',
      protocol: 'openai_chat',
      baseUrl: 'https://api.example.com/v1',
      modelId: 'test',
      apiKey: 'synthetic',
      temperature: null,
    });
    const body = {
      requestId: randomUUID(),
      prompt: '你好',
      action: 'auto',
      modelId: model.id,
      selection: { projectId: f.scope.projectId, itemId: f.scope.itemId, workspaceStage: 'design' },
    };
    const first = await req('POST', base + '/runs', body),
      second = await req('POST', base + '/runs', body);
    assert.equal(first.statusCode, 200, first.body);
    assert.deepEqual(second.json(), first.json());
    assert.equal(
      (await req('GET', base + '/runs/' + first.json().runId + '/diagnostics')).statusCode,
      200,
    );
    await req('POST', base + '/runs/' + first.json().runId + '/cancel', {});
    const workspace = (await req('POST', work, {})).json();
    const original = workspace.head.document;
    const artifactId = randomUUID();
    // Fixture candidate checks adoption's version contract, not model quality.
    const t = await createChatConversation(f.db, f.scope, await assetManifest());
    t.artifacts = [
      {
        id: artifactId,
        version: 1,
        kind: 'PLAN',
        objects: {
          'section-1': { object_id: 'section-1', section: 1, content: '新的八章节候选内容' },
        },
        evidence_refs: [],
        issues: [],
        workspace_version_id: workspace.head.id,
      },
    ];
    await saveTask(f.db, t);
    const adopted = await req('POST', base + '/adopt', {
      artifactId,
      baseVersionId: workspace.head.id,
    });
    assert.equal(adopted.statusCode, 200, adopted.body);
    assert.deepEqual(adopted.json().head.document.spec, original.spec);
    assert.ok(adopted.json().head.document.notes.includes('新的八章节候选内容'));
    if (original.notes) assert.ok(adopted.json().head.document.notes.includes(original.notes));
    assert.equal(
      (await req('POST', base + '/adopt', { artifactId, baseVersionId: workspace.head.id }))
        .statusCode,
      409,
    );
  } finally {
    await f.close();
    if (priorKey === undefined) delete process.env.LLM_CREDENTIAL_KEY;
    else process.env.LLM_CREDENTIAL_KEY = priorKey;
    if (priorApproval === undefined) delete process.env.FSD_REAL_INPUT_APPROVED;
    else process.env.FSD_REAL_INPUT_APPROVED = priorApproval;
  }
});
