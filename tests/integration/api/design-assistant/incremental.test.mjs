import test from 'node:test';
import assert from 'node:assert/strict';
import { workflow } from '../../../fixtures/design-assistant/workflow.mjs';
import {
  syntheticModel,
  SYNTHETIC_DOCUMENT,
} from '../../../../apps/api/src/modules/design-assistant/simulation.mjs';
import { toFsdWire } from '@sap-delivery-workbench/contracts/design-assistant/fsd-report-wire';
import { validateFsdReport } from '@sap-delivery-workbench/contracts/design-assistant/fsd-report';

// Wire text of some parts of a modified copy of the synthetic document.
const wireOf = (edit, parts) => {
  const doc = structuredClone(SYNTHETIC_DOCUMENT);
  edit(doc);
  return '> 思路：测试。\n' + toFsdWire(doc, { parts });
};
const answer = (text) => ({ output: { text }, usage: { total_tokens: 200 }, cost: null });
const section = (doc, id) => doc.logic.sections.find((s) => s.id === id);
const field = (doc, id) => doc.output.fields.find((f) => f.id === id);
const reviewIssue = (rule_ref) => ({
  issue_id: 'i',
  rule_ref,
  counterexample: '取消后的数量仍被计入',
  evidence_refs: [],
  impact: '错误计数',
  suggestion: '修正规则正文',
  status: 'OPEN',
});

