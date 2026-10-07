import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { apiFixture } from '../fixtures/api.mjs';
import { saveModel } from '../../../apps/api/src/models/store.mjs';
import { readFile } from 'node:fs/promises';

test('stage drafts persist independently, preserve history, reject conflicts and pin design versions', async () => {
  const f = await apiFixture();
  const base = f.base.replace('/fs-workspace', '/work/');
  const req = (method, path, payload) =>
    f.app.inject({ method, url: base + path, payload, headers: f.headers });
  try {
    let r = await req('POST', 'design', {});
    assert.equal(r.statusCode, 200, r.body);
    const first = r.json();
    assert.equal(first.canEdit, true);
    assert.match(first.head.document.notes, /保留原文/);
    r = await req('PATCH', 'design', {
      baseVersionId: first.head.id,
      document: { ...first.head.document, notes: '人工修改的新需求' },
    });
    assert.equal(r.statusCode, 200, r.body);
    const design = r.json();
    assert.notEqual(design.head.id, first.head.id);
    assert.equal(
      (
        await req('PATCH', 'design', {
          baseVersionId: first.head.id,
          document: first.head.document,
        })
      ).statusCode,
      409,
    );
    assert.equal(
      (
        await req('PATCH', 'design', {
          baseVersionId: design.head.id,
          document: design.head.document,
          sourceArtifactId: randomUUID(),
        })
      ).statusCode,
      400,
    );
    r = await req('GET', 'design/versions/' + first.head.id);
    assert.equal(r.statusCode, 200, r.body);
    assert.match(r.json().document.notes, /保留原文/);
    r = await req('POST', 'development', {});
    assert.equal(r.statusCode, 200, r.body);
    let dev = r.json();
    assert.equal(dev.head.designVersionId, null);
    r = await req('PATCH', 'development', {
      baseVersionId: dev.head.id,
      designVersionId: design.head.id,
      document: { ...dev.head.document, code: 'REPORT ztest.' },
    });
    assert.equal(r.statusCode, 200, r.body);
    dev = r.json();
    assert.equal(dev.head.designVersionId, design.head.id);
    await req('PATCH', 'design', {
      baseVersionId: design.head.id,
      document: { ...design.head.document, notes: '设计又改了' },
    });
    r = await req('GET', 'development');
    assert.equal(r.json().head.designVersionId, design.head.id);
    assert.equal(r.json().designChanged, true);
    assert.equal(r.json().head.document.code, 'REPORT ztest.');
    assert.equal((await req('GET', 'development/versions/' + design.head.id)).statusCode, 404);
    assert.equal(
      (
        await req('PATCH', 'development', {
          baseVersionId: dev.head.id,
          designVersionId: randomUUID(),
          document: dev.head.document,
        })
      ).statusCode,
      404,
    );
    const foreign = await f.app.inject({
      method: 'GET',
      url: base.replace(f.scope.itemId, randomUUID()) + 'design',
      headers: f.headers,
    });
    assert.equal(foreign.statusCode, 404);
  } finally {
    await f.close();
  }
});

