import test from 'node:test';
import assert from 'node:assert/strict';
import { workflow } from '../../../fixtures/design-assistant/workflow.mjs';
import { syntheticModel } from '../../../../apps/api/src/modules/design-assistant/simulation.mjs';
test('FLOW-05 title and formula revisions preserve untouched object versions and invalidate old confirmation', async () => {
  const w = await workflow();
  try {
    await w.run();
    const initial = structuredClone(w.task.objects),
      oldWait = structuredClone(w.task.wait);
    await w.command({ command: 'supplement', text: '仅修改报表标题' });
    await w.run({
      model: async (args) => {
        const r = await syntheticModel(args);
        if (args.kind === 'ChangeProposal') {
          // Only the group holding chapter 1 changes; the other groups answer "unchanged".
          r.output.changes = r.output.changes.filter((c) => c.section === 1);
          if (r.output.changes[0])
            r.output.changes[0].content = '新标题；' + r.output.changes[0].content;
        }
        return r;
      },
    });
    assert.equal(w.task.objects['section-1'].version, initial['section-1'].version + 1);
    for (let n = 2; n <= 8; n++)
      assert.deepEqual(w.task.objects['section-' + n], initial['section-' + n]);
    await assert.rejects(
      () => w.command({ command: 'confirm', ...oldWait, confirmed: true }),
      /STALE_CONFIRMATION/,
    );
    const title = structuredClone(w.task.objects['section-1']);
    await w.command({ command: 'supplement', text: '修改未清计算公式及筛选' });
    await w.run({
      model: async (args) => {
        const r = await syntheticModel(args);
        if (args.kind === 'ChangeProposal') {
          r.output.changes = r.output.changes.filter((c) => [5, 6].includes(c.section));
          r.output.changes.forEach((c) => (c.content = '口径修订：' + c.content));
        }
        return r;
      },
    });
    assert.deepEqual(w.task.objects['section-1'], title);
    assert.equal(w.task.objects['section-6'].version, initial['section-6'].version + 1);
    assert.equal(w.task.wait_reason, 'PLAN_CONFIRM');
    assert.equal(w.task.status, 'WAITING');
  } finally {
    await w.close();
  }
});
for (const repairBody of [false, true])
  test('FLOW-06 resolved review requires actual body change: ' + repairBody, async () => {
    const w = await workflow();
    let reviews = 0;
    try {
      const execute = () =>
        w.run({
          model: async (args) => {
            const r = await syntheticModel(args);
            // Repair round: chapters are proposed per group, so only the group holding the
            // fixed chapter carries the edit.
            if (args.kind === 'ChangeProposal' && args.context.r.state.review_open?.length) {
              assert.equal(args.context.r.state.review_open.length, 1);
              const fixed = r.output.changes.find((c) => c.section === (repairBody ? 6 : 7));
              if (fixed) fixed.content += ' 修复了取消后剩余量反例。';
            }
            if (args.kind === 'ReviewResult' && ++reviews === 1)
              r.output.issues = [
                {
                  issue_id: 'i',
                  rule_ref: 'section-6',
                  counterexample: '取消后的数量仍被计入',
                  evidence_refs: r.output.evidence_refs,
                  impact: '错误计数',
                  suggestion: '修正规则正文',
                  status: 'OPEN',
                },
              ];
            return r;
          },
        });
      if (repairBody) {
        await execute();
        assert.equal(w.task.wait_reason, 'PLAN_CONFIRM');
        assert.ok(w.task.objects['section-6'].content.includes('修复了'));
      } else {
        await assert.rejects(execute, /REVIEW_NOT_APPLIED/);
        assert.equal(w.task.artifacts.length, 0);
        assert.equal(w.task.wait_reason, 'TECHNICAL');
      }
    } finally {
      await w.close();
    }
  });
