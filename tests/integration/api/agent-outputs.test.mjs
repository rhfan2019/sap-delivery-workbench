import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { apiFixture } from '../../fixtures/api.mjs';
import { grantRole } from '../../fixtures/access.mjs';

// docs/specs/agent-workspace-start-and-composer.md 6: the assistant pages need agent.*:run;
// agent.*:view only reads the outputs in the item drawer, without the conversation.
const fake = {
  resolveModel: async () => ({
    versionId: 'v',
    config: { name: 'Fake', modelId: 'fake' },
    key: 'k',
  }),
};

async function setup() {
  const f = await apiFixture({ abapFsdAgent: fake, abapDevAgent: fake });
  const root = `/api/projects/${f.scope.projectId}/development-items/${f.scope.itemId}`;
  const call = async (method, url, payload) => {
    const res = await f.app.inject({ method, url: root + url, payload, headers: f.headers });
    return { status: res.statusCode, body: res.body, headers: res.headers, json: () => res.json() };
  };
  // Leave the member with the observer role only (PRJ_VIEW: view, no run).
  const becomeObserver = async () => {
    await f.db.query('DELETE FROM app.access_project_role WHERE project_id=$1 AND user_id=$2', [
      f.scope.projectId,
      f.scope.actorId,
    ]);
    await grantRole(f.db, f.scope.organizationId, f.scope.actorId, 'C_OBSERVER', {
      projectId: f.scope.projectId,
    });
  };
  return { f, root, call, becomeObserver };
}

test('design outputs: the newest and the final FSD for viewers, the page only for runners', async () => {
  const { f, call, becomeObserver } = await setup();
  try {
    const listed = (await call('GET', '/abap-fsd-agent/sessions')).json();
    assert.deepEqual(listed.stages, { design: true, development: true });
    const sid = (await call('POST', '/abap-fsd-agent/sessions', {})).json().id;
    for (const [version, labels] of [
      [1, ['定稿']],
      [2, []],
    ])
      await f.db.query(
        `INSERT INTO app.abap_fsd_agent_document(id,session_id,version,markdown,labels,created_by,created_at)
         VALUES($1,$2,$3::int,$4,$5,$6,now() + make_interval(secs => $3::int))`,
        [randomUUID(), sid, version, `# FSD 第 ${version} 版`, labels, f.scope.actorId],
      );

    await becomeObserver();
    // The page and everything on it: 403 naming the missing permission.
    for (const [method, url] of [
      ['GET', '/abap-fsd-agent/sessions'],
      ['GET', `/abap-fsd-agent/sessions/${sid}`],
      ['GET', `/abap-fsd-agent/sessions/${sid}/documents/1`],
      ['POST', '/abap-fsd-agent/sessions'],
    ]) {
      const r = await call(method, url, method === 'POST' ? {} : undefined);
      assert.equal(r.status, 403, `${method} ${url}`);
      assert.equal(r.json().details.permission, 'agent.fsd:run');
    }
    const outputs = (await call('GET', '/abap-fsd-agent/outputs')).json();
    assert.equal(outputs.latest.version, 2);
    assert.equal(outputs.final.version, 1);
    assert.equal(outputs.latest.sessionId, sid);
    const doc = (await call('GET', `/abap-fsd-agent/outputs/${sid}/1`)).json();
    assert.equal(doc.markdown, '# FSD 第 1 版');
    assert.equal('comments' in doc, false);
    const download = await call('GET', `/abap-fsd-agent/outputs/${sid}/2?download=1`);
    assert.equal(download.body, '# FSD 第 2 版');
    assert.match(download.headers['content-disposition'], /FSD-v2\.md/);
    assert.equal((await call('GET', `/abap-fsd-agent/outputs/${sid}/9`)).status, 404);
  } finally {
    await f.close();
  }
});

test('development outputs for viewers; an item outside the project is 404', async () => {
  const { f, root, call, becomeObserver } = await setup();
  try {
    const sid = (await call('POST', '/abap-dev-agent/sessions', {})).json().id;
    await f.db.query(
      `INSERT INTO app.abap_dev_agent_version(id,session_id,version,plan,code,source,labels,created_by)
       VALUES($1,$2,1,'方案','REPORT z.\nWRITE 1.','assistant','{定稿}',$3)`,
      [randomUUID(), sid, f.scope.actorId],
    );
    await becomeObserver();
    assert.equal((await call('GET', '/abap-dev-agent/sessions')).status, 403);
    const outputs = (await call('GET', '/abap-dev-agent/outputs')).json();
    assert.equal(outputs.final.version, 1);
    assert.equal(outputs.final.codeLines, 2);
    const code = await call('GET', `/abap-dev-agent/outputs/${sid}/1?download=code`);
    assert.equal(code.body, 'REPORT z.\nWRITE 1.');

    // An item outside the project is 404 for the outputs as for the page.
    const other = root.replace(f.scope.itemId, randomUUID());
    const r = await f.app.inject({
      method: 'GET',
      url: other + '/abap-dev-agent/outputs',
      headers: f.headers,
    });
    assert.equal(r.statusCode, 404);
  } finally {
    await f.close();
  }
});
