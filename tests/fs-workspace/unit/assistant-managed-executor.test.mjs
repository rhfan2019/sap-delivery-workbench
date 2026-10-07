import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { executor } from '../../../apps/api/src/abap-fsd-agent/executor.mjs';
import { planRun } from '../../../apps/api/src/abap-fsd-agent/coordinator.mjs';
import { buildContext } from '../../../apps/api/src/abap-fsd-agent/context.mjs';

async function runManaged(critical = false) {
  const spec = JSON.parse(
    readFileSync(
      new URL('../../../packages/contracts/abap-fsd-agent/fsd/v1/r.example.json', import.meta.url),
    ),
  );
  const context = buildContext({
    currentMessage: '基于已确认初稿生成正式版',
    task: 'draft',
    riceType: 'R',
    budget: 180000,
    activeSpecification: spec,
    existingSources: spec.sources,
  });
  context.manifest.workflow = {
    phase: 'refining',
    version: '3',
    draftApproval: { revisionId: 'draft' },
  };
  const calls = [],
    snapshots = [];
  let saved, error;
  const work = executor({
    action: 'draft',
    plan: planRun({ request: '报表', action: 'draft' }),
    context,
    profile: { systemId: null, identificationSource: 'unknown', profile: {}, evidence: [] },
    verify: { systemId: null },
    persist: async (_id, s) => snapshots.push(structuredClone(s)),
    save: async ({ spec }) => {
      saved = spec;
      return { id: 'artifact', revision: 2 };
    },
  });
  try {
    await work({
      run: { id: 'managed' },
      signal: new AbortController().signal,
      emit() {},
      invoke: async (options) => {
        const task = options.context?.manifest.task ?? context.manifest.task;
        calls.push(task);
        const output =
          task === 'plan'
            ? {
                tasks: [
                  {
                    id: 'T1',
                    goal: '核对业务结果',
                    dependsOn: [],
                    doneWhen: '样例与结果一致',
                    entityIds: [],
                    needsEvidence: true,
                  },
                ],
                scenario: { editable: false, objectFeedback: false },
              }
            : task === 'review'
              ? {
                  findings: critical
                    ? [
                        {
                          id: 'F1',
                          severity: 'critical',
                          description: '数量算法冲突',
                          impact: '错误结果',
                          entityIds: [],
                          recommendation: '明确算法',
                        },
                      ]
                    : [],
                }
              : spec;
        options.onDelta(JSON.stringify(output));
        return { modelId: 'synthetic' };
      },
    });
  } catch (e) {
    error = e;
  }
  return { calls, snapshots, saved, error };
}
test('formal execution plans, observes, revises and reviews before publication', async () => {
  const result = await runManaged();
  assert.equal(result.error, undefined);
  assert.deepEqual(result.calls, ['plan', 'draft', 'revise', 'review']);
  assert.ok(result.saved);
  assert.ok(result.snapshots.some((s) => s.qualityReview?.status === 'passed'));
  assert.ok(result.snapshots.some((s) => s.designCalls?.some((c) => c.task === 'revise')));
});
test('unresolved critical design findings keep the candidate but never publish a final artifact', async () => {
  const result = await runManaged(true);
  assert.ok(result.error);
  assert.equal(result.error.code, 'QUALITY_BLOCKED');
  assert.equal(result.saved, undefined);
  assert.ok(result.snapshots.some((s) => s.qualityReview?.status === 'blocked' && s.candidate));
  assert.ok(result.calls.length <= 6);
});
