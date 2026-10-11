import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDuration,
  formatTokens,
  gapLevel,
  pickFilters,
  statusTone,
  stopReasonLabel,
  toolLabel,
  withGrowth,
} from '../../../apps/web/src/features/audit/audit.mjs';

test('audit labels and formatting', () => {
  assert.equal(formatDuration(65000), '1分05秒');
  assert.equal(formatTokens(345749), '345.7k');
  assert.equal(statusTone('INTERRUPTED'), 'danger');
  assert.equal(statusTone('ASKED'), 'ok');
  assert.equal(stopReasonLabel('step_limit'), '达到步骤上限');
  assert.equal(toolLabel('runQuery'), '查询表内容或配置');
  assert.equal(gapLevel(45000), 'warn');
  assert.equal(gapLevel(130000), 'alert');
  assert.deepEqual(pickFilters({ status: 'FAILED', bogus: 'x', q: ' ' }), { status: 'FAILED' });
});

test('round growth flags jumps over 30%', () => {
  const rounds = withGrowth([
    { duration_ms: 100000, prompt_tokens: 1000, completion_tokens: 0 },
    { duration_ms: 110000, prompt_tokens: 2000, completion_tokens: 0 },
  ]);
  assert.equal(rounds[0].flagged, false);
  assert.equal(rounds[1].flagged, true);
  assert.equal(rounds[1].token_change, 1);
});
