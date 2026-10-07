import { loadRules } from './ruleset.mjs';
import { renderPrompt, promptRecords } from './prompts.mjs';
import { draftInstructions, parseDraft, validateDraft, sha256 } from './specification.mjs';
import { failure } from '../auth.mjs';

const objectKey = (o) => [o.kind, o.name.toUpperCase()].join(':');
const protocolError = (message) =>
  Object.assign(failure(422, message), { code: 'OUTPUT_PROTOCOL' });

export function taskContext(context, task, input) {
  const scenario = context.manifest.scenario ?? {};
  const rules = loadRules({
    task,
    riceType: 'R',
    practices: [
      scenario.editable && 'editable_batch',
      scenario.objectFeedback && 'object_feedback',
    ].filter(Boolean),
  });
  const template =
    task === 'plan' ? 'plan-input' : task === 'review' ? 'review-input' : 'revision-input';
  const messages = [
    {
      role: 'system',
      content:
        rules.rules.map((r) => r.text).join('\n') +
        (task === 'revise' ? '\n' + draftInstructions() : ''),
    },
    { role: 'user', content: renderPrompt(template, { input: JSON.stringify(input) }) },
  ];
  const bytes = Buffer.byteLength(JSON.stringify(messages), 'utf8');
  if (bytes > (context.manifest.budgetBytes ?? 180000))
    throw failure(413, '设计子任务超出上下文预算，未截断发送。');
  return {
    background: context.background,
    messages,
    manifest: {
      ...context.manifest,
      task,
      bytes,
      rules: rules.rules.map(({ file, sha256 }) => ({ file, sha256, version: rules.version })),
      promptFiles: promptRecords([template, ...(task === 'revise' ? ['schema'] : [])]),
      runtimeInstructionsHash: sha256(
        messages.filter((m) => m.role === 'system').map((m) => m.content),
      ),
    },
  };
}

async function ask({ context, task, input, invoke, signal, record = async () => {} }) {
  signal?.throwIfAborted();
  const callContext = taskContext(context, task, input);
  let text = '';
  try {
    const generation = await invoke({
      context: callContext,
      onDelta: (delta) => {
        signal?.throwIfAborted();
        if (text.length + delta.length > 262144) throw protocolError('设计子任务输出过大。');
        text += delta;
      },
    });
    await record({ task, manifest: callContext.manifest, input, text, generation });
    return parseDraft(text);
  } catch (error) {
    await record({
      task,
      manifest: callContext.manifest,
      input,
      text,
      failure: { code: error.code ?? 'OUTPUT_PROTOCOL', message: error.message },
    });
    throw error;
  }
}

export async function createDesignPlan(options) {
  const { context } = options;
  const value = await ask({
    ...options,
    task: 'plan',
    input: {
      background: context.background,
      workflow: context.manifest.workflow,
      userMessages: context.messages.filter((m) => m.role === 'user'),
    },
  });
  if (
    !value ||
    !Array.isArray(value.tasks) ||
    !value.tasks.length ||
    value.tasks.length > 8 ||
    typeof value.scenario?.editable !== 'boolean' ||
    typeof value.scenario?.objectFeedback !== 'boolean'
  )
    throw protocolError('设计计划格式无效。');
  const seen = new Set();
  for (const t of value.tasks) {
    if (
      !/^[A-Za-z0-9_-]{1,40}$/.test(t.id) ||
      seen.has(t.id) ||
      typeof t.goal !== 'string' ||
      !t.goal.trim() ||
      typeof t.doneWhen !== 'string' ||
      !t.doneWhen.trim() ||
      !Array.isArray(t.dependsOn) ||
      t.dependsOn.some((id) => !seen.has(id)) ||
      !Array.isArray(t.entityIds) ||
      t.entityIds.some((id) => typeof id !== 'string') ||
      typeof t.needsEvidence !== 'boolean'
    )
      throw protocolError('设计计划依赖或完成标准无效。');
    seen.add(t.id);
  }
  return value;
}

function reviewFindings(value) {
  if (!Array.isArray(value?.findings) || value.findings.length > 12)
    throw protocolError('质量审查格式无效。');
  const ids = new Set();
  for (const f of value.findings) {
    if (
      typeof f.id !== 'string' ||
      !f.id ||
      ids.has(f.id) ||
      !['critical', 'major', 'minor'].includes(f.severity) ||
      ['description', 'impact', 'recommendation'].some(
        (k) => typeof f[k] !== 'string' || !f[k].trim(),
      ) ||
      !Array.isArray(f.entityIds) ||
      f.entityIds.some((id) => typeof id !== 'string')
    )
      throw protocolError('质量审查缺陷定义无效。');
    ids.add(f.id);
  }
  return value.findings;
}

