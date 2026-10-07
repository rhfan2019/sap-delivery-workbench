import { renderPrompt } from '../abap-fsd-agent/prompts.mjs';
import { readFileSync } from 'node:fs';
import { registerAbapFsdAgentRoutes } from '../abap-fsd-agent/routes.mjs';
import { executor } from '../abap-fsd-agent/executor.mjs';
import { parseDraft } from '../abap-fsd-agent/specification.mjs';
import { failure } from '../auth.mjs';
import { modelDecision } from '../abap-fsd-agent/decisions.mjs';
import { classifyFailure } from '../abap-fsd-agent/errors.mjs';
import { transitionStep } from '../abap-fsd-agent/coordinator.mjs';
import { createHash } from 'node:crypto';
import {
  validDocument,
  renderDocument,
  schema,
} from '../../../../packages/contracts/item-workspace/document.mjs';
import { snapshot } from './service.mjs';
import { createWorkContext, workBase } from './routes.mjs';
import { prepareConversationContext, resolveWorkAction } from './conversations.mjs';

const developmentPrompt = readFileSync(
  new URL('../../../../packages/agents/item-development/v1/system.md', import.meta.url),
  'utf8',
);
function developmentExecutor({ action, context, persist, save, plan }) {
  return async ({ run, invoke, emit, signal }) => {
    let text = '';
    const step = async (id, status) => {
      const updated = transitionStep(plan, id, status);
      await persist(run.id, { plan }, 'running');
      if (status !== 'cancelled') signal.throwIfAborted();
      emit('step.updated', updated);
    };
    try {
      if (context.rendered) {
        for (const s of plan.steps) {
          await step(s.stepId, 'running');
          await step(s.stepId, 'succeeded');
        }
        await persist(
          run.id,
          { text: context.rendered.markdown, rendered: context.rendered, plan },
          'completed',
        );
        emit('message.delta', { text: context.rendered.markdown });
        return { rendered: true };
      }
      await step('understand', 'running');
      await step('understand', 'succeeded');
      await step('generate', 'running');
      let lastCheckpoint = 0;
      const result = await invoke({
        onProgress: async (progress) => {
          emit('generation.progress', progress);
          if (Date.now() - lastCheckpoint >= 5000) {
            lastCheckpoint = Date.now();
            await persist(run.id, { text, generationProgress: progress }, 'running');
          }
        },
        onDelta: (delta) => {
          text += delta;
          emit(action === 'draft' ? 'technical.delta' : 'message.delta', { text: delta });
        },
      });
      await persist(run.id, { generation: result }, 'running');
      if (['length', 'max_tokens'].includes(result?.finishReason))
        throw failure(422, '开发产物未完整生成，请重试。');
      signal.throwIfAborted();
      const decision = modelDecision(text, context.manifest.consultantDecisions);
      if (decision) {
        await step('generate', 'waiting_user');
        await persist(run.id, { decision, rawOutput: text, text: '', plan }, 'waiting_user');
        return { waitingUser: true, decision };
      }
      await step('generate', 'succeeded');
      if (action === 'draft') {
        await step('validate', 'running');
        const spec = parseDraft(text);
        if (!validDocument(spec, 'development'))
          throw failure(422, '开发产物不符合合同，未保存为候选。');
        await step('validate', 'succeeded');
        await step('save', 'running');
        const completedPlan = structuredClone(plan);
        transitionStep(completedPlan, 'save', 'succeeded', '开发内容已保存');
        const artifact = await save({
          runId: run.id,
          spec,
          evidence: {},
          manifest: context.manifest,
          signal,
          onCommitStart: () => {
            signal.throwIfAborted();
            run.commitStarted = true;
          },
          completionSnapshot: { text, plan: completedPlan },
        });
        transitionStep(plan, 'save', 'succeeded');
        emit(
          'step.updated',
          plan.steps.find((s) => s.stepId === 'save'),
        );
        emit('artifact.ready', artifact);
        return { artifactId: artifact.id };
      }
      await persist(run.id, { text, plan }, 'completed');
      return {};
    } catch (error) {
      run.commitStarted = false;
      for (const s of plan.steps) {
        if (s.status === 'running') await step(s.stepId, signal.aborted ? 'cancelled' : 'failed');
        else if (s.status === 'queued')
          emit('step.updated', transitionStep(plan, s.stepId, 'skipped', '前置步骤未完成'));
      }
      await persist(
        run.id,
        {
          text,
          plan,
          failure: {
            ...classifyFailure(error, plan.steps.find((s) => s.status === 'failed')?.stepId),
            diagnostics: error.diagnostics ?? null,
            attempts: error.attempts ?? [],
          },
        },
        signal.aborted ? 'cancelled' : 'failed',
      );
      throw error;
    }
  };
}
export function registerWorkAgent(app, pool, org, requireSession, generate, origin, agentConnect) {
  const c = createWorkContext(pool, org, requireSession);
  registerAbapFsdAgentRoutes(app, pool, org, requireSession, generate, origin, agentConnect, {
    prefix: workBase + '/agent',
    context: c,
    conversationContext: (db, req) => prepareConversationContext(db, req, c),
    resolveAction: (_req, prompt) => resolveWorkAction(prompt),
    riceType: (req) =>
      ({ report: 'R', interface: 'I', conversion: 'C', enhancement: 'E' })[req.work.item.kind] ??
      null,
    decoratePlan: (req, plan) => {
      if (req.params.stage !== 'development') return;
      plan.steps = plan.steps.filter((s) => s.stepId !== 'verify');
      const labels = {
        understand: '读取开发稿与设计依据',
        generate: '模型生成开发内容',
        validate: '校验开发合同',
        save: '本地脚本转换 Markdown 并保存开发候选',
      };
      plan.steps.forEach((s, i) => {
        s.label = labels[s.stepId];
        s.dependencies = i ? [plan.steps[i - 1].stepId] : [];
      });
    },
    loadWork: async (req) => {
      const s = await snapshot(
        pool,
        req.work.scope,
        req.params.stage,
        req.work.item,
        req.work.canEdit,
      );
      if (!s.head) throw failure(409, '请先启用并保存当前阶段草稿。');
      if (req.params.stage === 'development' && !s.designBasis)
        throw failure(409, '请先选择并保存一个明确的设计依据版本。');
      return {
        stage: s.stage,
        draftVersionId: s.head.id,
        draft: s.head.document,
        designVersionId: s.designBasis?.id ?? null,
        design: s.designBasis?.document ?? null,
        handoff: req.conversationContext ?? null,
      };
    },
    decorateContext: (req, context, work, action) => {
      if (req.params.stage === 'development') {
        context.messages[0].content =
          developmentPrompt +
          '\n' +
          (action === 'draft'
            ? renderPrompt('development-draft', { schema: JSON.stringify(schema.oneOf[1]) })
            : renderPrompt('development-dialogue')) +
          renderPrompt('context-background', { background: JSON.stringify(context.background) });
        context.manifest.task = 'development';
        context.manifest.rules = [
          {
            file: 'item-development/v1/system.md',
            version: '1.0.0',
            sha256: createHash('sha256').update(developmentPrompt).digest('hex'),
          },
        ];
        delete context.preflight;
      }
      const bytes = Buffer.byteLength(JSON.stringify(context.messages));
      if (bytes > 700000) throw failure(413, '阶段资料过大，请精简工作稿后重试，内容未被截断。');
      context.manifest.bytes = bytes;
    },
    executor: (req, args) =>
      req.params.stage === 'development' ? developmentExecutor(args) : executor(args),
    saveOptions: (req) =>
      req.params.stage === 'development' ? { render: renderDocument, decorate: false } : {},
  });
}