test('project owner uses shared agents; current manual draft and pinned design are supplied; stage histories cannot cross', async () => {
  const contexts = [];
  const example = JSON.parse(
    await readFile('packages/contracts/abap-fsd-agent/fsd/v1/r.example.json', 'utf8'),
  );
  const devDocument = {
    kind: 'development',
    title: '采购报表程序',
    overview: '只读',
    technicalDesign: '按设计取数',
    code: 'REPORT ztest.',
    tests: '准备条件与预期，尚未执行',
    notes: '',
  };
  const f = await apiFixture({
    agentStream: async (_config, _key, _prompt, options) => {
      if (options.context.manifest.task === 'plan') {
        options.onDelta(
          JSON.stringify({
            tasks: [
              {
                id: 'T1',
                goal: '验证设计',
                dependsOn: [],
                doneWhen: '口径与测试明确',
                entityIds: [],
                needsEvidence: false,
              },
            ],
            scenario: { editable: false, objectFeedback: false },
          }),
        );
        return { modelId: 'test' };
      }

      contexts.push(options.context);
      const task = options.context.manifest.task;
      options.onDelta(
        task === 'clarification'
          ? '{"kind":"ready"}'
          : task === 'development'
            ? JSON.stringify(devDocument)
            : JSON.stringify({ ...example, sources: options.context.manifest.sources }),
      );
      return { finishReason: 'stop' };
    },
  });
  const base = f.base.replace('/fs-workspace', '/work/');
  const req = (method, path, payload) =>
    f.app.inject({ method, url: base + path, payload, headers: f.headers });
  try {
    const model = await saveModel(f.db, f.scope.organizationId, f.scope.actorId, {
      name: '阶段隔离测试',
      provider: 'test',
      protocol: 'openai_chat',
      baseUrl: 'https://api.example.com/v1',
      modelId: 'synthetic',
      apiKey: 'synthetic',
      maxOutputTokens: 20000,
      temperature: null,
      timeoutSeconds: 30,
    });
    let design = (await req('POST', 'design', {})).json();
    design = (
      await req('PATCH', 'design', {
        baseVersionId: design.head.id,
        document: { ...design.head.document, notes: '人工最新要求：按单位分组' },
      })
    ).json();
    const body = {
      modelId: model.id,
      rowVersion: model.rowVersion,
      requestId: randomUUID(),
      prompt: '生成采购清单报表',
      action: 'draft',
      riceType: 'R',
    };
    let r = await req('POST', 'design/agent/runs', body);
    assert.equal(r.statusCode, 202, r.body);
    const started = r.json();
    await req('GET', `design/agent/runs/${started.runId}/events`);
    const boundary = 'work-integration-upload';
    const upload = await f.app.inject({
      method: 'POST',
      url: base + `design/agent/conversations/${started.conversationId}/attachments`,
      headers: { ...f.headers, 'content-type': 'multipart/form-data; boundary=' + boundary },
      payload: `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="需求.txt"\r\nContent-Type: text/plain\r\n\r\n人工附件要求：按单位分组\r\n--${boundary}--\r\n`,
    });
    assert.equal(upload.statusCode, 200, upload.body);
    assert.equal(upload.json().state, 'ready');
    r = await req('GET', `design/agent/runs/${started.runId}`);
    const run = r.json();
    assert.ok(run.artifact, JSON.stringify(run));
    assert.ok(contexts.some((c) => JSON.stringify(c.messages).includes('人工最新要求')));
    assert.equal((await req('GET', `development/agent/runs/${started.runId}`)).statusCode, 404);
    r = await req('POST', 'design/adopt', {
      artifactId: run.artifact.id,
      baseVersionId: design.head.id,
    });
    assert.equal(r.statusCode, 200, r.body);
    design = r.json();
    assert.equal(design.head.document.spec.riceType, 'R');
    const spoofed = structuredClone(design.head.document);
    spoofed.spec.systemContext.identificationSource = 'mcp';
    assert.equal(
      (await req('PATCH', 'design', { baseVersionId: design.head.id, document: spoofed }))
        .statusCode,
      422,
    );
    assert.equal(design.head.markdown.split('### 2.1 权限设计')[1].split('### 2.2')[0].trim(), '');
    const firstDesign = design.head;
    const workflowUrl = `design/agent/conversations/${started.conversationId}/workflow`;
    const workflow = (await req('GET', workflowUrl)).json();
    const revised = await req('POST', workflowUrl, {
      command: 'revise',
      expectedVersion: workflow.version,
      requestId: randomUUID(),
    });
    assert.equal(revised.statusCode, 200, revised.body);
    r = await req('POST', 'design/agent/runs', {
      ...body,
      requestId: randomUUID(),
      conversationId: started.conversationId,
    });
    assert.equal(r.statusCode, 202, r.body);
    const again = r.json();
    await req('GET', `design/agent/runs/${again.runId}/events`);
    const nextRun = (await req('GET', `design/agent/runs/${again.runId}`)).json();
    r = await req('POST', 'design/adopt', {
      artifactId: nextRun.artifact.id,
      baseVersionId: design.head.id,
    });
    assert.equal(r.statusCode, 200, r.body);
    design = r.json();
    assert.notEqual(design.head.document.spec.revision, firstDesign.document.spec.revision);
    r = await req('POST', 'design/restore', {
      versionId: firstDesign.id,
      baseVersionId: design.head.id,
    });
    assert.equal(r.statusCode, 200, r.body);
    design = r.json();
    assert.deepEqual(
      design.head.document.spec,
      firstDesign.document.spec,
      '可信历史的系统证据与原FSD内容可完整恢复',
    );
    let dev = (await req('POST', 'development', {})).json();
    assert.equal(
      (await req('POST', 'development/agent/runs', { ...body, requestId: randomUUID() }))
        .statusCode,
      409,
    );
    dev = (
      await req('PATCH', 'development', {
        baseVersionId: dev.head.id,
        document: dev.head.document,
        designVersionId: design.head.id,
      })
    ).json();
    r = await req('POST', 'development/agent/runs', { ...body, requestId: randomUUID() });
    assert.equal(r.statusCode, 202, r.body);
    const devRun = r.json();
    await req('GET', `development/agent/runs/${devRun.runId}/events`);
    r = await req('GET', `development/agent/runs/${devRun.runId}`);
    assert.ok(r.json().artifact, r.body);
    const devArtifact = r.json().artifact;
    assert.equal(contexts.at(-1).manifest.workContext.designVersionId, design.head.id);
    r = await req('POST', 'development/adopt', {
      artifactId: devArtifact.id,
      baseVersionId: dev.head.id,
    });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().head.document.code, 'REPORT ztest.');
    assert.equal(
      (
        await req('POST', 'development/adopt', {
          artifactId: devArtifact.id,
          baseVersionId: r.json().head.id,
        })
      ).statusCode,
      409,
      '旧候选不得覆盖后续工作稿',
    );
    assert.equal((await req('GET', 'design/sessions')).json().items.length, 1);
    assert.equal((await req('GET', 'development/sessions')).json().items.length, 1);
    r = await req('POST', 'development/agent/runs', {
      ...body,
      requestId: randomUUID(),
      conversationId: started.conversationId,
    });
    assert.equal(r.statusCode, 409, r.body);
  } finally {
    await f.close();
  }
});