test('FLOW-05 title and formula revisions preserve untouched objects and invalidate old confirmation', async () => {
  const w = await workflow();
  try {
    await w.run();
    const initial = structuredClone(w.task.document),
      oldWait = structuredClone(w.task.wait);
    await w.command({ command: 'supplement', text: '仅修改报表标题' });
    await w.run({
      model: async (args) =>
        args.kind === 'FsdRevise'
          ? answer(wireOf((d) => (d.overview.summary = '新标题：未清订单清单'), ['overview']))
          : syntheticModel(args),
    });
    assert.equal(w.task.document.overview.summary, '新标题：未清订单清单');
    assert.deepEqual(w.task.document.logic, initial.logic);
    assert.deepEqual(w.task.document.output, initial.output);
    await assert.rejects(
      () => w.command({ command: 'confirm', ...oldWait, confirmed: true }),
      /STALE_CONFIRMATION/,
    );
    const titled = structuredClone(w.task.document);
    await w.command({ command: 'supplement', text: '修改未清计算公式及筛选' });
    await w.run({
      model: async (args) =>
        args.kind === 'FsdRevise'
          ? answer(
              wireOf(
                (d) => {
                  section(d, 'LOG-OPEN').blocks[0].items = [
                    'REMAINING = QUANTITY - PROCESSED - BLOCKED。',
                  ];
                },
                ['section:LOG-OPEN'],
              ),
            )
          : syntheticModel(args),
    });
    const doc = w.task.document;
    assert.equal(doc.overview.summary, titled.overview.summary);
    assert.equal(section(doc, 'LOG-OPEN').rev, section(initial, 'LOG-OPEN').rev + 1);
    assert.deepEqual(section(doc, 'LOG-QUERY'), section(initial, 'LOG-QUERY'));
    assert.equal(w.task.wait_reason, 'PLAN_CONFIRM');
    assert.equal(w.task.status, 'WAITING');
  } finally {
    await w.close();
  }
});
for (const repairBody of [false, true])
  test('FLOW-06 a review revision that changes nothing is recorded: ' + repairBody, async () => {
    const w = await workflow();
    let reviews = 0;
    try {
      const execute = () =>
        w.run({
          model: async (args) => {
            if (args.kind === 'FsdRevise' && args.part.reason === 'review') {
              assert.deepEqual(
                args.part.issues.map((i) => i.rule_ref),
                ['LOG-OPEN'],
              );
              return answer(
                repairBody
                  ? wireOf(
                      (d) => {
                        section(d, 'LOG-OPEN').blocks[0].items.push(
                          '取消的数量不计入；修复了取消后剩余量反例。',
                        );
                      },
                      ['section:LOG-OPEN'],
                    )
                  : '> 思路：认为无需修改。',
              );
            }
            const r = await syntheticModel(args);
            if (args.kind === 'ReviewResult' && ++reviews === 1)
              r.output.issues = [reviewIssue('LOG-OPEN')];
            return r;
          },
        });
      if (repairBody) {
        await execute();
        assert.equal(w.task.wait_reason, 'PLAN_CONFIRM');
        assert.ok(section(w.task.document, 'LOG-OPEN').blocks[0].items.at(-1).includes('修复了'));
      } else {
        await execute();
        assert.equal(w.task.artifacts.length, 1);
        assert.equal(w.task.wait_reason, 'PLAN_CONFIRM');
        assert.ok(
          (
            await w.pool.query(
              "SELECT 1 FROM app.fsd_v1_event WHERE task_id=$1 AND event_type='quality.issue' AND data->>'check'='REVIEW_NOT_APPLIED'",
              [w.task.id],
            )
          ).rowCount,
        );
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
test('FLOW-08 a confirmed FSD is delivered without valid evidence, and the gap is recorded', async () => {
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
    await w.run();
    assert.equal(w.task.delivered_artifact_id, w.task.artifacts.at(-1).id);
    assert.equal(w.task.artifacts.length, 2);
    assert.ok(
      (
        await w.pool.query(
          "SELECT 1 FROM app.fsd_v1_event WHERE task_id=$1 AND event_type='quality.issue' AND data->>'check'='STALE_EVIDENCE' AND data->>'node_id'='N11'",
          [w.task.id],
        )
      ).rowCount,
    );
  } finally {
    await w.close();
  }
});
test('FLOW-05 deleting an object other parts still cite leaves no dangling reference', async () => {
  const w = await workflow();
  try {
    await w.run();
    await w.command({ command: 'supplement', text: '删除订单必填提示' });
    await w.run({
      model: async (args) =>
        args.kind === 'FsdRevise'
          ? answer('> 思路：删除提示。\n## 删除\n- MSG-NO-ORDER')
          : syntheticModel(args),
    });
    const doc = w.task.document;
    assert.ok(!doc.messages.items.some((m) => m.id === 'MSG-NO-ORDER'));
    assert.doesNotMatch(JSON.stringify(doc), /\[\[MSG-NO-ORDER\]\]/);
    const issue = doc.working.open_issues.find((i) => i.id === 'ISS-DANGLING-REFS');
    assert.ok(issue.title.includes('MSG-NO-ORDER'));
    assert.deepEqual(validateFsdReport(doc), { ok: true, errors: [] });
    assert.equal(w.task.wait_reason, 'PLAN_CONFIRM');
  } finally {
    await w.close();
  }
});
test('FLOW-09 a fresh document is written as an outline, then its parts in parallel', async () => {
  const w = await workflow();
  const calls = [];
  try {
    await w.run({
      model: async (args) => {
        if (['FsdOutline', 'FsdWrite'].includes(args.kind))
          calls.push({
            kind: args.kind,
            key: args.part?.key,
            outline: (args.part?.outline ?? []).map((o) => o.id),
            draftSections: (args.part?.draft?.logic?.sections ?? []).map((s) => s.id),
          });
        return syntheticModel(args);
      },
    });
    assert.equal(w.task.wait_reason, 'PLAN_CONFIRM');
    // The parts are written in parallel, so only the first and last call have a fixed place.
    assert.equal(calls[0].key, 'outline');
    assert.equal(calls.at(-1).key, 'tail');
    assert.deepEqual(
      calls
        .slice(1, -1)
        .map((c) => c.key)
        .sort(),
      ['require', 'section:LOG-OPEN', 'section:LOG-QUERY', 'spec'],
    );
    for (const c of calls.slice(1))
      assert.deepEqual(c.outline, ['LOG-QUERY', 'LOG-OPEN', 'MSG-NO-ORDER']);
    // Messages and analysis tables are written last, against the assembled sections.
    assert.deepEqual(calls.at(-1).draftSections, ['LOG-QUERY', 'LOG-OPEN']);
    const doc = w.task.document;
    assert.deepEqual(
      doc.logic.sections.map((s) => s.id),
      ['LOG-QUERY', 'LOG-OPEN'],
    );
    assert.deepEqual(validateFsdReport(doc), { ok: true, errors: [] });
    assert.equal(w.task.artifacts.at(-1).document.doc.version, 'V1.0');
  } finally {
    await w.close();
  }
});
test('FLOW-10 a revision restating a saved row updates it in place and counts its revision', async () => {
  const w = await workflow();
  try {
    await w.run();
    const before = structuredClone(w.task.document);
    await w.command({ command: 'supplement', text: '剩余数量改为显示单位' });
    await w.run({
      model: async (args) =>
        args.kind === 'FsdRevise'
          ? answer(
              wireOf(
                (d) => (field(d, 'OUT-REMAINING').description = '剩余数量（含单位）'),
                ['output'],
              ),
            )
          : syntheticModel(args),
    });
    const doc = w.task.document;
    assert.equal(field(doc, 'OUT-REMAINING').description, '剩余数量（含单位）');
    assert.equal(field(doc, 'OUT-REMAINING').rev, field(before, 'OUT-REMAINING').rev + 1);
    assert.deepEqual(field(doc, 'OUT-ORDER'), field(before, 'OUT-ORDER'));
    assert.equal(
      doc.output.fields.findIndex((f) => f.id === 'OUT-REMAINING'),
      before.output.fields.findIndex((f) => f.id === 'OUT-REMAINING'),
    );
    assert.equal(w.task.artifacts.at(-1).document.doc.version, 'V1.1');
    assert.equal(w.task.wait_reason, 'PLAN_CONFIRM');
  } finally {
    await w.close();
  }
});
test('FLOW-11 rules may rest on customer answers and the requirement text', async () => {
  const w = await workflow();
  try {
    await w.run({
      model: async (args) =>
        args.kind === 'FsdWrite' && args.part.key === 'section:LOG-OPEN'
          ? answer(
              wireOf(
                (d) =>
                  (section(d, 'LOG-OPEN').basis = {
                    kind: 'CUSTOMER_DECISION',
                    refs: ['answer:open-definition', 'requirement'],
                  }),
                ['section:LOG-OPEN'],
              ),
            )
          : syntheticModel(args),
    });
    assert.equal(w.task.wait_reason, 'PLAN_CONFIRM');
    assert.deepEqual(section(w.task.document, 'LOG-OPEN').basis, {
      kind: 'CUSTOMER_DECISION',
      refs: ['answer:open-definition', 'requirement'],
    });
  } finally {
    await w.close();
  }
});
test('FLOW-12 a review repair rewrites only the cited section; the rest keeps its revision', async () => {
  const w = await workflow();
  let reviews = 0;
  const reasons = [];
  try {
    await w.run({
      model: async (args) => {
        if (args.kind === 'FsdRevise') {
          reasons.push(args.part.reason);
          return answer(
            wireOf(
              (d) => section(d, 'LOG-OPEN').blocks[0].items.push('取消的数量不计入。'),
              ['section:LOG-OPEN'],
            ),
          );
        }
        const r = await syntheticModel(args);
        if (args.kind === 'ReviewResult' && ++reviews === 1)
          r.output.issues = [reviewIssue('LOG-OPEN')];
        return r;
      },
    });
    assert.deepEqual(reasons, ['review']);
    const doc = w.task.document;
    assert.equal(section(doc, 'LOG-OPEN').rev, 2);
    assert.equal(section(doc, 'LOG-QUERY').rev, 1);
    assert.ok(doc.output.fields.every((f) => f.rev === 1));
    assert.equal(w.task.artifacts.length, 1, 'the repair happens before the plan is committed');
  } finally {
    await w.close();
  }
});
test('FLOW-13 references to objects nobody defines get one fix call, then become an open item', async () => {
  const w = await workflow();
  const fixes = [];
  try {
    await w.run({
      model: async (args) => {
        if (args.kind === 'FsdWrite' && args.part.key.startsWith('section:LOG-QUERY')) {
          if (args.part.problems) fixes.push(args.part.problems.map((p) => p.message));
          // The model keeps citing a section nobody writes, even after being told.
          return answer(
            wireOf(
              (d) => section(d, 'LOG-QUERY').blocks[0].items.push('排除规则见 [[LOG-NEVER]]。'),
              ['section:LOG-QUERY'],
            ),
          );
        }
        return syntheticModel(args);
      },
    });
    assert.equal(w.task.wait_reason, 'PLAN_CONFIRM');
    assert.deepEqual(fixes, [['unknown reference LOG-NEVER']]);
    const doc = w.task.document;
    assert.doesNotMatch(JSON.stringify(doc.logic), /LOG-NEVER/);
    const issue = w.task.artifacts.at(-1).issues.find((i) => i.id === 'ISS-DANGLING-REFS');
    assert.ok(issue?.description.includes('LOG-NEVER'));
    assert.equal(issue.blocking, false);
  } finally {
    await w.close();
  }
});
test('FLOW-14 a part failing the content model gets one targeted rewrite', async () => {
  const w = await workflow();
  const requireCalls = [];
  try {
    await w.run({
      model: async (args) => {
        if (args.kind === 'FsdWrite' && args.part.key.startsWith('require')) {
          requireCalls.push(args.part.key);
          // First answer uses a difficulty outside 高/中/低; the fix call is told so.
          if (args.part.key === 'require')
            return answer(wireOf((d) => (d.overview.difficulty = '中等'), args.part.parts));
          assert.ok(args.part.problems.some((p) => p.path === '/overview/difficulty'));
        }
        return syntheticModel(args);
      },
    });
    assert.deepEqual(requireCalls, ['require', 'require:fix']);
    assert.equal(w.task.document.overview.difficulty, '低');
    assert.equal(w.task.wait_reason, 'PLAN_CONFIRM');
  } finally {
    await w.close();
  }
});
