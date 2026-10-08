import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionDecisions } from '../../../../apps/api/src/modules/agent-runtime/session-state.mjs';
test('legacy natural answers are recovered without rewriting stored conversation rows', () => {
  const rows = [
    {
      id: 'legacy',
      snapshot: {
        messages: [
          {
            id: 'q',
            role: 'assistant',
            status: 'completed',
            content: '1. **审批方式：**\n采用标准BAPI',
          },
        ],
        prompt: '问题1：不考虑工作流',
        decisions: [],
      },
    },
  ];
  const answers = sessionDecisions(rows);
  assert.equal(answers[0].label, '不考虑工作流');
  assert.equal(answers[0].sourceRunId, 'legacy');
  assert.equal(rows[0].snapshot.decisions.length, 0);
});
import {
  renderTechnicalOutput,
  isRenderRequest,
  extractConfirmedAnswers,
  selectRenderSource,
} from '../../../../apps/api/src/modules/agent-runtime/feedback.mjs';
test('render picks newest structured message, rather than an older saved artifact', () => {
  assert.equal(
    selectRenderSource({
      history: [
        {
          role: 'assistant',
          status: 'completed',
          content: '{"title":"旧"}',
          artifact: { spec: { title: '旧' } },
        },
        { role: 'assistant', status: 'completed', content: '{"title":"新"}' },
      ],
      latestArtifact: { spec: { title: '旧' } },
    }),
    ' {"title":"新"}'.trim(),
  );
});
test('JSON to markdown is a deterministic render intent, not a new design request', () => {
  assert.equal(isRenderRequest('请基于JSON生成Markdown格式的FSD'), true);
  assert.equal(isRenderRequest('修改计算规则并生成FSD'), false);
  const value = { title: '采购申请', scope: { inScope: ['修改数量'] }, count: 3 };
  const rendered = renderTechnicalOutput(JSON.stringify(value));
  assert.match(rendered.markdown, /采购申请/);
  assert.match(rendered.markdown, /修改数量/);
  assert.match(rendered.markdown, /3/);
  assert.equal(rendered.contractValid, false);
  assert.throws(() => renderTechnicalOutput('{"title":'));
});
test('numbered answers retain original question, user source and recommended scope', () => {
  const history = [
    {
      id: 'a',
      role: 'assistant',
      status: 'completed',
      content: '1. **审批方式：**\n推荐标准方式\n2. **合并规则：**\n按配置',
    },
  ];
  const facts = extractConfirmedAnswers(history, '问题1：不考虑工作流；\n问题2：依赖SAP配置。');
  assert.equal(facts.length, 2);
  assert.match(facts[0].question, /审批方式/);
  assert.equal(facts[0].label, '不考虑工作流');
  assert.match(facts[1].label, /SAP配置/);
  assert.equal(extractConfirmedAnswers([], '问题1：采用推荐').length, 0);
  assert.equal(extractConfirmedAnswers(history, '问题9：采用推荐').length, 0);
});
