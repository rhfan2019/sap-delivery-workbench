import test from 'node:test';
import assert from 'node:assert/strict';
import { apiFixture } from '../../fixtures/api.mjs';
import { REQUIRED_SECTIONS } from '../../../apps/api/src/modules/abap-fsd-agent/tools/check.mjs';

const skeleton = REQUIRED_SECTIONS.map(([n, t]) => `## ${n} ${t}\n${t}的内容`).join('\n\n');
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
const question = {
  question: '逾期按哪个日期判断？',
  background: '影响逾期标识',
  options: [
    { label: '计划发货日', impact: 'A' },
    { label: '交货日期', impact: 'B' },
  ],
  recommended: '计划发货日',
  reason: '与考核一致',
  why_customer: '客户口径，系统查不到',
};

// A scripted model: each step pops the next response builder, which sees the messages sent.
function scriptedModel() {
  const queue = [];
  const seen = [];
  return {
    queue,
    seen,
    async streamChat(_config, _key, { messages, onDelta, signal }) {
      seen.push(messages);
      const next = queue.shift();
      if (!next) throw new Error('script exhausted');
      const result = await next(messages, signal);
      if (result.content) onDelta?.({ type: 'text', text: result.content });
      return result;
    },
  };
}

async function setup() {
  const model = scriptedModel();
  const f = await apiFixture({
    abapFsdAgent: {
      resolveModel: async () => ({
        versionId: 'v',
        config: { name: 'Fake', modelId: 'fake' },
        key: 'k',
      }),
      loop: {
        streamChat: model.streamChat,
        openSap: async () => ({ available: false, reason: '测试环境不连接 SAP' }),
      },
    },
  });
  const base = `/api/projects/${f.scope.projectId}/development-items/${f.scope.itemId}/abap-fsd-agent`;
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

test('a session goes from questions to a draft to a comment-driven revision', async () => {
  const { f, model, call, send } = await setup();
  try {
    const created = await call('POST', '/sessions', { title: '' });
    assert.equal(created.status, 201, created.body);
    const sid = created.json().id;

    model.queue.push(async () => reply('先确认口径。', [['ask_user', { questions: [question] }]]));
    const asked = await send(sid, { content: '设计一个交货逾期清单' });
    assert.equal(asked.end.stopReason, 'asked');
    assert.match(asked.events, /event: tool.end/);
    let detail = (await call('GET', `/sessions/${sid}`)).json();
    assert.equal(detail.session.title, '设计一个交货逾期清单');
    assert.deepEqual(
      detail.messages.map((m) => m.role),
      ['user', 'assistant', 'tool'],
    );
    assert.equal(detail.messages[2].payload.questions[0].question, question.question);
    assert.match(model.seen[0][1].content, /SAP 工具本轮不可用/);

    model.queue.push(
      async (messages) => {
        assert.match(messages.at(-1).content, /答复：计划发货日/);
        return reply('', [
          [
            'write_document',
            { mode: 'replace', content: skeleton, changes: [{ section: '全文', summary: '初稿' }] },
          ],
        ]);
      },
      async (messages) => {
        assert.match(messages.at(-1).content, /自动校验通过/);
        return reply('初稿已完成。');
      },
    );
    const drafted = await send(sid, {
      answers: [{ question: question.question, choice: '计划发货日' }],
    });
    assert.equal(drafted.end.version, 1);
    assert.match(drafted.events, /event: document.saved/);

    const comment = await call('POST', `/sessions/${sid}/comments`, {
      anchorText: '权限校验的内容',
      anchorVersion: 1,
      body: '写清无权限时的处理',
    });
    assert.equal(comment.status, 201, comment.body);
    const commentId = comment.json().id;

    model.queue.push(
      async (messages) => {
        assert.ok(messages[1].content.includes(`[${commentId}]`));
        return reply('', [
          [
            'edit_document',
            {
              old_text: '权限校验的内容',
              new_text: '无权限的工厂排除并提示。',
              reason: '按批注补充',
              comment_id: commentId,
            },
          ],
          ['reply_comment', { comment_id: commentId, reply: '已补充无权限时的处理。' }],
        ]);
      },
      async () => reply('已按批注修改。'),
    );
    const revised = await send(sid, { content: '请处理批注' });
    assert.equal(revised.end.version, 2);
    detail = (await call('GET', `/sessions/${sid}`)).json();
    assert.match(detail.document.markdown, /无权限的工厂排除并提示/);
    assert.equal(detail.document.changes[0].commentId, commentId);
    assert.deepEqual(detail.document.comparison.undeclared, []);
    assert.deepEqual(
      detail.document.comparison.actual.map((c) => c.heading),
      ['2.1 权限校验'],
    );
    assert.equal(detail.comments[0].replies[0].body, '已补充无权限时的处理。');
    assert.deepEqual(
      detail.toolCalls.map((t) => [t.name, t.status]),
      [
        ['ask_user', 'ok'],
        ['write_document', 'ok'],
        ['edit_document', 'ok'],
        ['reply_comment', 'ok'],
      ],
    );

    assert.equal(
      (await call('PATCH', `/sessions/${sid}/comments/${commentId}`, { status: 'resolved' }))
        .status,
      200,
    );
    assert.equal(
      (await call('POST', `/sessions/${sid}/documents/2/labels`, { labels: ['定稿'] })).status,
      200,
    );
    const versions = (await call('GET', `/sessions/${sid}/documents`)).json();
    assert.deepEqual(
      versions.map((v) => [v.version, v.labels]),
      [
        [2, ['定稿']],
        [1, []],
      ],
    );
    const exported = await call('GET', `/sessions/${sid}/export?version=1`);
    assert.equal(exported.status, 200);
    assert.match(exported.body, /权限校验的内容/);
  } finally {
    await f.close();
  }
});

test('a rewrite that touches undeclared sections is flagged', async () => {
  const { f, model, call, send } = await setup();
  try {
    const sid = (await call('POST', '/sessions', {})).json().id;
    model.queue.push(
      async () =>
        reply('', [
          [
            'write_document',
            { mode: 'replace', content: skeleton, changes: [{ section: '全文', summary: '初稿' }] },
          ],
        ]),
      async () => reply('好了'),
      async () =>
        reply('', [
          [
            'write_document',
            {
              mode: 'replace',
              content: skeleton
                .replace('开发概览的内容', '改过的概览')
                .replace('反向审查的内容', '顺手改了'),
              changes: [{ section: '1.1 开发概览', summary: '调整概览' }],
            },
          ],
        ]),
      async () => reply('改好了'),
    );
    await send(sid, { content: '出稿' });
    const second = await send(sid, { content: '改概览' });
    assert.equal(second.end.version, 2);
    const doc = (await call('GET', `/sessions/${sid}/documents/2`)).json();
    assert.deepEqual(doc.comparison.undeclared, ['附录 C 反向审查']);
  } finally {
    await f.close();
  }
});

test('one turn at a time; a running turn can be cancelled; strangers are rejected', async () => {
  const { f, model, call } = await setup();
  try {
    const sid = (await call('POST', '/sessions', {})).json().id;
    model.queue.push(
      (_messages, signal) =>
        new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))),
    );
    const first = await call('POST', `/sessions/${sid}/messages`, { content: '开始' });
    assert.equal(first.status, 202);
    const busy = await call('POST', `/sessions/${sid}/messages`, { content: '再来' });
    assert.equal(busy.status, 409);
    assert.equal((await call('POST', `/sessions/${sid}/cancel`, {})).json().cancelled, true);
    const events = await call('GET', `/sessions/${sid}/turns/${first.json().turnId}/events`);
    assert.match(events.body, /"status":"cancelled"/);
    const detail = (await call('GET', `/sessions/${sid}`)).json();
    assert.equal(detail.session.activeTurnId, null);
    assert.equal(detail.turns[0].status, 'cancelled');

    const anonymous = await call('GET', '/sessions', undefined, { origin: f.headers.origin });
    assert.equal(anonymous.status, 401);
    const missing = await call('GET', '/sessions/00000000-0000-4000-8000-000000000000');
    assert.equal(missing.status, 404);
  } finally {
    await f.close();
  }
});