export async function refineDesign({
  spec,
  context,
  invoke,
  verify,
  signal,
  record = async () => {},
  maxRevisions = 2,
  onTrace = () => {},
}) {
  const cache = new Map();
  let queried = 0,
    revisionCalls = 0,
    findings = [],
    status = 'passed';
  const observation = async (candidate) => {
    const pending = [];
    for (const o of candidate.sapObjects)
      if (!cache.has(objectKey(o)) && !pending.some((p) => objectKey(p) === objectKey(o)))
        pending.push(o);
    if (pending.length) {
      const budgeted = pending.slice(0, Math.max(0, 12 - queried));
      if (budgeted.length) {
        const result = await verify(budgeted, queried);
        queried += budgeted.length;
        for (const o of result.objects)
          cache.set(objectKey(o), {
            object: o,
            evidence: result.evidence.filter((e) => o.evidenceIds?.includes(e.id)),
            raw: result.raw.filter((r) => r.objectId === o.id),
          });
      }
    }
    const objects = [],
      evidence = new Map(),
      raw = new Map();
    for (const o of candidate.sapObjects) {
      const hit = cache.get(objectKey(o));
      objects.push(
        hit
          ? {
              ...o,
              verificationStatus: hit.object.verificationStatus,
              verificationScope: hit.object.verificationScope,
              evidenceIds: [...(hit.object.evidenceIds ?? [])],
            }
          : {
              ...o,
              verificationStatus: 'unverified',
              verificationScope: '本次查询预算已用完，候选尚未核验',
              evidenceIds: [],
            },
      );
      for (const e of hit?.evidence ?? []) evidence.set(e.id, e);
      for (const r of hit?.raw ?? []) raw.set(r.id, r);
    }
    return { objects, evidence: [...evidence.values()], raw: [...raw.values()] };
  };
  const observedInput = (evidence) => ({
    ...evidence,
    raw: evidence.raw.map((r) => {
      const serialized = JSON.stringify(r.trace);
      return serialized?.length > 12000
        ? { ...r, trace: undefined, excerpt: serialized.slice(0, 12000), truncated: true }
        : r;
    }),
  });
  let evidence = await observation(spec);
  const revise = async () => {
    const candidate = await ask({
      context,
      task: 'revise',
      invoke,
      signal,
      record,
      input: {
        spec,
        observations: observedInput(evidence),
        findings,
        background: context.background,
        designPlan: context.manifest.designPlan,
        remainingObjectBudget: Math.max(0, 12 - queried),
      },
    });
    const validationStarted = performance.now();
    const validation = validateDraft(candidate, { sources: context.manifest.sources });
    onTrace('validation.completed', {
      stage: 'verify',
      task: 'revise',
      revision: revisionCalls + 1,
      durationMs: performance.now() - validationStarted,
      ...validation,
    });
    if (!validation.valid)
      throw Object.assign(failure(422, '证据修订候选未通过结构、来源或可信字段校验。'), {
        code: 'DRAFT_VALIDATION_FAILED',
        validation,
      });
    const changed = sha256(candidate) !== sha256(spec);
    spec = candidate;
    revisionCalls++;
    evidence = await observation(spec);
    return changed;
  };
  // An observation must be available to the designer before the independent review.
  await revise();
  while (true) {
    findings = reviewFindings(
      await ask({
        context,
        task: 'review',
        invoke,
        signal,
        record,
        input: {
          spec,
          observations: observedInput(evidence),
          background: context.background,
          designPlan: context.manifest.designPlan,
        },
      }),
    );
    if (!findings.some((f) => f.severity !== 'minor')) break;
    if (revisionCalls >= maxRevisions) {
      status = 'budget_exhausted';
      break;
    }
    if (!(await revise())) {
      status = 'no_progress';
      break;
    }
  }
  if (findings.some((f) => f.severity === 'critical')) status = 'blocked';
  return {
    spec,
    evidence,
    report: {
      status,
      findings,
      revisionCalls,
      objectsQueried: queried,
      unresolved: findings.length,
      maxRevisions,
      objectBudget: 12,
    },
  };
}
