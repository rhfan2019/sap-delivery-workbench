import { sha256 } from '../abap-fsd-agent/specification.mjs';
import { failure } from '../auth.mjs';
import { renderPrompt } from './development-prompts.mjs';
export function scenarioFeatures({
  scenario,
  currentMessage = '',
  messages = [],
  association,
} = {}) {
  if (scenario)
    return {
      editable: scenario.editable === true,
      objectFeedback: scenario.objectFeedback === true,
    };
  if (/只读|不允许编辑|取消.*(?:保存|写入|编辑)/.test(currentMessage))
    return { editable: false, objectFeedback: false };
  const source = [
    currentMessage,
    ...messages.filter((m) => m.role === 'user').map((m) => m.content),
    JSON.stringify(association?.requirement ?? {}),
  ].join('\n');
  const editable =
    /可编辑|允许编辑|选中.{0,15}保存|修改.{0,20}保存|批量.{0,10}(?:创建|更新|删除|过账)/.test(
      source,
    );
  return {
    editable,
    objectFeedback: editable || /逐(?:行|对象).{0,12}(?:结果|重试|反馈)/.test(source),
  };
}
export function buildContext({
  messages = [],
  currentMessage,
  budget = 48000,
  systemProfile = null,
  systemTargets = null,
  association = null,
  task = 'dialogue',
  riceType = null,
  attachments = [],
  extraInstructions = '',
  consultantDecisions = [],
  outputMode = task,
  scenario = null,
  existingSources = [],
  activeSpecification = null,
}) {
  if (!Array.isArray(messages) || messages.length > 100)
    throw failure(400, '历史消息过多，请开始新对话。');
  const ids = new Set(),
    included = [],
    excluded = [],
    history = [];
  for (const m of messages) {
    if (
      !m ||
      typeof m.id !== 'string' ||
      m.id.length > 80 ||
      ids.has(m.id) ||
      !['user', 'assistant'].includes(m.role) ||
      typeof m.content !== 'string' ||
      m.content.length > 262144 ||
      !['completed', 'failed', 'cancelled'].includes(m.status)
    )
      throw failure(400, '历史消息格式无效。');
    ids.add(m.id);
    if (
      outputMode === 'clarification' &&
      m.role === 'assistant' &&
      /^\s*(?:```json\s*)?\{/.test(m.content)
    ) {
      excluded.push({
        id: m.id,
        reason: 'previous_structured_output_not_a_clarification_instruction',
      });
      continue;
    }
    if (m.status !== 'completed') {
      excluded.push({ id: m.id, reason: m.status });
      continue;
    }
    history.push({ role: m.role, content: m.content });
    included.push(m.id);
  }
  const features = scenarioFeatures({ scenario, currentMessage, messages, association });
  let registeredSources = [
    {
      id: 'SRC-001',
      kind: 'user_message',
      label: '当前请求',
      reference: 'message:sha256:' + sha256(currentMessage),
    },
  ];
  if (association?.itemId)
    registeredSources.push({
      id: 'SRC-002',
      kind: 'system_export',
      label: association.itemCode + '需求快照',
      reference: 'development-item:' + association.itemId + '@' + association.rowVersion,
    });
  attachments.forEach((a, i) =>
    registeredSources.push({
      id: 'SRC-' + String(i + 3).padStart(3, '0'),
      kind: 'processed_attachment',
      label: a.name,
      reference: 'attachment:' + a.id + ':sha256:' + a.content_hash,
    }),
  );
  messages
    .filter((m) => m.role === 'user' && m.status === 'completed')
    .forEach((m, i) =>
      registeredSources.push({
        id: 'SRC-' + (1000 + i),
        kind: 'user_message',
        label: '历史用户消息',
        reference: 'message:' + m.id + ':sha256:' + sha256(m.content),
      }),
    );
  consultantDecisions.forEach((d, i) =>
    registeredSources.push({
      id: 'SRC-' + (2000 + i),
      kind: 'user_message',
      label: '顾问回答：' + d.question,
      reference: 'decision:sha256:' + sha256(d),
    }),
  );
  const priorSources = structuredClone(existingSources);
  const used = new Set(priorSources.map((s) => s.id));
  let sourceNumber = 3000;
  registeredSources = [
    ...priorSources,
    ...registeredSources.flatMap((source) => {
      if (priorSources.some((s) => s.kind === source.kind && s.reference === source.reference))
        return [];
      while (used.has(source.id)) source.id = 'SRC-' + sourceNumber++;
      used.add(source.id);
      return [source];
    }),
  ];
  const contextData = JSON.stringify({
    consultantDecisions,
    systemProfile,
    systemTargets,
    association,
    registeredSources,
    attachments,
    scenario: features,
    activeSpecification,
    capabilities: {
      structuredTypes: ['R'],
      metadata: !!systemProfile?.systemId,
      imageUnderstanding: false,
      persistentWorkflow: true,
      businessExecution: false,
    },
  });
  const result = [
    {
      role: 'system',
      content:
        extraInstructions + '\n' + renderPrompt('context-background', { background: contextData }),
    },
    ...history,
    { role: 'user', content: currentMessage },
    ...(consultantDecisions.length
      ? [
          {
            role: 'user',
            content: renderPrompt('context-decisions', {
              decisions: JSON.stringify(consultantDecisions),
            }),
          },
        ]
      : []),
  ];
  const bytes = Buffer.byteLength(JSON.stringify(result), 'utf8');
  if (bytes > budget)
    throw failure(413, `上下文超过本次预算（${budget} UTF-8 字节）；未截断或发送，请精简资料。`);
  return {
    background: JSON.parse(contextData),
    messages: result,
    manifest: {
      version: 1,
      outputProtocolVersion: '2.0.0',
      scenario: features,
      promptFiles: [],
      runtimeInstructionsHash: sha256(
        result.filter((m) => m.role === 'system').map((m) => m.content),
      ),
      task,
      systemTargets,
      sources: registeredSources,
      consultantDecisions,
      attachments: attachments.map((a) => ({
        id: a.id,
        name: a.name,
        contentHash: a.content_hash,
        parserVersion: a.extraction.parserVersion,
        regions: a.extraction.regions.map((r) => r.locator),
      })),
      included,
      excluded,
      bytes,
      budgetBytes: budget,
      budgetKind: 'utf8-bytes-not-tokens',
      rules: [],
    },
    warnings: excluded.length
      ? ['部分助手输出未纳入本次上下文，原因见 manifest.excluded；用户消息和业务回答保留。']
      : [],
  };
}
