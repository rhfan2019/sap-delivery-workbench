import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRecorder, readTrace } from '../lib/recorder.mjs';
import { cloneFields, batchPrefix, resolveAnswers } from '../lib/policy.mjs';
import { analyzeRun } from '../lib/analyzer.mjs';

test('basic copy excludes ownership, artifacts, attachments, decisions and history', () => {
  assert.deepEqual(
    cloneFields({
      name: 'N',
      module: 'MM',
      kind: 'report',
      summary: 'S',
      summaryFormat: 'plain',
      acceptance: 'A',
      businessOwnerId: 'old',
      notes: 'secret history',
      artifact: {},
      attachments: [],
    }),
    {
      name: 'N',
      module: 'MM',
      kind: 'report',
      summary: 'S',
      summaryFormat: 'plain',
      acceptance: 'A',
    },
  );
  assert.equal(batchPrefix(new Date('2026-10-06T01:02:03Z')), '261006-090203-');
});
test('answers are scoped, exact or explicit pattern; never pick first option', () => {
  const d = {
    id: 'd',
    questions: [
      { id: 'q1', title: '数量口径', allowText: true, options: [{ value: 'o1', label: '猜测' }] },
    ],
  };
  assert.equal(resolveAnswers(d, []).missing.length, 1);
  assert.deepEqual(
    resolveAnswers(d, [{ question: '数量口径', text: '未转订单的剩余数量' }]).answer,
    { decisionId: 'd', values: { q1: 'text:未转订单的剩余数量' } },
  );
});
test('recorder writes ordered durable timestamps and redacts credentials', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fsd-trace-'));
  try {
    const rec = createRecorder({ root, runId: '00000000-0000-4000-8000-000000000001' });
    rec.write('test', { apiKey: 'SECRET', headers: { authorization: 'SECRET' }, message: 'safe' });
    const rows = readTrace({ root, runId: rec.runId });
    assert.equal(rows[0].seq, 1);
    assert.ok(Date.parse(rows[0].at));
    assert.ok(!JSON.stringify(rows).includes('SECRET'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('analysis separates save/structure/quality and does not add nested call time twice', () => {
  const r = analyzeRun(
    {
      runId: 'r',
      state: 'failed',
      createdAt: '2026-01-01T00:00:00Z',
      snapshot: {
        finishedAt: '2026-01-01T00:00:10Z',
        plan: {
          steps: [
            {
              stepId: 'validate',
              status: 'failed',
              startedAt: '2026-01-01T00:00:01Z',
              finishedAt: '2026-01-01T00:00:10Z',
            },
          ],
        },
        validation: {
          valid: false,
          errors: [{ code: 'untrusted_confirmation', path: '/fields/0' }],
        },
        failure: { code: 'STRUCTURE_VALIDATION' },
      },
    },
    [],
  );
  assert.equal(r.elapsedMs, 10000);
  assert.equal(r.saved, false);
  assert.equal(r.structurePassed, false);
  assert.equal(r.businessQuality, 'not_evaluated');
  assert.equal(r.steps[0].durationMs, 9000);
  assert.equal(r.calls.length, 0);
});

test('later revision validation failure overrides a passed initial validation step', () => {
  const result = analyzeRun({
    state: 'failed',
    snapshot: {
      plan: { steps: [{ stepId: 'validate', status: 'succeeded' }] },
      validation: { valid: false, errors: [{ code: 'unregistered_source' }] },
    },
  });
  assert.equal(result.structurePassed, false);
});
