import test from 'node:test';
import assert from 'node:assert/strict';
import { streamText } from '../../../apps/api/src/abap-fsd-agent/model-stream.mjs';
import { classifyFailure } from '../../../apps/api/src/abap-fsd-agent/errors.mjs';
import { modelDecision, answerDecision } from '../../../apps/api/src/abap-fsd-agent/decisions.mjs';
import { sessionHistory } from '../../../apps/api/src/abap-fsd-agent/session-state.mjs';
import { executor } from '../../../apps/api/src/abap-fsd-agent/executor.mjs';
import { planRun } from '../../../apps/api/src/abap-fsd-agent/coordinator.mjs';
import {
  renderTechnicalOutput,
  extractConfirmedAnswers,
} from '../../../apps/api/src/abap-fsd-agent/feedback.mjs';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
const config = {
  protocol: 'openai_chat',
  provider: 'QianWen',
  modelId: 'qwen3.8-max',
  maxOutputTokens: 8192,
};
const frame = (delta, reason = null) =>
  Buffer.from('data: ' + JSON.stringify({ choices: [{ delta, finish_reason: reason }] }) + '\n\n');
test('reasoning SSE overhead above 1 MB does not truncate a small valid JSON answer', async () => {
  let text = '';
  const result = await streamText(config, 'unused', 'synthetic', {
    onDelta: (d) => {
      text += d;
    },
    transport: async function* () {
      for (let i = 0; i < 1600; i++) yield frame({ reasoning_content: 'x'.repeat(800) });
      yield frame({ content: '{"title":"ok"}' }, 'stop');
      yield Buffer.from('data: [DONE]\n\n');
    },
  });
  assert.equal(JSON.parse(text).title, 'ok');
  assert.ok(result.diagnostics.receivedBytes > 1048576);
  assert.ok(result.diagnostics.firstByteAt);
});
test('bounded stream errors retain diagnostics and a distinct actionable classification', async () => {
  await assert.rejects(
    streamText(config, 'unused', '', {
      maxResponseBytes: 200,
      onDelta() {},
      transport: async function* () {
        yield frame({ reasoning_content: 'x'.repeat(300) });
      },
    }),
    (e) => {
      assert.equal(e.code, 'RESPONSE_LIMIT');
      assert.ok(e.diagnostics.receivedBytes > 200);
      assert.equal(classifyFailure(e, 'generate').code, 'RESPONSE_LIMIT');
      return true;
    },
  );
});
test('connection errors preserve only safe technical cause fields', async () => {
  await assert.rejects(
    streamText(config, 'secret', '', {
      onDelta() {},
      transport: async function* () {
        throw Object.assign(new Error('sensitive request'), { code: 'ECONNRESET' });
      },
    }),
    (e) => {
      assert.equal(e.diagnostics.causeCode, 'ECONNRESET');
      assert.ok(!JSON.stringify(e.diagnostics).includes('sensitive'));
      return true;
    },
  );
});
const clarification = JSON.stringify({
  kind: 'clarification',
  questions: [
    {
      title: '币种口径',
      options: [
        { label: '本位币', description: '便于汇总', recommended: true },
        { label: '凭证币', description: '逐币种展示' },
      ],
    },
  ],
});
test('recommended choice is retained with question/version provenance', () => {
  const d = modelDecision(clarification);
  assert.equal(d.questions[0].options[0].recommended, true);
  const [a] = answerDecision(d, { decisionId: d.id, values: { q1: 'o1' } });
  assert.equal(a.decisionId, d.id);
  assert.equal(a.questionId, 'q1');
  assert.equal(a.status, 'consultant_confirmed');
  const facts = extractConfirmedAnswers(
    [{ id: 'a', role: 'assistant', status: 'completed', decision: d }],
    '全部采用建议。生成FSD。',
  );
  assert.equal(facts[0].label, '本位币');
  assert.equal(facts[0].sourceMessageId, 'a');
});
test('legacy explicit numbered recommendations are confirmed narrowly by blanket acceptance', () => {
  const history = [
    {
      id: 'legacy',
      role: 'assistant',
      status: 'completed',
      content:
        '### 问题 1：收货口径？\n建议：净收货，扣减冲销。\n理由：准确。\n### 问题 2：单位合计？\n建议：按单位分组。\n## 其他设计\n建议：额外缩小业务范围。',
    },
  ];
  const answers = extractConfirmedAnswers(history, '全部采用建议。生成FSD。');
  assert.equal(answers.length, 2);
  assert.equal(answers[0].label, '净收货，扣减冲销。');
  assert.equal(answers[1].label, '按单位分组。');
  assert.ok(!JSON.stringify(answers).includes('缩小业务范围'));
  assert.deepEqual(
    extractConfirmedAnswers(history, '全部采用建议，但问题2不要采用，改为按收货日期'),
    [],
  );
});
test('history shows persisted author and freezes duration at final server step', () => {
  const h = sessionHistory([
    {
      id: 'r',
      state: 'failed',
      created_at: '2026-10-05T14:00:00Z',
      snapshot: {
        author: { id: 'u', name: '测试顾问' },
        plan: { steps: [{ finishedAt: '2026-10-05T14:01:00Z' }] },
      },
    },
  ]);
  assert.equal(h[0].authorName, '测试顾问');
  assert.equal(h[1].finishedAt, '2026-10-05T14:01:00Z');
});
test('JSON conversion executor never invokes a model, SAP or artifact save', async () => {
  const rendered = renderTechnicalOutput('{"title":"采购报表","rules":["本位币汇总"]}');
  const run = executor({
    plan: planRun(),
    action: 'dialogue',
    context: { rendered },
    persist: async () => {},
    save: () => assert.fail('save called'),
    verify: () => assert.fail('SAP called'),
  });
  const out = await run({
    run: { id: 'r' },
    signal: new AbortController().signal,
    emit() {},
    invoke: () => assert.fail('model called'),
  });
  assert.equal(out.rendered, true);
  assert.equal(
    renderTechnicalOutput('{"title":"采购报表","rules":["本位币汇总"]}').markdown,
    rendered.markdown,
  );
});
test('standalone conversion CLI renders a valid FSD with all network entry points blocked', async () => {
  const folder = 'artifacts/fs-workspace';
  await mkdir(folder, { recursive: true });
  const dest = `${folder}/round2-conversion-${randomUUID()}.md`;
  const input = 'packages/contracts/abap-fsd-agent/fsd/v1/r.example.json';
  const guard = `import net from 'node:net'; import https from 'node:https'; import http from 'node:http'; import {syncBuiltinESMExports} from 'node:module'; const blocked=()=>{throw new Error('NETWORK_FORBIDDEN')}; net.Socket.prototype.connect=blocked; https.request=blocked; https.get=blocked; http.request=blocked; http.get=blocked; globalThis.fetch=blocked; syncBuiltinESMExports();`;
  const start = performance.now();
  const stdout = execFileSync(
    process.execPath,
    [
      '--import',
      'data:text/javascript,' + encodeURIComponent(guard),
      'scripts/render-assistant-artifact.mjs',
      input,
      dest,
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  const cliMs = performance.now() - start;
  try {
    const expected = renderTechnicalOutput(await readFile(input, 'utf8'));
    assert.equal(JSON.parse(stdout).contractValid, true);
    assert.equal(await readFile(dest, 'utf8'), expected.markdown);
    const before = performance.now();
    for (let n = 0; n < 100; n++) renderTechnicalOutput(await readFile(input, 'utf8'));
    await writeFile(
      `${folder}/round2-conversion-evidence.json`,
      JSON.stringify(
        {
          networkBlocked: true,
          modelCalls: 0,
          contractValid: true,
          cliMilliseconds: cliMs,
          averageRenderAndReadMs: (performance.now() - before) / 100,
          sourceHash: expected.sourceHash,
        },
        null,
        2,
      ),
    );
  } finally {
    await unlink(dest);
  }
});
test('normal dialogue clarification becomes actionable waiting state instead of folded JSON', async () => {
  const snapshots = [];
  const run = executor({
    plan: planRun(),
    action: 'dialogue',
    context: { manifest: { consultantDecisions: [] } },
    persist: async (_id, s, state) => snapshots.push({ s, state }),
  });
  const result = await run({
    run: { id: 'r' },
    signal: new AbortController().signal,
    emit() {},
    invoke: async ({ onDelta }) => {
      onDelta(clarification);
      return {};
    },
  });
  assert.equal(result.waitingUser, true);
  assert.equal(result.decision.questions[0].options[0].recommended, true);
  assert.equal(snapshots.at(-1).state, 'waiting_user');
});
