import test from 'node:test';
import assert from 'node:assert/strict';
import { runAgentLoop } from '../../../../apps/api/src/modules/agent-core/loop.mjs';

// A scripted model: each call returns the next reply.
function scripted(replies) {
  let i = 0;
  return async () => {
    const r = replies[Math.min(i++, replies.length - 1)];
    if (r instanceof Error) throw r;
    return { content: '', toolCalls: [], usage: { prompt_tokens: 10, completion_tokens: 5 }, ...r };
  };
}
const call = (name, args = {}, id = name) => ({ id, name, arguments: JSON.stringify(args) });

function harness(overrides = {}) {
  const stored = [],
    toolLog = [],
    events = [];
  return {
    stored,
    toolLog,
    events,
    options: {
      model: { config: {}, key: '' },
      messages: [{ role: 'system', content: 'x' }],
      tools: [],
      handlers: {},
      emit: (type, data) => events.push({ type, data }),
      persist: {
        appendMessage: async (m) => stored.push(m),
        recordToolCall: async (c) => toolLog.push(c),
      },
      ...overrides,
    },
  };
}

test('the loop runs tools through agent handlers and stops when the model answers', async () => {
  const h = harness({ handlers: { echo: async (a) => 'got ' + a.v } });
  const result = await runAgentLoop({
    ...h.options,
    deps: { streamChat: scripted([{ toolCalls: [call('echo', { v: 1 })] }, { content: '完成' }]) },
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.stopReason, 'answered');
  assert.deepEqual(result.usage, { prompt_tokens: 20, completion_tokens: 10 });
  assert.equal(h.toolLog[0].status, 'ok');
  assert.equal(h.stored.find((m) => m.role === 'tool').content, 'got 1');
  assert.ok(h.events.some((e) => e.type === 'tool.end' && e.data.name === 'echo'));
});

test('the agent decides when a turn stops after tools, and how arguments are logged', async () => {
  let asked = false;
  const h = harness({
    handlers: {
      ask_user: async () => {
        asked = true;
        return '已出题';
      },
    },
    shouldStop: () => (asked ? 'asked' : null),
    logArguments: (name, a) => ({ ...a, questions: undefined }),
  });
  const questions = [{ q: 1 }];
  const result = await runAgentLoop({
    ...h.options,
    deps: { streamChat: scripted([{ toolCalls: [call('ask_user', { questions })] }]) },
  });
  assert.equal(result.stopReason, 'asked');
  assert.equal(h.toolLog[0].arguments.questions, undefined);
  assert.deepEqual(h.stored.find((m) => m.role === 'tool').payload.questions, questions);
});

test('repeated identical calls are denied and unknown tools are refused', async () => {
  const h = harness({ handlers: { echo: async () => 'ok' } });
  const same = call('echo', { v: 1 });
  await runAgentLoop({
    ...h.options,
    deps: {
      streamChat: scripted([{ toolCalls: [same, same, same, call('missing')] }, { content: '好' }]),
    },
  });
  assert.deepEqual(
    h.toolLog.map((c) => c.status),
    ['ok', 'ok', 'denied', 'denied'],
  );
});

test('step limits end the turn with a note; busy providers are retried', async () => {
  const h = harness({ handlers: { echo: async () => 'ok' } });
  const busy = Object.assign(new Error('busy'), { code: 'PROVIDER_BUSY' });
  let n = 0;
  const result = await runAgentLoop({
    ...h.options,
    limits: { steps: 2, toolCalls: 60 },
    deps: {
      wait: async () => {},
      streamChat: async (...args) =>
        n++ === 0
          ? Promise.reject(busy)
          : scripted([{ toolCalls: [call('echo', { n })] }])(...args),
    },
  });
  assert.equal(result.stopReason, 'step_limit');
  assert.match(h.stored.at(-1).content, /步骤上限/);
  assert.ok(h.events.some((e) => e.type === 'step' && e.data.retry === 1));
});

test('a failing model ends the turn as failed without throwing', async () => {
  const h = harness();
  const result = await runAgentLoop({
    ...h.options,
    deps: { streamChat: scripted([new Error('网络断开')]) },
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.error.message, '网络断开');
  assert.match(h.stored.at(-1).content, /本轮出错/);
});

test('a dropped connection is resent only when nothing was streamed', async () => {
  const drop = () => Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
  let n = 0;
  const quiet = harness();
  const ok = await runAgentLoop({
    ...quiet.options,
    deps: {
      wait: async () => {},
      streamChat: async (...args) =>
        n++ === 0 ? Promise.reject(drop()) : scripted([{ content: '好' }])(...args),
    },
  });
  assert.equal(ok.status, 'completed');
  const loud = harness();
  const failed = await runAgentLoop({
    ...loud.options,
    deps: {
      wait: async () => {},
      streamChat: async (_c, _k, { onDelta }) => {
        onDelta({ type: 'text', text: '半句' });
        throw drop();
      },
    },
  });
  assert.equal(failed.status, 'failed');
});

test('agent model calls wait five minutes for the first data by default', async () => {
  const seen = [];
  const h = harness({
    deps: {
      streamChat: async (_c, _k, options) => {
        seen.push(options.firstByteTimeoutMs);
        return { content: '好', toolCalls: [], usage: {} };
      },
    },
  });
  await runAgentLoop(h.options);
  assert.deepEqual(seen, [300000]);
});
