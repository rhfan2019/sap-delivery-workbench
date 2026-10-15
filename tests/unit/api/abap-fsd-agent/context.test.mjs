import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sessionFacts,
  loadSystemPrompt,
} from '../../../../apps/api/src/modules/abap-fsd-agent/context.mjs';

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
