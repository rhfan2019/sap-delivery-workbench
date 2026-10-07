import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { apiFixture } from '../fixtures/api.mjs';
import { saveModel } from '../../../apps/api/src/models/store.mjs';
test('multi-turn API pins scoped requirement, rejects stale/cross-project/archived and preserves legacy FS', async () => {
  process.env.LLM_CREDENTIAL_KEY = 'a'.repeat(64);
  let received;
  const f = await apiFixture({
    agentStream: async (c, k, p, o) => {
      received = o.context;
      o.onDelta('ok');
      return { modelId: c.modelId };
    },
  });
  try {
    await f.db.query(
      "UPDATE app.organization_member SET access_level='admin' WHERE organization_id=$1 AND user_id=$2",
      [f.scope.organizationId, f.scope.actorId],
    );
    const m = await saveModel(f.db, f.scope.organizationId, f.scope.actorId, {
      name: 'context',
      provider: 'test',
      protocol: 'openai_chat',
      baseUrl: 'https://api.example.com/v1',
      modelId: 'm',
      apiKey: 'k',
      maxOutputTokens: 100,
      temperature: null,
      timeoutSeconds: 5,
    });
    const old = (
      await f.db.query('SELECT sections FROM app.fs_draft WHERE item_id=$1', [f.scope.itemId])
    ).rows;
    const body = {
      modelId: m.id,
      rowVersion: m.rowVersion,
      requestId: randomUUID(),
      prompt: '继续',
      messages: [
        { id: 'u1', role: 'user', content: '需求A', status: 'completed' },
        { id: 'a1', role: 'assistant', content: '回答A', status: 'completed' },
      ],
      selection: {
        projectId: f.scope.projectId,
        itemId: f.scope.itemId,
        itemRowVersion: '1',
        systemId: null,
        environment: 'DEV',
        consultantVersion: 'ECC 6.0 EHP8',
      },
    };
    const post = (b) =>
      f.app.inject({
        method: 'POST',
        url: '/api/admin/abap-fsd-agent/runs',
        headers: f.headers,
        payload: b,
      });
    const r = await post(body);
    assert.equal(r.statusCode, 202, r.body);
    await f.app.inject({
      method: 'GET',
      url: `/api/admin/abap-fsd-agent/runs/${r.json().runId}/events`,
      headers: f.headers,
    });
    assert.match(JSON.stringify(received), /需求A/);
    assert.match(JSON.stringify(received), /ECC 6.0/);
    assert.equal(r.json().association.itemId, f.scope.itemId);
    assert.equal(r.json().systemProfile.identificationSource, 'consultant');
    assert.equal(
      (
        await post({
          ...body,
          requestId: randomUUID(),
          selection: { ...body.selection, itemRowVersion: '99' },
        })
      ).statusCode,
      409,
    );
    assert.equal(
      (
        await post({
          ...body,
          requestId: randomUUID(),
          selection: { ...body.selection, itemId: randomUUID() },
        })
      ).statusCode,
      404,
    );
    assert.equal(
      (
        await post({
          ...body,
          requestId: randomUUID(),
          messages: [{ id: 'x', role: 'system', content: 'evil', status: 'completed' }],
        })
      ).statusCode,
      400,
    );
    await f.db.query(
      "UPDATE app.project_member SET status='removed' WHERE project_id=$1 AND user_id=$2",
      [f.scope.projectId, f.scope.actorId],
    );
    assert.equal(
      (
        await f.app.inject({
          method: 'GET',
          url: '/api/admin/abap-fsd-agent/runs/' + r.json().runId + '/events',
          headers: f.headers,
        })
      ).statusCode,
      404,
    );
    assert.equal(
      (await post(body)).statusCode,
      404,
      'idempotent receipt cannot bypass revoked project access',
    );
    await f.db.query(
      "UPDATE app.project_member SET status='active' WHERE project_id=$1 AND user_id=$2",
      [f.scope.projectId, f.scope.actorId],
    );
    await f.db.query("UPDATE app.project SET status='archived', archived_at=now() WHERE id=$1", [
      f.scope.projectId,
    ]);
    assert.equal((await post({ ...body, requestId: randomUUID() })).statusCode, 409);
    assert.deepEqual(
      (await f.db.query('SELECT sections FROM app.fs_draft WHERE item_id=$1', [f.scope.itemId]))
        .rows,
      old,
    );
  } finally {
    await f.close();
  }
});
import { saveRows } from '../../../apps/api/src/sap/store.mjs';
test('SAP resolver calls selected system via MCP and keeps partial evidence separate from consultant facts', async () => {
  process.env.SAP_CREDENTIAL_KEY = 'b'.repeat(64);
  let connections = 0,
    closed = 0;
  const f = await apiFixture({
    agentConnect: async (env) => {
      connections++;
      assert.equal(env.SAP_URL, 'https://sap.example.com');
      assert.equal(env.SAP_PASSWORD, 'test-only');
      return {
        tools: [{ name: 'tableContents' }],
        call: async (name, args) => ({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'success',
                result: {
                  values: [
                    { COMPONENT: 'S4CORE', RELEASE: '107' },
                    { COMPONENT: 'SAP_BASIS', RELEASE: '757' },
                  ],
                },
              }),
            },
          ],
        }),
        close: async () => {
          closed++;
        },
      };
    },
  });
  try {
    await f.db.query(
      "UPDATE app.organization_member SET access_level='admin' WHERE organization_id=$1 AND user_id=$2",
      [f.scope.organizationId, f.scope.actorId],
    );
    const systemId = randomUUID();
    await f.db.query(
      "INSERT INTO app.sap_system(id,organization_id,code,name,sap_url,status,language) VALUES($1,$2,'T','Test','https://sap.example.com','active','EN')",
      [systemId, f.scope.organizationId],
    );
    const project = (await f.db.query('SELECT * FROM app.project WHERE id=$1', [f.scope.projectId]))
      .rows[0];
    const configured = await f.app.inject({
      method: 'POST',
      url: `/api/admin/projects/${project.id}/sap`,
      headers: f.headers,
      payload: {
        rows: [
          {
            environment: 'DEV',
            systemId,
            client: '100',
            username: 'TEST',
            language: 'EN',
            passwordAction: 'replace',
            password: 'test-only',
            rowVersion: '0',
          },
          { environment: 'QAS', rowVersion: '0', passwordAction: 'clear' },
          { environment: 'PRD', rowVersion: '0', passwordAction: 'clear' },
        ],
      },
    });
    assert.equal(configured.statusCode, 200, configured.body);
    const post = (selection) =>
      f.app.inject({
        method: 'POST',
        url: '/api/admin/abap-fsd-agent/system-profile',
        headers: f.headers,
        payload: selection,
      });
    const a = await post({ projectId: project.id, systemId, environment: 'DEV' });
    assert.equal(a.statusCode, 200, a.body);
    assert.equal(a.json().profile.product, 'SAP S/4HANA');
    assert.equal(a.json().discoveryStatus, 'partial');
    assert.ok(a.json().question);
    assert.equal(connections, 1);
    assert.equal(closed, 1);
    assert.doesNotMatch(a.body, /test-only/);
    const b = await post({ systemId, environment: 'DEV' });
    assert.equal(b.json().discoveryStatus, 'unavailable');
    assert.equal(connections, 1);
    assert.equal((await post({ projectId: project.id, systemId: randomUUID() })).statusCode, 404);
    const no = await post({ consultantVersion: '未知' });
    assert.equal(no.json().identificationSource, 'consultant');
    assert.equal(no.json().profile.product, null);
  } finally {
    await f.close();
  }
});