test('FLOW-08 withdrawn premise and explicit end never become delivered and preserve history', async () => {
  const w = await workflow();
  try {
    await w.run();
    const before = structuredClone(w.task.artifacts);
    await w.command({ command: 'withdraw' });
    assert.equal(w.task.status, 'PAUSED');
    assert.equal(w.task.pause_reason, 'PREMISE_WITHDRAWN');
    await w.command({ command: 'end' });
    assert.equal(w.task.status, 'ENDED');
    assert.deepEqual(w.task.artifacts, before);
    assert.equal(w.task.delivered_artifact_id, undefined);
    await assert.rejects(() => w.command({ command: 'recover' }), /INVALID_TRANSITION/);
  } finally {
    await w.close();
  }
});
test('FLOW-08 explicit final confirmation cannot publish an artifact after critical evidence disappears', async () => {
  const w = await workflow();
  try {
    await w.run();
    await w.command({ command: 'confirm', ...w.task.wait, confirmed: true });
    await w.run();
    await w.pool.query(
      "UPDATE app.fsd_v1_task SET state=jsonb_set(state,'{evidence}','[]'::jsonb) WHERE id=$1",
      [w.task.id],
    );
    await w.refresh();
    await w.command({ command: 'confirm', ...w.task.wait, confirmed: true });
    await assert.rejects(() => w.run(), /DELIVERY_BLOCKED/);
    assert.equal(w.task.delivered_artifact_id, undefined);
    assert.equal(w.task.artifacts.length, 2);
  } finally {
    await w.close();
  }
});
for (const includeDependent of [false, true])
  test('FLOW-05 atomic dependency transaction closure: ' + includeDependent, async () => {
    const w = await workflow();
    try {
      await w.run({
        model: async (args) => {
          const v = await syntheticModel(args);
          if (args.kind === 'ChangeProposal') {
            v.output.changes.push(
              {
                object_id: 'field-quantity',
                base_version: 0,
                op: 'ADD',
                content: '数量，单位 EA',
                dependencies: v.output.evidence_refs,
                reason: 'fixed fixture',
                section: 3,
              },
              {
                object_id: 'rule-open',
                base_version: 0,
                op: 'ADD',
                content: '数量大于零',
                dependencies: ['field-quantity'],
                reason: 'fixed fixture',
                section: 6,
              },
            );
            v.output.allowed_scope.push('field-quantity', 'rule-open');
          }
          return v;
        },
      });
      const old = structuredClone(w.task.objects),
        version = w.task.artifact_version;
      await w.command({ command: 'supplement', text: '变更数量字段及受影响规则' });
      const run = () =>
        w.run({
          model: async (args) => {
            const v = await syntheticModel(args);
            if (args.kind === 'ChangeProposal') {
              v.output.changes = [
                {
                  ...old['field-quantity'],
                  base_version: 1,
                  op: 'REVISE',
                  content: '数量，单位 BOX',
                },
                ...(includeDependent
                  ? [
                      {
                        ...old['rule-open'],
                        base_version: 1,
                        op: 'REVISE',
                        content: '数量换算后大于零',
                      },
                    ]
                  : []),
              ].map(({ version, kind, dependency_links, ...c }) => c);
              v.output.allowed_scope = v.output.changes.map((c) => c.object_id);
            }
            return v;
          },
        });
      if (includeDependent) {
        await run();
        assert.equal(w.task.objects['rule-open'].dependency_links[0].target_version, 2);
        assert.equal(w.task.artifact_version, version + 1);
        assert.deepEqual(w.task.objects['section-1'], old['section-1']);
      } else {
        await assert.rejects(run, /DEPENDENCY_REVIEW_REQUIRED/);
        assert.deepEqual(w.task.objects, old);
        assert.equal(w.task.artifact_version, version);
      }
    } finally {
      await w.close();
    }
  });
test('FLOW-09 a fresh FSD proposal is written chapter group by chapter group', async () => {
  const w = await workflow();
  const calls = [];
  try {
    await w.run({
      model: async (args) => {
        const r = await syntheticModel(args);
        if (args.kind === 'ChangeProposal')
          calls.push({
            group: args.part?.group.sections,
            sections: r.output.changes.map((c) => c.section),
            draftSections: (args.part?.draft?.changes ?? []).map((c) => c.section),
          });
        return r;
      },
    });
    assert.equal(w.task.wait_reason, 'PLAN_CONFIRM');
    assert.equal(calls.length, 4, 'one call per chapter group, not one call for the whole FSD');
    for (const c of calls) assert.ok(c.sections.every((n) => c.group.includes(n)));
    assert.deepEqual(calls[1].draftSections.sort(), calls[0].group.slice().sort());
    assert.deepEqual(
      [...new Set(Object.values(w.task.objects).map((o) => o.section))].sort(),
      [1, 2, 3, 4, 5, 6, 7, 8],
    );
  } finally {
    await w.close();
  }
});
test('FLOW-10 a revision that labels saved chapters as new still commits as a revision', async () => {
  const w = await workflow();
  try {
    await w.run();
    const before = structuredClone(w.task.objects);
    await w.command({ command: 'supplement', text: '修订第 1 章' });
    await w.run({
      model: async (args) => {
        const r = await syntheticModel(args);
        if (args.kind === 'ChangeProposal')
          // The model copies the first proposal's shape: "ADD, version 0" for a saved chapter.
          r.output.changes = r.output.changes
            .filter((c) => c.section === 1)
            .map((c) => ({ ...c, op: 'ADD', base_version: 0, content: '修订：' + c.content }));
        return r;
      },
    });
    assert.equal(w.task.objects['section-1'].version, before['section-1'].version + 1);
    assert.ok(w.task.objects['section-1'].content.startsWith('修订：'));
    assert.equal(w.task.wait_reason, 'PLAN_CONFIRM');
  } finally {
    await w.close();
  }
});
test('FLOW-11 rules may depend on customer answers and the requirement text', async () => {
  const w = await workflow();
  try {
    await w.command({ command: 'supplement', text: '按客户答复定义未清' });
    await w.run({
      model: async (args) => {
        const r = await syntheticModel(args);
        if (args.kind === 'ChangeProposal')
          for (const c of r.output.changes)
            if (c.section === 6)
              // How the model cites them after reading the prompt snapshot.
              c.dependencies = [
                ...c.dependencies,
                'snapshot.answers.open-definition',
                'snapshot.text',
              ];
        return r;
      },
    });
    assert.equal(w.task.wait_reason, 'PLAN_CONFIRM');
    const links = w.task.objects['section-6'].dependency_links.map((l) => l.target_id);
    assert.ok(links.includes('answer:open-definition'));
    assert.ok(links.includes('requirement'));
  } finally {
    await w.close();
  }
});
