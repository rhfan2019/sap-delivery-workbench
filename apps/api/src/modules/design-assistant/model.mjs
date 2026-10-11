import { requestModel, interpretResponse, openKey } from '../models/public.mjs';
import { fault, hash, toolCatalog, modelOutputLimit, WIRE_KINDS } from './policy.mjs';
import { outputSchemas } from '@sap-delivery-workbench/contracts/design-assistant/protocol';
import { toFsdWire } from '@sap-delivery-workbench/contracts/design-assistant/fsd-report-wire';
import { streamText } from '../agent-runtime/public.mjs';

export async function configuredStreamingModel({ context, signal, onDelta, transport }) {
  const { pool, r, t } = context;
  const model = r.assets.model;
  if (model.mode !== 'REAL' || !model.version_id) throw fault('MODEL_NOT_CONFIGURED', 'MODEL', 409);
  const row = (
    await pool.query(
      'SELECT v.config,c.id,c.secret_cipher FROM app.llm_model_version v JOIN app.llm_credential c ON c.id=v.credential_id AND c.organization_id=v.organization_id WHERE v.id=$1 AND v.organization_id=$2',
      [model.version_id, t.organization_id],
    )
  ).rows[0];
  if (!row || hash(row.config) !== model.config_hash) throw fault('COMPATIBILITY', 'MODEL', 409);
  let text = '';
  const result = await streamText(
    row.config,
    openKey(row.secret_cipher, t.organization_id, row.id),
    r.snapshot.text,
    {
      signal,
      transport,
      onDelta: async (delta) => {
        await onDelta(delta);
        text += delta;
      },
      context: {
        // Streaming chat with a thinking model: a 16k budget let one reply run past 300 s.
        outputLimit: modelOutputLimit('CHAT', r.assets.budget),
        messages: [
          {
            role: 'system',
            content: r.assets.chat_prompt_text,
          },
          ...(r.snapshot.chat_messages ?? [{ role: 'user', content: r.snapshot.text }]),
          ...(r.snapshot.materials?.length
            ? [{ role: 'user', content: '本轮附件资料：' + JSON.stringify(r.snapshot.materials) }]
            : []),
        ],
      },
    },
  );
  return { ...result, text };
}

const PART_LABELS = {
  overview: '开发概览',
  requirement: '业务需求',
  authorizations: '权限校验',
  selection_screen: '选择屏幕',
  selection_checks: '选择屏幕检查',
  output: '输出布局',
  actions: '功能按钮',
  logic: '业务逻辑（本章说明）',
  messages: '消息',
  lifecycle: '生命周期分析',
  reverse_review: '反向审查',
  open_issues: '未决事项',
};
const repairText = (repair) => {
  const code = repair?.code ?? repair;
  const details = (repair?.details ?? [])
    .slice(0, 30)
    .map((d) => `- ${d.line ? '第 ' + d.line + ' 行' : (d.path ?? '')}：${d.message ?? d.keyword}`)
    .join('\n');
  if (code === 'UNKNOWN_REFERENCE')
    return '\n上次输出引用了列表外的证据编号，或把无证据的结论标成了 FACT，已被拒绝；请按上述规则重新输出。';
  if (code === 'INVALID_OUTPUT')
    return (
      '\n上次输出不符合格式要求，已被拒绝；请修正后重新输出。' +
      (details ? '\n问题：\n' + details : '')
    );
  return '';
};

/**
 * The prompt for one structured model call; exported so its content can be tested.
 * JSON kinds (analysis, query plan, evidence, clarification, review) answer with one JSON
 * object; wire kinds (FsdOutline, FsdWrite, FsdRevise) answer in the FSD wire format.
 */
