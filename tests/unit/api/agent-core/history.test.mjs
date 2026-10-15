import test from 'node:test';
import assert from 'node:assert/strict';
import { historyMessages } from '../../../../apps/api/src/modules/agent-core/history.mjs';

test('history keeps tool pairs valid and shortens old tool results', () => {
  const out = historyMessages([
    { role: 'user', content: '需求', payload: {} },
    {
      role: 'assistant',
      content: '',
      payload: {
        toolCalls: [
          { id: 'a', name: 'searchObject', arguments: '{}' },
          { id: 'b', name: 'ddicElement', arguments: '{}' },
        ],
      },
    },
    { role: 'tool', content: 'x'.repeat(5000), payload: { toolCallId: 'a' } },
    { role: 'assistant', content: '好的', payload: {} },
  ]);
  assert.deepEqual(
    out.map((m) => [m.role, m.tool_call_id ?? null]),
    [
      ['user', null],
      ['assistant', null],
      ['tool', 'a'],
      ['tool', 'b'],
      ['assistant', null],
    ],
  );
  assert.equal(out[1].content, null);
  assert.ok(out[2].content.length < 2000);
  assert.match(out[3].content, /中断/);
});
