import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fields } from '../apps/api/src/delivery/validation.mjs';

test('requirement rich text preserves useful formatting and strips active content', () => {
  const result = fields({
    summaryFormat: 'html',
    summary:
      '<p>自然语言 <strong>重点</strong></p><ul><li>条件</li></ul><table><tbody><tr><th>字段</th><td>值</td></tr></tbody></table><script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">危险链接</a>',
  });
  assert.match(result.summary, /<strong>重点<\/strong>/);
  assert.match(result.summary, /<table>/);
  assert.match(result.summary, /<li>条件<\/li>/);
  assert.doesNotMatch(result.summary, /script|onerror|javascript:|<img|<a/);
});
test('legacy requirements remain literal text and format-only changes are rejected', () => {
  assert.equal(fields({ summary: '业务条件 A < B，保留原文' }).summary, '业务条件 A < B，保留原文');
  assert.throws(() => fields({ summaryFormat: 'html' }), /需求/);
  assert.throws(() => fields({ summaryFormat: 'other', summary: 'x' }));
  assert.throws(() => fields({ summaryFormat: 'html', summary: 'x'.repeat(100001) }));
});
