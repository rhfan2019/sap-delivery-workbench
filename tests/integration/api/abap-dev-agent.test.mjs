import test from 'node:test';
import assert from 'node:assert/strict';
import { apiFixture } from '../../fixtures/api.mjs';

const reply = (content, toolCalls = []) => ({
  content,
  reasoning: '',
  toolCalls: toolCalls.map(([name, args], i) => ({
    id: `call_${name}_${i}`,
    name,
    arguments: JSON.stringify(args),
  })),
  finishReason: toolCalls.length ? 'tool_calls' : 'stop',
  usage: { prompt_tokens: 100, completion_tokens: 10 },
});
const plan =
  '## 1 业务口径\n采购订单清单\n\n## 3.2 文本元素\n\n| 编号 | 文本 |\n| --- | --- |\n| m01 | 无数据 |\n';
const code = [
  'REPORT zmm_po_list.',
  'START-OF-SELECTION.',
  "  MESSAGE '无数据'(m01) TYPE 'S'.",
  '',
].join('\n');

function scriptedModel() {
  const queue = [];
  const seen = [];
  return {
    queue,
    seen,
    async streamChat(_config, _key, { messages, onDelta }) {
      seen.push(messages);
      const next = queue.shift();
      if (!next) throw new Error('script exhausted');
      const result = await next(messages);
      if (result.content) onDelta?.({ type: 'text', text: result.content });
      return result;
    },
  };
}

async function setup() {
  const model = scriptedModel();
  const f = await apiFixture({
    abapDevAgent: {
      resolveModel: async () => ({
        versionId: 'v',
        config: { name: 'Fake', modelId: 'fake' },
        key: 'k',
      }),
      // The uploaded code drops the commented line and adds one of its own.
      parseFile: async () => ({
        state: 'parsed',
        regions: [{ text: 'REPORT zmm_po_list.\nSTART-OF-SELECTION.\n  WRITE 2.\n' }],
      }),
      loop: {
        streamChat: model.streamChat,
        openSap: async () => ({ available: false, reason: '测试环境不连接 SAP' }),
        wait: async () => {},
      },
    },
  });
  const base = `/api/projects/${f.scope.projectId}/development-items/${f.scope.itemId}/abap-dev-agent`;
  const call = async (method, url, payload, headers = f.headers) => {
    const res = await f.app.inject({ method, url: base + url, payload, headers });
    return { status: res.statusCode, body: res.body, json: () => res.json() };
  };
  const send = async (sessionId, payload) => {
    const res = await call('POST', `/sessions/${sessionId}/messages`, payload);
    assert.equal(res.status, 202, res.body);
    const { turnId } = res.json();
    const events = await call('GET', `/sessions/${sessionId}/turns/${turnId}/events`);
    const end = events.body.split('\n\n').find((frame) => frame.includes('event: turn.end'));
    return { turnId, events: events.body, end: JSON.parse(end.split('data: ')[1]).data };
  };
  return { f, model, call, send };
}

