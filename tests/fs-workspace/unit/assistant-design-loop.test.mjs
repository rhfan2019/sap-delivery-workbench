import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
const fixture = () =>
  JSON.parse(
    readFileSync(
      new URL('../../../packages/contracts/abap-fsd-agent/fsd/v1/r.example.json', import.meta.url),
    ),
  );
const moduleUrl = new URL('../../../apps/api/src/abap-fsd-agent/design-loop.mjs', import.meta.url);
async function implementation() {
  assert.ok(existsSync(moduleUrl), 'bounded design loop must exist');
  return import(moduleUrl.href);
}
const contextFor = (s) => ({
  background: { registeredSources: s.sources },
  messages: [],
  manifest: {
    sources: s.sources,
    scenario: {},
    budgetBytes: 180000,
    workflow: { phase: 'refining' },
  },
});

test('observations drive revision before review and same objects are not requeried', async () => {
  const { refineDesign } = await implementation();
  const s = fixture();
  const revised = fixture();
  revised.rules[0].decision.value = '根据证据修正后的计算规则';
  let queries = 0;
  const calls = [];
  const result = await refineDesign({
    spec: s,
    context: contextFor(s),
    signal: new AbortController().signal,
    invoke: async ({ context, onDelta }) => {
      calls.push(context.manifest.task);
      assert.match(JSON.stringify(context.messages), /metadata-observation/);
      onDelta(JSON.stringify(context.manifest.task === 'review' ? { findings: [] } : revised));
    },
    verify: async (candidates) => {
      queries++;
      return {
        objects: candidates.map((o) => ({
          ...o,
          verificationStatus: 'partial',
          verificationScope: 'metadata-observation',
          evidenceIds: ['EVD-100'],
        })),
        evidence: [{ id: 'EVD-100', claim: 'metadata-observation' }],
        raw: [],
      };
    },
  });
  assert.equal(result.spec.rules[0].decision.value, revised.rules[0].decision.value);
  assert.deepEqual(calls, ['revise', 'review']);
  assert.equal(queries, 1);
  assert.equal(result.report.status, 'passed');
});

test('no progress stops revision loops and leaves concrete findings visible', async () => {
  const { refineDesign } = await implementation();
  const s = fixture();
  let calls = 0;
  const result = await refineDesign({
    spec: s,
    context: contextFor(s),
    signal: new AbortController().signal,
    invoke: async ({ context, onDelta }) => {
      calls++;
      onDelta(
        JSON.stringify(
          context.manifest.task === 'review'
            ? {
                findings: [
                  {
                    id: 'F1',
                    severity: 'major',
                    description: '算法缺少单位分组',
                    impact: '混加',
                    entityIds: [],
                    recommendation: '分单位',
                  },
                ],
              }
            : s,
        ),
      );
    },
    verify: async (candidates) => ({ objects: candidates, evidence: [], raw: [] }),
  });
  assert.equal(result.report.status, 'no_progress');
  assert.ok(calls <= 4);
  assert.equal(result.report.findings[0].id, 'F1');
});

test('revision cannot forge evidence and critical unresolved review cannot pass', async () => {
  const { refineDesign } = await implementation();
  const s = fixture();
  const forged = fixture();
  forged.evidence = [{ id: 'evil' }];
  await assert.rejects(
    refineDesign({
      spec: s,
      context: contextFor(s),
      signal: new AbortController().signal,
      invoke: async ({ onDelta }) => onDelta(JSON.stringify(forged)),
      verify: async (candidates) => ({ objects: candidates, evidence: [], raw: [] }),
    }),
    /校验|候选/,
  );
});

test('planning rejects invalid dependencies instead of treating a prose plan as completed', async () => {
  const { createDesignPlan } = await implementation();
  const s = fixture();
  await assert.rejects(
    createDesignPlan({
      context: contextFor(s),
      signal: new AbortController().signal,
      invoke: async ({ onDelta }) =>
        onDelta(
          JSON.stringify({
            tasks: [
              {
                id: 'T1',
                goal: 'x',
                doneWhen: 'x',
                dependsOn: ['T2'],
                entityIds: [],
                needsEvidence: false,
              },
            ],
            scenario: { editable: false, objectFeedback: false },
          }),
        ),
    }),
    /计划/,
  );
});