test('readable project membership does not grant stage editing or cross-project access', async () => {
  const f = await apiFixture();
  const base = f.base.replace('/fs-workspace', '/work/');
  const req = (method, path, payload) =>
    f.app.inject({ method, url: base + path, payload, headers: f.headers });
  try {
    const first = (await req('POST', 'design', {})).json();
    const other = randomUUID();
    await f.db.query('INSERT INTO app.app_user(id,login_name,display_name) VALUES($1,$2,$2)', [
      other,
      'owner-' + other,
    ]);
    await f.db.query('INSERT INTO app.organization_member(organization_id,user_id) VALUES($1,$2)', [
      f.scope.organizationId,
      other,
    ]);
    await f.db.query(
      'INSERT INTO app.project_member(organization_id,project_id,user_id) VALUES($1,$2,$3)',
      [f.scope.organizationId, f.scope.projectId, other],
    );
    await f.db.query(
      'UPDATE app.development_item SET business_owner_id=$2,developer_id=$2 WHERE id=$1',
      [f.scope.itemId, other],
    );
    let r = await req('GET', 'design');
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().canEdit, false);
    assert.equal(
      (
        await req('PATCH', 'design', {
          baseVersionId: first.head.id,
          document: first.head.document,
        })
      ).statusCode,
      403,
    );
    assert.equal((await req('POST', 'design/agent/conversations', {})).statusCode, 403);
    assert.equal((await req('POST', 'development', {})).statusCode, 403);
    await f.db.query(
      "UPDATE app.project_member SET status='removed' WHERE project_id=$1 AND user_id=$2",
      [f.scope.projectId, f.scope.actorId],
    );
    assert.equal((await req('GET', 'design')).statusCode, 404);
  } finally {
    await f.close();
  }
});
