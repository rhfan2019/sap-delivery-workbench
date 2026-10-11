import test from 'node:test';
import assert from 'node:assert/strict';
import { apiFixture } from '../../fixtures/api.mjs';
import { publishProposal } from '../../../apps/api/src/modules/audit/export.mjs';

const reply = (content, toolCalls = []) => ({
  content,
  reasoning: '',
  toolCalls: toolCalls.map(([name, args], i) => ({
    id: `call_${i}`,
    name,
    arguments: JSON.stringify(args),
  })),
  finishReason: toolCalls.length ? 'tool_calls' : 'stop',
  usage: { prompt_tokens: 1000, completion_tokens: 50 },
});

async function setup() {
  const queue = [];
  const f = await apiFixture({
    abapFsdAgent: {
      resolveModel: async () => ({ versionId: 'v', config: { name: 'Fake-Model' }, key: 'k' }),
      loop: {
        streamChat: async () => queue.shift()(),
        openSap: async () => ({
          available: true,
          target: { systemCode: 'S4H', client: '100' },
          tools: [
            { type: 'function', function: { name: 'runQuery', parameters: { type: 'object' } } },
          ],
          call: async (name, args) =>
            args.sqlQuery.includes('JOIN')
              ? { status: 'error', content: 'SAP 查询失败：仅允许一个 SELECT 语句。' }
              : { status: 'ok', content: '{"rows":[]}' },
          close: async () => {},
        }),
      },
    },
  });
  const agent = `/api/projects/${f.scope.projectId}/development-items/${f.scope.itemId}/abap-fsd-agent`;
  const call = async (method, url, payload, headers = f.headers) => {
    const res = await f.app.inject({ method, url, payload, headers });
    return { status: res.statusCode, body: res.body, json: () => res.json() };
  };
  // Runs one assistant turn to its end through the real API.
  const turn = async (sid, content) => {
    const { turnId } = (
      await call('POST', `${agent}/sessions/${sid}/messages`, { content })
    ).json();
    await call('GET', `${agent}/sessions/${sid}/turns/${turnId}/events`);
    return turnId;
  };
  return { f, queue, agent, call, turn };
}

test('admins review assistant runs, comment on them and read proposals', async () => {
  const { f, queue, agent, call, turn } = await setup();
  try {
    assert.equal((await call('GET', '/api/audit/runs')).status, 403);
    await f.db.query(
      "UPDATE app.organization_member SET access_level='admin' WHERE organization_id=$1 AND user_id=$2",
      [f.scope.organizationId, f.scope.actorId],
    );
    const sid = (await call('POST', `${agent}/sessions`, {})).json().id;
    queue.push(
      () =>
        reply('', [
          ['runQuery', { sqlQuery: 'SELECT a FROM T1 JOIN T2' }],
          ['runQuery', { sqlQuery: 'SELECT AUART FROM TVAK' }],
        ]),
      () => reply('查到了。'),
    );
    const first = await turn(sid, '查一下订单类型');
    queue.push(() => {
      throw Object.assign(new Error('模型服务返回错误：quota'), { code: 'PROVIDER_ERROR' });
    });
    const second = await turn(sid, '继续');

    const list = (await call('GET', '/api/audit/runs')).json();
    assert.equal(list.total, 2);
    const [failed, done] = list.items;
    assert.equal(failed.id, second);
    assert.equal(failed.status, 'FAILED');
    assert.equal(failed.error_code, 'PROVIDER_ERROR');
    assert.equal(done.status, 'COMPLETED');
    assert.equal(done.tool_calls, 2);
    assert.equal(done.tool_failures, 1);
    assert.equal(done.model, 'Fake-Model');
    assert.equal(done.item.code, 'I');
    assert.equal(
      (await call('GET', '/api/audit/runs?status=FAILED'))
        .json()
        .items.map((r) => r.id)
        .join(),
      second,
    );
    assert.equal((await call('GET', '/api/audit/runs?q=nomatch')).json().total, 0);
    assert.deepEqual((await call('GET', '/api/audit/runs/facets')).json().models, ['Fake-Model']);

    const detail = (await call('GET', `/api/audit/runs/${first}`)).json();
    assert.deepEqual(
      detail.toolCalls.map((c) => c.status),
      ['error', 'ok'],
    );
    assert.match(detail.toolCalls[0].result, /仅允许一个 SELECT/);
    assert.ok(detail.toolCalls.every((c) => Number.isFinite(c.gap_ms)));
    assert.equal(detail.messages.find((m) => m.role === 'user').content, '查一下订单类型');

    const comments = await call('POST', `/api/audit/runs/${first}/comments`, {
      body: 'SQL 里用了 JOIN，提示词要强调单表查询',
    });
    assert.equal(comments.status, 201, comments.body);
    const commentId = comments.json()[0].id;
    assert.equal(comments.json()[0].mine, true);
    assert.equal(
      (await call('POST', `/api/audit/runs/${first}/comments`, { body: ' ' })).status,
      400,
    );
    assert.equal((await call('GET', '/api/audit/runs')).json().items[1].comments, 1);

    const stats = (await call('GET', '/api/audit/stats')).json();
    assert.equal(stats.totals.runs, 2);
    assert.equal(stats.totals.failed, 1);
    assert.equal(stats.failure_rate, 0.5);
    assert.equal(stats.tool_failure_rate, 0.5);
    assert.deepEqual(
      stats.tools.map((t) => [t.name, t.calls, t.failures]),
      [['runQuery', 2, 1]],
    );
    assert.ok(stats.stop_reasons.some((r) => r.reason === 'error' && r.title === '出错'));
    assert.equal(stats.daily.at(-1).total, 2);

    const trend = (await call('GET', `/api/audit/sessions/${sid}/trend`)).json();
    assert.deepEqual(
      trend.rounds.map((r) => r.id),
      [first, second],
    );

    const exported = await call('GET', '/api/audit/export?detail=1');
    assert.equal(exported.status, 200);
    assert.match(exported.body, /SQL 里用了 JOIN/);
    assert.match(exported.body, /失败调用 runQuery/);
    const json = JSON.parse((await call('GET', '/api/audit/export?format=json')).body);
    assert.equal(json.total_runs, 2);

    const eventsRes = await call('GET', '/api/audit/events');
    assert.equal(eventsRes.status, 200, eventsRes.body);
    const events = eventsRes.json();
    assert.ok(Array.isArray(events.items) && Array.isArray(events.actions));

    assert.deepEqual((await call('GET', '/api/audit/proposals')).json(), []);
    const proposalId = await publishProposal(f.db, f.scope.organizationId, {
      title: '第一期优化建议',
      markdown: '# 建议\n\n强调单表查询。',
      sources: { runs: 2, comments: 1 },
    });
    const proposals = (await call('GET', '/api/audit/proposals')).json();
    assert.equal(proposals[0].title, '第一期优化建议');
    assert.equal(proposals[0].author, 'Claude Code');
    assert.match((await call('GET', `/api/audit/proposals/${proposalId}`)).json().markdown, /单表/);

    assert.equal((await call('DELETE', `/api/audit/comments/${commentId}`, {})).status, 200);
    assert.equal((await call('DELETE', `/api/audit/comments/${commentId}`, {})).status, 404);
    assert.equal((await call('GET', `/api/audit/runs/${first}`)).json().comments.length, 0);
  } finally {
    await f.close();
  }
});
