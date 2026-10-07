import test from 'node:test';
import assert from 'node:assert/strict';
let mod;
try {
  mod = await import('../../../apps/api/src/gem-fsd-v2.mjs');
} catch (e) {
  if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e;
}
export const document =
  Array.from(
    { length: 9 },
    (_, i) =>
      `## 第${i + 1}章：${['业务需求概览与假设', '全生命周期、变体与极端状态', '业务对象与数据来源', '标准功能对标与差异化', '报表方案设计', '多步骤自动化设计', '测试基准', '业务自查', 'DDIC依赖与待核实事项'][i]}\n\n${i === 5 ? '本章不适用。原因：本需求只读，不包含自动业务动作。' : '本章描述当前业务范围、有效条件及可核对的预期结果。'}`,
  ).join('\n\n') + '\n\n<!-- FSD_V2_END -->';
test('v2 validates complete documents, rejects truncation and accepts bounded clarification', () => {
  assert.ok(mod, 'v2 module is required');
  assert.equal(mod.parseV2(document).kind, 'document');
  assert.equal(mod.parseV2(document.replace(/第([1-9])章：/g, '$1. ')).kind, 'document');
  assert.throws(() => mod.parseV2(document.replace('<!-- FSD_V2_END -->', '')), /完整/);
  assert.throws(() => mod.parseV2(document.replace('## 第5章', '## 第6章')), /章节/);
  assert.equal(
    mod.parseV2(
      JSON.stringify({
        kind: 'clarification',
        questions: [{ id: 'q1', question: '按订单还是计划行？', impact: '决定结果颗粒度' }],
      }),
    ).kind,
    'clarification',
  );
});
test('v2 input is isolated, excludes legacy history and has no MCP or giant schema', () => {
  assert.ok(mod, 'v2 module is required');
  const c = mod.buildV2Context({
    item: { code: 'DEV-0007', name: '报表', summary: '需求' },
    prompt: '生成',
    answers: '按计划行',
    history: [{ content: 'FOREIGN' }],
    spec: { foreign: 'FOREIGN' },
  });
  assert.equal(c.messages.length, 2);
  assert.ok(!JSON.stringify(c).includes('FOREIGN'));
  assert.ok(!c.messages[0].content.includes('"$defs"'));
  assert.equal(c.manifest.task, 'gem-fsd-v2');
});
test('one model call creates a document, preserves telemetry and never plans/rewrites', async () => {
  assert.ok(mod, 'v2 module is required');
  let calls = 0;
  const events = [];
  const r = await mod.executeV2({
    model: { modelId: 'default' },
    key: 'SECRET',
    context: mod.buildV2Context({ item: { summary: 'x' } }),
    generate: async (_m, _k, _p, o) => {
      calls++;
      await o.onDelta(document);
      return { usage: { completion_tokens: 20 } };
    },
    record: (type, data) => events.push({ type, data }),
    signal: new AbortController().signal,
  });
  assert.equal(calls, 1);
  assert.equal(r.kind, 'document');
  assert.equal(r.contentHash.length, 64);
  assert.ok(events.some((e) => e.type === 'model.completed'));
  assert.ok(!JSON.stringify(events).includes('SECRET'));
});
test('hard deadline aborts provider and no result is published or retried', async () => {
  assert.ok(mod, 'v2 module is required');
  let calls = 0,
    providerSignal;
  await assert.rejects(
    mod.executeV2({
      model: {},
      key: '',
      context: mod.buildV2Context({ item: {} }),
      timeoutMs: 25,
      signal: new AbortController().signal,
      record() {},
      generate: async (_m, _k, _p, o) => {
        calls++;
        providerSignal = o.signal;
        return new Promise(() => {});
      },
    }),
    (e) => e.code === 'V2_TIMEOUT',
  );
  assert.equal(calls, 1);
  assert.equal(providerSignal.aborted, true);
});