test('a development session writes a plan and code, revises by comment and takes code back', async () => {
  const { f, model, call, send } = await setup();
  try {
    const listed = (await call('GET', '/sessions')).json();
    assert.equal(listed.item.kind, 'report');
    assert.equal(listed.supported, true);
    const sid = (await call('POST', '/sessions', {})).json().id;

    // First turn: the framework interface and the report rules reach the model.
    model.queue.push(
      async (messages) => {
        assert.match(messages[0].content, /开发类型规范：可执行程序/);
        assert.match(messages[1].content, /# 框架接口[\s\S]*YCL_FRH_REPORT：来自内置副本/);
        assert.match(messages[2].content, /SAP 工具本轮不可用/);
        return reply('', [
          [
            'write_artifact',
            {
              target: 'plan',
              mode: 'replace',
              content: plan,
              changes: [{ section: '全文', summary: '初稿' }],
            },
          ],
          [
            'write_artifact',
            {
              target: 'code',
              mode: 'replace',
              content: code,
              changes: [{ section: '全部', summary: '初稿' }],
            },
          ],
        ]);
      },
      async (messages) => {
        assert.match(messages.at(-1).content, /自动校验：未发现问题/);
        return reply('方案与代码已写好。');
      },
    );
    const first = await send(sid, { content: '做一个采购订单清单' });
    assert.equal(first.end.version, 1);
    assert.match(first.events, /event: artifact.draft/);
    assert.match(first.events, /event: version.saved/);
    let detail = (await call('GET', `/sessions/${sid}`)).json();
    assert.equal(detail.version.source, 'assistant');
    assert.equal(detail.version.code, code);
    assert.ok(detail.version.basis.some((b) => b.key === 'framework:YCL_FRH_REPORT'));
    assert.ok(detail.version.basis.some((b) => b.key === 'item'));

    // A comment on a code line; the model edits it and replies.
    const comment = await call('POST', `/sessions/${sid}/comments`, {
      target: 'code',
      anchorText: "MESSAGE '无数据'(m01) TYPE 'S'.",
      anchorVersion: 1,
      anchorLine: 3,
      body: '没有数据时回到选择屏幕',
    });
    assert.equal(comment.status, 201, comment.body);
    const commentId = comment.json().id;
    assert.equal(
      (
        await call('POST', `/sessions/${sid}/comments`, {
          target: 'code',
          anchorText: '不在代码里',
          anchorVersion: 1,
          body: 'x',
        })
      ).status,
      400,
    );
    model.queue.push(
      async (messages) => {
        assert.ok(messages[2].content.includes(`[${commentId}] 代码第 3 行附近`));
        return reply('', [
          [
            'edit_artifact',
            {
              target: 'code',
              old_text: "  MESSAGE '无数据'(m01) TYPE 'S'.",
              new_text: "  MESSAGE '无数据'(m01) TYPE 'S'.\n  LEAVE LIST-PROCESSING.",
              reason: '按批注回到选择屏幕',
              comment_id: commentId,
            },
          ],
          ['reply_comment', { comment_id: commentId, reply: '已加 LEAVE LIST-PROCESSING。' }],
        ]);
      },
      async () => reply('已按批注修改。'),
    );
    const revised = await send(sid, { content: '请处理批注' });
    assert.equal(revised.end.version, 2);
    detail = (await call('GET', `/sessions/${sid}`)).json();
    assert.match(detail.version.code, /LEAVE LIST-PROCESSING/);
    assert.equal(detail.version.changes[0].commentId, commentId);
    assert.equal(detail.version.comparison.code.undeclared, false);
    assert.equal(detail.comments[0].replies[0].body, '已加 LEAVE LIST-PROCESSING。');
    const diff = (await call('GET', `/sessions/${sid}/diff?target=code&from=1&to=2`)).json();
    assert.equal(diff.added, 1);

    // The consultant uploads changed code; the model imports it after confirmation.
    const upload = await call('POST', `/sessions/${sid}/attachments`, {
      fileName: 'zmm_po_list.abap',
      contentBase64: Buffer.from('x').toString('base64'),
    });
    assert.equal(upload.status, 201, upload.body);
    const attachmentId = upload.json().id;
    model.queue.push(
      async () =>
        reply('', [
          ['import_code', { attachment_id: attachmentId, reason: '用户说这是改过的代码' }],
        ]),
      async (messages) => {
        assert.match(messages.at(-1).content, /已保存为第 3 版[\s\S]*\+\s+WRITE 2\./);
        return reply('已保存你修改后的代码。');
      },
    );
    const imported = await send(sid, { content: '这是我在 SAP 里改过的代码' });
    assert.equal(imported.end.version, 3);
    detail = (await call('GET', `/sessions/${sid}`)).json();
    assert.equal(detail.version.source, 'upload');
    assert.equal(detail.version.sourceRef, 'zmm_po_list.abap');
    // The commented line is gone from the uploaded code: the open comment turns stale.
    assert.equal(detail.comments[0].status, 'stale');
    assert.deepEqual(
      detail.versions.map((v) => [v.version, v.source]),
      [
        [3, 'upload'],
        [2, 'assistant'],
        [1, 'assistant'],
      ],
    );

    assert.equal(
      (await call('POST', `/sessions/${sid}/versions/2/labels`, { labels: ['定稿'] })).status,
      200,
    );
    const exported = await call('GET', `/sessions/${sid}/export?target=code&version=2`);
    assert.equal(exported.status, 200);
    assert.match(exported.body, /LEAVE LIST-PROCESSING/);
    assert.match((await call('GET', `/sessions/${sid}/export?target=plan`)).body, /采购订单清单/);
  } finally {
    await f.close();
  }
});

test('questions end the turn and sync without a registered program is refused', async () => {
  const { f, model, call, send } = await setup();
  try {
    const sid = (await call('POST', '/sessions', {})).json().id;
    model.queue.push(
      async () => reply('', [['sync_from_sap', {}]]),
      async (messages) => {
        assert.match(messages.at(-1).content, /尚未登记程序对象/);
        return reply('', [
          [
            'ask_user',
            {
              questions: [
                {
                  question: '用 BAPI 还是直接更新？',
                  background: '影响锁与回滚',
                  options: [
                    { label: 'BAPI', impact: '标准校验' },
                    { label: '直接更新', impact: '快但无校验' },
                  ],
                  recommended: 'BAPI',
                  reason: '安全',
                  why_customer: '涉及数据一致性取舍',
                },
              ],
            },
          ],
        ]);
      },
    );
    const asked = await send(sid, { content: '把程序从 SAP 同步回来' });
    assert.equal(asked.end.stopReason, 'asked');
    assert.equal(asked.end.version, null);
    const detail = (await call('GET', `/sessions/${sid}`)).json();
    assert.deepEqual(
      detail.toolCalls.map((t) => [t.name, t.status]),
      [
        ['sync_from_sap', 'error'],
        ['ask_user', 'ok'],
      ],
    );
  } finally {
    await f.close();
  }
});
