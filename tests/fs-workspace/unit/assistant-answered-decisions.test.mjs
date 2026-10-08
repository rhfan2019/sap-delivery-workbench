import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContext } from '../../../apps/api/src/item-workspace/development-context.mjs';
import { modelDecision } from '../../../apps/api/src/abap-fsd-agent/decisions.mjs';
test('submitted decisions are the latest user turn with provenance, not only background', () => {
  const c = buildContext({
    currentMessage: '原需求',
    consultantDecisions: [{ question: '合计方式？', label: '暂不确定', description: '保留待确认' }],
  });
  assert.equal(c.messages.filter((m) => m.role === 'user').at(-1).role, 'user');
  assert.match(c.messages.filter((m) => m.role === 'user').at(-1).content, /暂不确定/);
  assert.equal(c.manifest.sources.at(-1).id, 'SRC-2000');
});
test('exact answered question cannot reopen; unrelated question remains actionable', () => {
  const text = JSON.stringify({
    kind: 'clarification',
    questions: ['合计方式？', '收货口径？'].map((title) => ({
      title,
      options: [
        { label: 'A', description: 'a' },
        { label: 'B', description: 'b' },
      ],
    })),
  });
  assert.equal(modelDecision(text, [{ question: '合计方式？' }]).questions.length, 1);
  assert.equal(modelDecision(text, [{ question: '合计方式？' }, { question: '收货口径？' }]), null);
});
