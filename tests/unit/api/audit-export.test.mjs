import test from 'node:test';
import assert from 'node:assert/strict';
import { analysisMarkdown } from '../../../apps/api/src/modules/audit/export.mjs';

test('analysis material lists runs, comments and failed calls', () => {
  const md = analysisMarkdown({
    generated_at: '2026-10-12T00:00:00Z',
    filters: { from: '2026-10-11T00:00:00Z' },
    total_runs: 1,
    included_runs: 1,
    stats: {
      totals: {
        completed: 1,
        asked: 0,
        failed: 0,
        cancelled: 0,
        interrupted: 0,
        avg_duration_ms: 60000,
        prompt_tokens: 10,
        completion_tokens: 2,
        tool_calls: 1,
        tool_failures: 1,
      },
      tools: [{ name: 'runQuery', calls: 1, failures: 1, avg_ms: 200 }],
    },
    runs: [
      {
        id: 't1',
        session_id: 's1',
        started_at: '2026-10-11T01:00:00Z',
        item: { code: 'DEV-1', name: '清单' },
        user_name: '陈顾问',
        model: 'DS',
        status_label: '已完成',
        stop_reason_title: '正常结束',
        duration_ms: 60000,
        model_calls: 2,
        tool_calls: 1,
        tool_failures: 1,
        prompt_tokens: 10,
        completion_tokens: 2,
        prompt: '查一下',
        comments: [{ author: '陈顾问', body: 'JOIN 写错' }],
        calls: [
          {
            name: 'runQuery',
            status: 'error',
            arguments: { sqlQuery: 'SELECT …' },
            result: '仅允许一个 SELECT',
          },
        ],
      },
    ],
  });
  assert.match(md, /查询表内容或配置（runQuery） \| 1 \| 1/);
  assert.match(md, /\*\*评论\*\*（陈顾问）：JOIN 写错/);
  assert.match(md, /用户输入：查一下/);
  assert.match(md, /工具 1（失败 1）/);
  assert.match(md, /失败调用 runQuery.*仅允许一个 SELECT/);
});
