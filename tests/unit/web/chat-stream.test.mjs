import test from 'node:test';
import assert from 'node:assert/strict';
import { reconnectingChatStream } from '../../../apps/web/src/features/abap-fsd-agent/chatStream.mjs';

test('network reconnect resumes after complete frames without duplicating a truncated delta', async () => {
  const urls = [];
  const frame = (seq, type, data) => `data: ${JSON.stringify({ runId: 'r', seq, type, data })}\n\n`;
  const response = await reconnectingChatStream('/runs/r/events', {
    retryDelay: 0,
    fetcher: async (url) => {
      urls.push(url);
      return new Response(
        urls.length === 1
          ? frame(1, 'message.delta', { text: '一' }) + 'data: {"run'
          : frame(2, 'message.delta', { text: '二' }) + frame(3, 'run.completed', {}),
        { headers: { 'Content-Type': 'text/event-stream' } },
      );
    },
  });
  const text = await response.text();
  assert.deepEqual(urls, ['/runs/r/events?after=0', '/runs/r/events?after=1']);
  assert.equal((text.match(/message.delta/g) ?? []).length, 2);
  assert.ok(text.includes('run.completed'));
});

test('authorization failure never reconnects or sends a new run request', async () => {
  let calls = 0;
  const response = await reconnectingChatStream('/events', {
    fetcher: async () => {
      calls++;
      return new Response('{}', { status: 403 });
    },
  });
  assert.equal(response.status, 403);
  assert.equal(calls, 1);
});
