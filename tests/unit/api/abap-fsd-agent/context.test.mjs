import test from 'node:test';
import assert from 'node:assert/strict';
import {
  historyMessages,
  sessionFacts,
  loadSystemPrompt,
} from '../../../../apps/api/src/modules/abap-fsd-agent/context.mjs';

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

test('facts tell the model when SAP is unavailable and list open comments', () => {
  const facts = sessionFacts({
    scope: { itemCode: 'DEV-1', itemName: '点检', projectName: 'P' },
    sap: { available: false, reason: '未配置' },
    document: { version: 2, markdown: '## 1.1 开发概览\n正文' },
    comments: [{ id: 'c1', anchorText: '正文', anchorVersion: 2, body: '改一下', replies: [] }],
    attachments: [
      { fileName: '需求.md', text: '需求原文' },
      { fileName: 'a.png', text: '', warnings: ['仅预览'] },
    ],
    today: '2026-10-11',
  });
  assert.match(facts, /SAP 工具本轮不可用：未配置/);
  assert.match(facts, /第 2 版/);
  assert.match(facts, /\[c1\]/);
  assert.match(facts, /需求原文/);
  assert.match(facts, /仅预览/);
});

test('the system prompt ships with the module', async () => {
  assert.match(await loadSystemPrompt(), /ABAP FSD 设计助手/);
});