export function structuredPrompt({ kind, r, t, repair, part }) {
  // Evidence ids are 64-hex hashes the model miscopies; it sees short aliases. JSON answers
  // are mapped back before validation; the document itself keeps the aliases (EV-001), which
  // working.evidence lists.
  const aliases = (t.evidence ?? []).map((e, i) => [e.id, evidenceAlias(i)]);
  const toAlias = (s) => aliases.reduce((acc, [id, a]) => acc.split(id).join(a), s);
  const fromAlias = (s) =>
    aliases.reduce((acc, [id, a]) => acc.split('"' + a + '"').join('"' + id + '"'), s);
  const wire = WIRE_KINDS.has(kind);
  const document = part?.draft ?? r.state?.draft ?? t.document ?? null;
  const facts =
    '\n目标系统：' +
    (t.target?.sap_disabled
      ? // Asking each part to list its own open items made the model write 待核实 notes into
        // 依据, 括注 and the text of parts that have no 未决事项 (rejected, then rewritten).
        '本次未接入 SAP，无法查询系统。表、字段、状态值等系统结论一律按通用 SAP 知识写，依据标“推断”，不得声称已核实。编写“未决事项”时，把标“推断”的系统结论列为“待 SAP 核实”（阻断=否）；其他部分不写核实说明。'
      : JSON.stringify({ target_ref: t.target?.target_ref, product: t.target?.product ?? null })) +
    '\n可引用的证据编号（只能取自此列表，用户答复与通用知识不是证据）：' +
    JSON.stringify(aliases.map(([, a]) => a)) +
    '\nsnapshot.prior_answers（更早轮次）与 snapshot.answers（最近一轮，冲突时以它为准）都是客户已确认的答复，直接采用，不得就同一事项再次提问。客户答复在依据中写“客户：<question_id>”。';
  const inputs = {
    snapshot: { ...r.snapshot, base_evidence: undefined, base_document: undefined },
    evidence: t.evidence,
    analysis: r.state?.analysis ?? null,
  };
  let prompt;
  if (!wire) {
    prompt =
      r.assets.prompt_text +
      '\n本次输出类型：' +
      kind +
      '\nSchema：' +
      JSON.stringify(outputSchemas[kind]) +
      facts +
      '\nbasis=FACT 的结论必须至少引用一个上述证据编号；没有证据时，用户已确认的写 CUSTOMER_DECISION，其余写 INFERENCE。' +
      (t.target?.sap_disabled ? '\n不要返回 NEED_QUERY。' : '') +
      (kind === 'ReviewResult'
        ? '\n审查对象是下面的“当前文档”。每个问题的 rule_ref 填被审查对象的编号（如 LOG-APPROVE、OUT-STOCK、MSG-NO-DATA）；已经正确的内容不要报问题。'
        : '') +
      repairText(repair) +
      // DDIC evidence is filtered to the requested fields; read naively, every earlier read
      // looks incomplete and N05 keeps asking for queries until NO_PROGRESS.
      ((t.evidence ?? []).length
        ? '\n表字段证据只列出当次请求的字段和主键，未列出不代表不存在；同一对象有多条证据时合并看待，某字段只要在任一有效证据中出现即视为已核实，missing_properties 才表示确实不存在。所需字段都已核实时不要再 NEED_QUERY。'
        : '') +
      // Without the catalog the model guesses tool names/URLs and N03 fails with TOOL_DENIED.
      (kind === 'QueryPlan' && t.target
        ? '\n可用的只读工具（tool_name、arguments 键和 target_ref 必须完全一致）：' +
          JSON.stringify(toolCatalog(t.target))
        : '') +
      '\n冻结输入与受控资料：' +
      JSON.stringify({
        ...inputs,
        artifact_version: t.artifact_version,
        input_snapshot_id: r.input_snapshot_id,
        review_feedback: r.state?.review_open ?? [],
      }) +
      (document ? '\n当前文档（编写格式）：\n' + toFsdWire(document) : '');
  } else {
    prompt =
      r.assets.prompt_text +
      '\n\n# 本次任务\n' +
      wireTask(kind, part) +
      facts +
      repairText(repair) +
      '\n\n# 冻结输入与受控资料\n' +
      JSON.stringify(inputs) +
      (part?.outline?.length
        ? '\n\n# 提纲（可引用的编号）\n' +
          part.outline.map((o) => `${o.id}｜${o.type}｜${o.title}｜${o.summary ?? ''}`).join('\n')
        : '') +
      (document ? '\n\n# 当前文档（编写格式）\n' + toFsdWire(document) : '');
  }
  return { prompt: toAlias(prompt), fromAlias, wire };
}
export const evidenceAlias = (i) => 'EV-' + String(i + 1).padStart(3, '0');

function wireTask(kind, part) {
  if (kind === 'FsdOutline')
    return '输出提纲（第十部分第 3 节）：确定本功能的全部业务逻辑章节（按阅读顺序）和全部消息。只输出思路行和“## 提纲”表格，不写正文。';
  if (kind === 'FsdWrite') {
    const fix = part.problems?.length
      ? '\n这部分上次编写的内容没有通过检查，请重写这部分的全部内容并修正：\n' +
        part.problems
          .slice(0, 30)
          .map((p) => `- ${p.path ?? ''} ${p.message ?? p.keyword}`)
          .join('\n')
      : '';
    if (part.section)
      return (
        `只编写业务逻辑章节 ${part.section.id}，标题行必须是“## 逻辑 ${part.section.id} ${part.section.title}”。只写这一节，不写其他部分；引用其他章节或消息用提纲中的编号。` +
        fix
      );
    const labels = part.parts.map((p) => PART_LABELS[p] ?? p).join('、');
    return (
      `编写以下部分：${labels}。只写这些部分，不写其他部分；引用业务逻辑章节或消息用提纲中的编号。` +
      (part.parts.includes('messages')
        ? '消息须包含提纲中的全部消息编号，并覆盖“当前文档”各逻辑章节提到的每一种失败与提示场景。生命周期分析覆盖相关正向、逆向和部分处理环节；反向审查针对“当前文档”提出反例；未决事项列出所有推断待核实或待客户确认的内容。'
        : '') +
      fix
    );
  }
  if (part.reason === 'review')
    return (
      '按下面的审查意见修订“当前文档”（第十部分第 4 节）：只输出需要变化的内容，每条意见都必须在正文中落实。\n审查意见：' +
      JSON.stringify(part.issues)
    );
  if (part.reason === 'final')
    return '方案已经用户确认。现在编制正式 FSD：通读“当前文档”，按第九部分自检，补全遗漏、修正不一致；只输出需要变化的内容（第十部分第 4 节）。没有需要修改的内容时，只输出思路行。不得改变已确认的业务口径。';
  return '客户补充了新的输入（见 snapshot 中最新的需求文字与答复）。识别变化及影响范围，只修订受影响的内容（第十部分第 4 节）；不受影响的内容不要输出。没有需要修改的内容时，只输出思路行。';
}

