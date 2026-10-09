import { requestModel, interpretResponse, openKey } from '../models/public.mjs';
import { fault, hash, toolCatalog, modelOutputLimit } from './policy.mjs';
import { outputSchemas } from '@sap-delivery-workbench/contracts/design-assistant/protocol';
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
const answeredCount = (snapshot) =>
  Object.keys(snapshot.answers ?? {}).length + (snapshot.prior_answers?.length ?? 0);
// The structured prompt for one model call; exported so its content can be tested.
export function structuredPrompt({ kind, r, t, repair, part }) {
  // Evidence ids are 64-hex hashes the model miscopies; it sees short aliases instead,
  // mapped back before validation.
  const aliases = (t.evidence ?? []).map((e, i) => [e.id, 'EV-' + String(i + 1).padStart(3, '0')]);
  const toAlias = (s) => aliases.reduce((acc, [id, a]) => acc.split(id).join(a), s);
  const fromAlias = (s) =>
    aliases.reduce((acc, [id, a]) => acc.split('"' + a + '"').join('"' + id + '"'), s);
  const prompt = toAlias(
    r.assets.prompt_text +
      '\n本次输出类型：' +
      kind +
      '\nSchema：' +
      JSON.stringify(outputSchemas[kind]) +
      // Validation rejects any other id; the model otherwise invents refs like "chat:user:…".
      '\n可引用的证据编号（所有 evidence_refs/evidence_ref 只能取自此列表；为空时一律填空数组，用户答复与通用知识不是证据）：' +
      JSON.stringify((t.evidence ?? []).map((e) => e.id)) +
      '\nbasis=FACT 的结论必须至少引用一个上述证据编号；没有证据时，用户已确认的写 CUSTOMER_DECISION，其余写 INFERENCE。' +
      // FSD_SAP_MODE=off: the target cannot be read at all, so asking for queries is pointless.
      (t.target?.sap_disabled
        ? '\n本次未接入 SAP，无法查询系统：不要返回 NEED_QUERY；表、字段、状态值等系统结论一律按通用 SAP 知识写为 INFERENCE，并在 unresolved_issues 中列为“待 SAP 核实”（blocking=false）。'
        : '') +
      '\nsnapshot.prior_answers（更早轮次）与 snapshot.answers（最近一轮，冲突时以它为准）都是客户已确认的答复，直接采用，不得就同一事项再次提问。' +
      // Real models otherwise keep refining the same topics round after round.
      (answeredCount(r.snapshot) >= 6
        ? '\n客户已回答 ' +
          answeredCount(r.snapshot) +
          ' 个问题。除非缺少会使方案无法成立的信息，应直接 PROPOSE，把次要细节作为非阻塞 unresolved_issues 并在方案中写明默认处理，不要继续细化追问。'
        : '') +
      (repair === 'UNKNOWN_REFERENCE'
        ? '\n上次输出引用了列表外的证据编号，或把无证据的结论标成了 FACT，已被拒绝；请按上述规则重新输出。'
        : repair === 'INVALID_OUTPUT'
          ? '\n上次输出不是符合 Schema 的 JSON，已被拒绝；请严格按 Schema 重新输出。'
          : repair === 'OUT_OF_SCOPE'
            ? '\n上次输出的 object_id 不在允许范围或未列入 allowed_scope，已被拒绝；请按下述编号规则重新输出。'
            : '') +
      // The model otherwise reads allowed_scope as a topic ("report") and invents id prefixes.
      (kind === 'ChangeProposal'
        ? '\nobject_id 只能是 section-1 至 section-8、objects 中已有编号，或新增的 scenario-*/rule-*/field-*（后缀仅英文、数字、-、_）；allowed_scope 必须逐一列出 changes 中出现的全部 object_id。' +
          '\ndependencies 只能引用：对象编号、上述证据编号、客户答复 answer:<题号>（题号取自 snapshot.answers / prior_answers 的 question_id）、需求原文 requirement；推断内容不写依赖。' +
          (part?.review
            ? '\n以下已保存对象所依赖的内容在本轮已修订：' +
              part.review.join('、') +
              '。请逐一复核并输出这些对象的修订版本（op=REVISE；内容无需变化时原样输出，dependencies 保留原依赖），只输出这些对象。'
            : '') +
          (part?.dangling
            ? '\n上一稿中本组章节引用了不存在的对象：' +
              part.dangling.join('、') +
              '。请在本组章节中新增这些对象（若属于本组），或改为引用 candidate / objects 中已有的编号，并输出本组修订后的完整内容。'
            : '') +
          (part
            ? '\n已存在可引用的对象编号：' +
              JSON.stringify([
                ...new Set([
                  ...Object.keys(t.objects ?? {}),
                  ...(part.draft?.changes ?? []).map((c) => c.object_id),
                ]),
              ]) +
              '\n本次只编写第 ' +
              part.group.sections.join('、') +
              ' 章：changes 的 section 只能取这些值，每章至少一条变更；decision 为 PROPOSE，证据或口径不足写入 unresolved_issues，不得返回空 changes。candidate 是本轮已编写的其他章节，只用于保持术语、编号和引用一致，不要重复输出。'
            : '') +
          (Object.keys(t.objects ?? {}).length
            ? ''
            : '\n尚无已保存对象：新对象一律 op=ADD、base_version=0。') +
          '\n现有对象编号：' +
          JSON.stringify(Object.keys(t.objects ?? {}))
        : '\n本类输出须精简：只填 Schema 要求的字段，不得添加 Schema 之外的键；每条说明不超过两句，总输出控制在 3000 字以内。') +
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
        // base_evidence/base_objects are frozen copies of evidence and objects; evidence may
        // include expired reads, and objects below are the same content (sending both doubled
        // every FSD-round prompt to ~30k tokens).
        snapshot: { ...r.snapshot, base_evidence: undefined, base_objects: undefined },
        evidence: t.evidence,
        objects: t.objects,
        candidate: part ? part.draft : (r.state.proposal ?? null),
        review_feedback: r.state.review_open ?? [],
        artifact_version: t.artifact_version,
        input_snapshot_id: r.input_snapshot_id,
        repair: repair ?? null,
      }),
  );
  return { prompt, fromAlias };
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
  const { prompt, fromAlias } = structuredPrompt({ kind, r, t, repair, part });
  // Only the FSD proposal needs the large budget; analysis-type outputs given 16k tokens
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
    { signal, maxResponseBytes: 262144 },
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
  let output;
  try {
    // Some models wrap the JSON in a markdown fence despite the instructions.
    output = JSON.parse(
      fromAlias(text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')),
    );
  } catch {
    throw Object.assign(fault('INVALID_OUTPUT', 'OUTPUT_VALIDATION'), { usage: known });
  }
  return { output, usage: known, cost: null };
}
