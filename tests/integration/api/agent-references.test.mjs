import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { apiFixture } from '../../fixtures/api.mjs';

// docs/specs/agent-workspace-start-and-composer.md 4.2: a message may reference the item's
// business function, its files and other conversations' files; each becomes one attachment.
const done = {
  content: '好的。',
  reasoning: '',
  toolCalls: [],
  finishReason: 'stop',
  usage: { prompt_tokens: 1, completion_tokens: 1 },
};

test('references become attachments once; foreign or unsupported ones are refused', async () => {
  const seen = [];
  const agent = {
    resolveModel: async () => ({
      versionId: 'v',
      config: { name: 'Fake', modelId: 'f' },
      key: 'k',
    }),
    parseFile: async (_path, name) => ({ state: 'ready', regions: [{ text: '解析了 ' + name }] }),
    loop: {
      streamChat: async (_c, _k, { messages }) => {
        seen.push(JSON.stringify(messages));
        return done;
      },
      openSap: async () => ({ available: false, reason: '测试环境不连接 SAP' }),
      wait: async () => {},
    },
  };
  const f = await apiFixture({ abapFsdAgent: agent, abapDevAgent: agent });
  try {
    const root = `/api/projects/${f.scope.projectId}/development-items/${f.scope.itemId}`;
    const call = async (method, url, payload) => {
      const res = await f.app.inject({ method, url: root + url, payload, headers: f.headers });
      return { status: res.statusCode, body: res.body, json: () => res.json() };
    };
    await f.db.query('UPDATE app.development_item SET business_function=$2 WHERE id=$1', [
      f.scope.itemId,
      '<p>按工厂汇总缺料</p>',
    ]);
    const file = await call('POST', '/files', {
      name: '需求说明.docx',
      content: Buffer.from('需求').toString('base64'),
    });
    assert.equal(file.status, 201, file.body);
    const fileId = file.json().id;

    // An earlier conversation with an upload of its own.
    const first = (await call('POST', '/abap-fsd-agent/sessions', {})).json().id;
    const upload = await call('POST', `/abap-fsd-agent/sessions/${first}/attachments`, {
      fileName: '截图.png',
      contentBase64: Buffer.from('png').toString('base64'),
    });
    assert.equal(upload.status, 201, upload.body);

    const sid = (await call('POST', '/abap-fsd-agent/sessions', {})).json().id;
    const groups = (await call('GET', `/abap-fsd-agent/references?session=${sid}`)).json().groups;
    assert.deepEqual(
      groups.map((g) => [g.key, g.items.map((i) => i.label)]),
      [
        ['item', ['业务功能点']],
        ['files', ['需求说明.docx']],
        ['sessions', ['截图.png']],
      ],
    );
    const references = [
      { kind: 'business_function', id: 'item' },
      { kind: 'item_file', id: fileId },
      { kind: 'session_file', id: upload.json().id },
    ];
    const send = async (payload) => {
      const r = await call('POST', `/abap-fsd-agent/sessions/${sid}/messages`, payload);
      assert.equal(r.status, 202, r.body);
      await call('GET', `/abap-fsd-agent/sessions/${sid}/turns/${r.json().turnId}/events`);
    };
    await send({ content: '按这些资料写 FSD', references });
    await send({ content: '再看一遍', references });
    const attachments = (await call('GET', `/abap-fsd-agent/sessions/${sid}`)).json().attachments;
    assert.deepEqual(attachments.map((a) => [a.source, a.fileName]).sort(), [
      ['business_function', '业务功能点.txt'],
      ['item_file', '需求说明.docx'],
      ['session_file', '截图.png'],
    ]);
    assert.match(seen[0], /按工厂汇总缺料/);
    assert.match(seen[0], /解析了 需求说明\.docx/);

    const bad = (refs) =>
      call('POST', `/abap-fsd-agent/sessions/${sid}/messages`, {
        content: '引用',
        references: refs,
      });
    assert.equal((await bad([{ kind: 'item_file', id: randomUUID() }])).status, 404);
    assert.equal((await bad([{ kind: 'session_file', id: randomUUID() }])).status, 404);
    assert.equal((await bad([{ kind: 'unknown', id: 'x' }])).status, 400);

    // The development assistant reads item files itself; it does not take them as references.
    const dev = (await call('POST', '/abap-dev-agent/sessions', {})).json().id;
    const devGroups = (await call('GET', `/abap-dev-agent/references?session=${dev}`)).json()
      .groups;
    assert.deepEqual(
      devGroups.map((g) => g.key),
      ['item'],
    );
    const refused = await call('POST', `/abap-dev-agent/sessions/${dev}/messages`, {
      content: '引用',
      references: [{ kind: 'item_file', id: fileId }],
    });
    assert.equal(refused.status, 400);
  } finally {
    await f.close();
  }
});