export async function configuredModel({ kind, context, signal, repair, part }) {
  const { pool, r, t } = context;
  const model = r.assets.model;
  if (model.mode !== 'REAL' || !model.version_id) throw fault('MODEL_NOT_CONFIGURED', 'MODEL', 409);
  const row = (
    await pool.query(
      'SELECT v.config,c.id,c.secret_cipher FROM app.llm_model_version v JOIN app.llm_credential c ON c.id=v.credential_id AND c.organization_id=v.organization_id WHERE v.id=$1 AND v.organization_id=$2',
      [model.version_id, t.organization_id],
    )
  ).rows[0];
  if (!row) throw fault('COMPATIBILITY', 'MODEL', 409);
  if (hash(row.config) !== model.config_hash) throw fault('COMPATIBILITY', 'MODEL', 409);
  const { prompt, fromAlias, wire } = structuredPrompt({ kind, r, t, repair, part });
  // Only document outputs need the large budget; analysis-type outputs given 16k tokens
  // ramble past the call timeout (qwen3.8-max: ~11k tokens, 93-300 s for one AnalysisResult).
  const outputLimit = modelOutputLimit(kind, r.assets.budget);
  const c = row.config,
    common = {
      model: c.modelId,
      ...(Number.isFinite(c.temperature) ? { temperature: c.temperature } : {}),
      // QianWen thinking models spend the whole output budget on reasoning and return
      // empty content for structured calls (qwen3.8-max: 6000 reasoning tokens, >120 s).
      ...(c.protocol === 'openai_chat' && c.provider?.toLowerCase() === 'qianwen'
        ? { enable_thinking: false }
        : {}),
    };
  const payload =
    c.protocol === 'openai_responses'
      ? {
          ...common,
          store: false,
          input: prompt,
          max_output_tokens: outputLimit,
        }
      : {
          ...common,
          messages: [{ role: 'user', content: prompt }],
          ...(c.protocol === 'anthropic_messages'
            ? { max_tokens: outputLimit }
            : { max_completion_tokens: outputLimit }),
        };
  const response = await requestModel(
    c,
    openKey(row.secret_cipher, t.organization_id, row.id),
    payload,
    // The run budget's model_call_timeout (in signal) bounds the call, not the transport default.
    { signal, maxResponseBytes: 1048576, deadlineMs: null },
  );
  const checked = interpretResponse(c.protocol, response.status, response.data);
  if (checked.status !== 'passed')
    throw fault(response.status === 429 ? 'RATE_LIMIT' : 'MODEL_RESPONSE_ERROR', 'MODEL', 502);
  const d = response.data;
  if (
    (c.protocol === 'openai_chat' && d.choices?.[0]?.finish_reason !== 'stop') ||
    (c.protocol === 'openai_responses' && d.status !== 'completed') ||
    (c.protocol === 'anthropic_messages' && !['end_turn', 'stop_sequence'].includes(d.stop_reason))
  )
    throw fault('OUTPUT_TRUNCATED', 'MODEL');
  const text =
    c.protocol === 'openai_chat'
      ? d.choices[0].message.content
      : c.protocol === 'anthropic_messages'
        ? d.content
            .filter((p) => p.type === 'text')
            .map((p) => p.text)
            .join('\n')
        : d.output
            .filter((p) => p.type === 'message')
            .flatMap((p) => p.content ?? [])
            .filter((p) => p.type === 'output_text')
            .map((p) => p.text)
            .join('\n');
  const usage = d.usage;
  const total =
    usage?.total_tokens ??
    (Number.isFinite(usage?.input_tokens) && Number.isFinite(usage?.output_tokens)
      ? usage.input_tokens + usage.output_tokens
      : null);
  const known = total === null ? null : { total_tokens: total };
  // Some models wrap the answer in a markdown fence despite the instructions.
  const body = text.replace(/^\s*```(?:json|markdown|md)?\s*/i, '').replace(/\s*```\s*$/, '');
  if (wire) return { output: { text: body }, usage: known, cost: null };
  let output;
  try {
    output = JSON.parse(fromAlias(body));
  } catch {
    throw Object.assign(fault('INVALID_OUTPUT', 'OUTPUT_VALIDATION'), {
      usage: known,
      raw: body.slice(0, 3000),
    });
  }
  return { output, usage: known, cost: null };
}
