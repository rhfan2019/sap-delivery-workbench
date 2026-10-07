import { typeDecision, modelDecision } from './decisions.mjs';
import { failure } from '../auth.mjs';
import { classifyFailure } from './errors.mjs';
import { transitionStep } from './coordinator.mjs';
import { parseDraft, validateDraft, draftInstructions, sha256 } from './specification.mjs';
import { verifyObjects } from './object-verification.mjs';
import { validateSpecContract } from '../../../../packages/contracts/abap-fsd-agent/fsd/v1/validate.mjs';
import { renderTechnicalOutput } from './feedback.mjs';
import { renderPrompt, withPromptMessages } from './prompts.mjs';
import { createDesignPlan, refineDesign } from './design-loop.mjs';
import { loadRules } from './ruleset.mjs';
function mergeIssue(spec, preferredId, issue) {
  const existing = spec.issues.find(
    (i) =>
      i.id === preferredId &&
      i.category === issue.category &&
      JSON.stringify([...(i.relatedIds ?? [])].sort()) ===
        JSON.stringify([...(issue.relatedIds ?? [])].sort()),
  );
  if (existing) {
    Object.assign(existing, issue, { id: preferredId });
    return preferredId;
  }
  const ids = new Set(
    [
      'sources',
      'requirements',
      'rules',
      'fields',
      'sapObjects',
      'evidence',
      'issues',
      'tests',
    ].flatMap((group) => (spec[group] ?? []).map((v) => v.id)),
  );
  let id = preferredId;
  while (ids.has(id)) id += '-1';
  spec.issues.push({ ...issue, id });
  return id;
}
export function executor({
  plan,
  action,
  persist,
  save,
  verify,
  profile,
  context,
  association,
  reviewArtifact,
}) {
  return async ({ run, invoke, emit, signal }) => {
    let text = '';
    const managed = action === 'draft' && !!context.manifest.workflow;
    const formal = managed && context.manifest.workflow.phase === 'refining';
    const calls = [];
    const traceVerify = (args) =>
      verifyObjects({ ...args, onTrace: (type, data) => run.recorder?.write(type, data) });
    const record = async (call) => {
      calls.push(call);
      await persist(run.id, { designCalls: calls }, 'running');
    };
    if (managed) {
      const generateIndex = plan.steps.findIndex((s) => s.stepId === 'generate');
      plan.steps.splice(generateIndex, 0, {
        stepId: 'design_plan',
        label: '规划业务设计任务',
        dependencies: ['understand'],
        status: 'queued',
        attempt: 0,
        startedAt: null,
        finishedAt: null,
        summary: '',
      });
      plan.steps.find((s) => s.stepId === 'generate').dependencies = ['design_plan'];
      if (formal) plan.steps.find((s) => s.stepId === 'verify').label = '核验、修订与质量审查';
    }
    const step = async (id, state, summary = '') => {
      const item = transitionStep(plan, id, state, summary);
      await persist(run.id, { plan, text, manifest: context.manifest }, 'running');
      signal.throwIfAborted();
      emit('step.updated', item);
      if (run.recorder?.error)
        throw Object.assign(new Error(run.recorder.error.message), run.recorder.error);
    };
    try {
      if (context.rendered) {
        for (const s of plan.steps) {
          await step(s.stepId, 'running');
          await step(s.stepId, 'succeeded', '已有内容确定性转换，不调用模型或SAP');
        }
        text = context.rendered.markdown;
        emit('message.delta', { text });
        await persist(run.id, { text, rendered: context.rendered, plan }, 'completed');
        return { rendered: true };
      }
      await step('understand', 'running');
      if (reviewArtifact) {
        await step('understand', 'succeeded', '已有说明书，进入版本审阅');
        await step('generate', 'running');
        text = `版本 ${reviewArtifact.revision} 已保存，当前阶段为顾问审阅。请打开已有说明书核对业务规则、字段及测试预期；如需修改，请说明具体章节和改动。“确认，请继续”仅表示继续交流，未签认整份规格，也未重新生成版本。`;
        emit('message.delta', { text });
        await step('generate', 'succeeded', '已有版本可继续审阅');
        await persist(run.id, { plan, text, reviewArtifactId: reviewArtifact.id }, 'completed');
        return { reviewArtifactId: reviewArtifact.id };
      }
      if (action === 'draft' && (!plan.type.supported || plan.type.riceType !== 'R')) {
        const decision = typeDecision(plan.type);
        await step('understand', 'waiting_user', decision.message);
        await persist(run.id, { plan, text, decision, manifest: context.manifest }, 'waiting_user');
        return { waitingUser: true, decision };
      }
      if (action === 'draft' && context.preflight) {
        plan.steps.find((s) => s.stepId === 'understand').label = '检查业务澄清返回格式';
        emit(
          'step.updated',
          plan.steps.find((s) => s.stepId === 'understand'),
        );
        let preflightText = '';
        try {
          const result = await invoke({
            context: context.preflight,
            onDelta: (delta) => {
              signal.throwIfAborted();
              preflightText += delta;
            },
          });
          await persist(
            run.id,
            {
              preflight: {
                text: preflightText,
                generation: result,
                manifest: context.preflight.manifest,
              },
            },
            'running',
          );
          const decision = modelDecision(preflightText, context.manifest.consultantDecisions);
          if (decision) {
            await step('understand', 'waiting_user', decision.message);
            await persist(run.id, { decision, rawOutput: preflightText, text: '' }, 'waiting_user');
            return { waitingUser: true, decision };
          }
          if (!['ready', 'clarification'].includes(parseDraft(preflightText)?.kind))
            throw Object.assign(failure(422, '需求检查返回了无效格式，尚未生成说明书。'), {
              code: 'OUTPUT_PROTOCOL',
            });
        } catch (error) {
          const classified = classifyFailure(error, preflightText ? 'understand' : 'generate');
          Object.assign(error, classified);
          text = preflightText;
          if (text) emit('technical.delta', { text });
          await persist(
            run.id,
            { preflightFailure: { text: preflightText, code: error.code ?? 'PREFLIGHT_FAILED' } },
            'running',
          );
          throw error;
        }
      }
      await step('understand', 'succeeded', plan.type.reason);
      if (managed) {
        await step('design_plan', 'running');
        const designPlan = await createDesignPlan({ context, invoke, signal, record });
        context.manifest.designPlan = designPlan;
        context.manifest.scenario = designPlan.scenario;
        context.background.scenario = designPlan.scenario;
        const practices = [
          designPlan.scenario.editable && 'editable_batch',
          designPlan.scenario.objectFeedback && 'object_feedback',
        ].filter(Boolean);
        const selected = loadRules({ task: 'draft', riceType: 'R', practices });
        // Rebuild the behavioral layer from Markdown; retain registered input as data.
        const current = selected.rules.map((r) => r.text).join('\n');
        context.messages[0] = {
          role: 'system',
          content:
            current +
            '\n' +
            draftInstructions() +
            '\n' +
            renderPrompt('context-background', {
              background: JSON.stringify({
                ...context.background,
                designPlan,
                workflow: context.manifest.workflow,
              }),
            }),
        };
        context.manifest.rules = selected.rules.map(({ file, sha256 }) => ({
          file,
          sha256,
          version: selected.version,
        }));
        context.manifest.bytes = Buffer.byteLength(JSON.stringify(context.messages), 'utf8');
        context.manifest.runtimeInstructionsHash = sha256(
          context.messages.filter((m) => m.role === 'system').map((m) => m.content),
        );
        if (context.manifest.bytes > (context.manifest.budgetBytes ?? 180000))
          throw failure(413, '规划后的起草上下文超出预算，未发送。');
        await step(
          'design_plan',
          'succeeded',
          `${designPlan.tasks.length}项设计任务，完成标准已记录`,
        );
      }
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
          signal.throwIfAborted();
          text += delta;
          emit(action === 'draft' ? 'technical.delta' : 'message.delta', { text: delta });
        },
      });
      await persist(run.id, { generation: result }, 'running');
      {
        const decision = modelDecision(text, context.manifest.consultantDecisions);
        if (decision) {
          await step('generate', 'waiting_user', decision.message);
          await persist(
            run.id,
            { plan, text: '', rawOutput: text, decision, manifest: context.manifest },
            'waiting_user',
          );
          return { waitingUser: true, decision };
        }
      }
      await step('generate', 'succeeded');
      if (action !== 'draft') {
        if (/^\s*(?:```json\s*)?\{/.test(text)) {
          try {
            const rendered = renderTechnicalOutput(text);
            await persist(run.id, { rendered, rawOutput: text }, 'running');
          } catch {
            /* Incomplete JSON stays in folded diagnostics, never a saved artifact. */
          }
        }
        await persist(run.id, { plan, text, manifest: context.manifest }, 'completed');
        return result;
      }
      await step('validate', 'running');
      const inspect = (output) => {
        const started = performance.now();
        try {
          const spec = parseDraft(output);
          const validation = validateDraft(spec, { sources: context.manifest.sources });
          run.recorder?.write('validation.completed', {
            durationMs: performance.now() - started,
            ...validation,
          });
          return { spec, validation };
        } catch {
          return {
            spec: null,
            validation: { valid: false, errors: [{ code: 'invalid_json' }], qualityIssues: [] },
          };
        }
      };
      let { spec, validation } = inspect(text);
      if (!validation.valid) {
        const repair = {
          attempt: 1,
          status: 'running',
          originalText: text,
          errors: validation.errors,
          startedAt: new Date().toISOString(),
        };
        await persist(run.id, { validation, repair }, 'running');
        const current = plan.steps.find((s) => s.stepId === 'validate');
        current.summary = '发现格式或引用问题，正在自动修正（1/1），无需重复填写';
        emit('step.updated', structuredClone(current));
        const repairContext = withPromptMessages(
          context,
          [
            ...context.messages,
            { role: 'assistant', content: text },
            {
              role: 'user',
              content: renderPrompt('repair', {
                errors: JSON.stringify(validation.errors).slice(0, 24000),
              }),
            },
          ],
          ['repair'],
        );
        text = '';
        emit('message.reset', {});
        try {
          const result = await invoke({
            context: repairContext,
            onDelta: (delta) => {
              signal.throwIfAborted();
              text += delta;
              emit('technical.delta', { text: delta });
            },
          });
          ({ spec, validation } = inspect(text));
          await persist(
            run.id,
            {
              text,
              validation,
              repair: {
                ...repair,
                manifest: repairContext.manifest,
                status: validation.valid ? 'succeeded' : 'failed',
                output: text,
                validation,
                generation: result,
                finishedAt: new Date().toISOString(),
              },
            },
            'running',
          );
        } catch (error) {
          await persist(
            run.id,
            {
              repair: {
                ...repair,
                status: 'failed',
                output: text,
                finishedAt: new Date().toISOString(),
                failureCode: error.code ?? 'GENERATION_FAILED',
              },
            },
            'running',
          );
          throw error;
        }
      }
      if (!validation.valid) {
        await persist(run.id, { plan, text, validation, manifest: context.manifest }, 'running');
        throw Object.assign(
          failure(
            422,
            '自动修正后仍未通过结构或引用校验，未保存说明书。原始输入和错误已记录，可按运行编号排查。',
          ),
          {
            code: validation.errors.some((e) => e.code === 'invalid_json')
              ? 'OUTPUT_PROTOCOL'
              : 'DRAFT_VALIDATION_FAILED',
          },
        );
      }
      for (let i = 0; i < validation.qualityIssues.length; i++) {
        const q = validation.qualityIssues[i];
        mergeIssue(spec, 'QA-' + String(i + 1).padStart(3, '0'), {
          category: 'test',
          description: q.code,
          impact: '需求或验收覆盖不充分',
          priority: 'medium',
          status: 'open',
          suggestion: '补充可核对的测试',
          owner: '当前SAP顾问',
          followUp: '顾问复核',
          relatedIds: q.id ? [q.id] : [],
          resolution: null,
        });
      }
      await step('validate', 'succeeded', 'Schema、唯一ID及引用检查通过');
      await step('verify', 'running');
      let evidence;
      if (formal) {
        const refined = await refineDesign({
          spec,
          context,
          invoke,
          signal,
          record,
          onTrace: (type, data) => run.recorder?.write(type, data),
          verify: (candidates, idOffset) =>
            traceVerify({ ...verify, candidates, signal, idOffset }),
        });
        spec = refined.spec;
        evidence = refined.evidence;
        await persist(run.id, { qualityReview: refined.report, candidate: spec }, 'running');
        if (refined.report.status === 'blocked')
          throw Object.assign(
            failure(422, '质量审查仍有关键缺陷，已保留候选与审查记录，尚未发布正式版。'),
            { code: 'QUALITY_BLOCKED' },
          );
        const knownIds = new Set(
          [
            ...spec.requirements,
            ...spec.rules,
            ...spec.fields,
            ...spec.sapObjects,
            ...spec.tests,
            ...spec.issues,
          ].map((x) => x.id),
        );
        for (const [i, finding] of refined.report.findings.entries()) {
          let id = 'REVIEW-' + (i + 1);
          while (knownIds.has(id)) id += '-1';
          knownIds.add(id);
          spec.issues.push({
            id,
            category: 'business',
            description: finding.description,
            impact: finding.impact,
            priority: finding.severity === 'minor' ? 'low' : 'high',
            status: 'open',
            suggestion: finding.recommendation,
            owner: '当前SAP顾问',
            followUp: '正式版审阅时处置',
            relatedIds: finding.entityIds.filter((id) => knownIds.has(id)),
            resolution: null,
          });
        }
      } else evidence = await traceVerify({ ...verify, candidates: spec.sapObjects, signal });
      spec.sapObjects = evidence.objects;
      spec.evidence = evidence.evidence;
      for (let i = 0; i < spec.sapObjects.length; i++) {
        const o = spec.sapObjects[i];
        const id = mergeIssue(spec, 'SAPGAP-' + String(i + 1).padStart(3, '0'), {
          category: 'sap_object',
          description: o.name + '：' + o.verificationScope,
          impact: '元数据不能证明业务适用性',
          priority: 'medium',
          status: 'open',
          suggestion: '结合实际业务样本复核用途、签名及事务限制',
          owner: '当前SAP顾问',
          followUp: '开发测试前补证',
          relatedIds: [o.id],
          resolution: null,
        });
        o.issueIds = [...new Set([...o.issueIds, id])];
      }
      spec.systemContext.selectionId = profile.systemId;
      spec.systemContext.discoveryStatus = profile.systemId
        ? profile.discoveryStatus
        : 'not_selected';
      spec.systemContext.identificationSource =
        profile.identificationSource === 'configuration'
          ? 'unknown'
          : profile.identificationSource === 'mcp+consultant'
            ? 'mcp'
            : profile.identificationSource;
      const missingProfile = ['product', 'productVersion', 'abapRelease', 'deployment'].some(
        (k) => !profile.profile[k],
      );
      const sysId = missingProfile
        ? mergeIssue(spec, 'SYS-900', {
            category: 'system',
            description: '系统部署模式及完整产品发行信息需复核',
            impact: '平台适用性仍有边界',
            priority: 'medium',
            status: 'open',
            suggestion: '依据CVERS及系统资料复核',
            owner: '当前SAP顾问',
            followUp: '平台核对',
            relatedIds: [],
            resolution: null,
          })
        : null;
      for (const [key, val] of [
        ['product', profile.profile.product],
        ['productVersion', profile.profile.productVersion],
        ['abapVersion', profile.profile.abapRelease],
        ['deployment', profile.profile.deployment],
      ])
        spec.systemContext[key] = val
          ? { status: 'proposed', value: val, issueIds: [] }
          : { status: 'open', value: null, issueIds: [sysId] };
      spec.systemContext.limitations = profile.reason ?? 'MCP组件画像；部署模式未推定';
      if (profile.identificationSource === 'mcp' && profile.evidence.length) {
        const e = profile.evidence[0];
        spec.evidence.push({
          id: 'EVD-900',
          channel: 'mcp',
          sourceReference: 'system-profile:CVERS',
          systemFingerprint: profile.systemId + ':' + verify.environment,
          capturedAt: e.retrievedAt,
          claim:
            'CVERS软件组件：' + e.components.map((c) => c.component + '=' + c.release).join(', '),
          limitations: '组件与部署模式不可等同；市场版本需版本映射复核',
        });
        spec.systemContext.evidenceIds = ['EVD-900'];
      }
      await step(
        'verify',
        'succeeded',
        `已处理${evidence.objects.length}对象；只读证据不表示业务测试通过`,
      );
      if (!validateSpecContract(spec).valid) throw failure(422, '核验合并后契约校验失败，未发布。');
      await step('save', 'running');
      signal.throwIfAborted();
      const completedPlan = structuredClone(plan);
      transitionStep(completedPlan, 'save', 'succeeded', '说明书已保存');
      const artifact = await save({
        runId: run.id,
        spec,
        evidence: { objects: evidence.raw, system: profile.evidence },
        manifest: { ...context.manifest, association },
        signal,
        onCommitStart: () => {
          signal.throwIfAborted();
          run.commitStarted = true;
        },
        completionSnapshot: { plan: completedPlan, text, manifest: context.manifest },
      });
      // Revision and terminal snapshot committed atomically; no post-commit DB wait.
      transitionStep(plan, 'save', 'succeeded', '已保存版本' + artifact.revision);
      emit(
        'step.updated',
        plan.steps.find((s) => s.stepId === 'save'),
      );
      emit('artifact.ready', artifact);
      return { artifactId: artifact.id };
    } catch (error) {
      run.commitStarted = false;
      const current = plan.steps.find((s) => s.status === 'running');
      const classified = classifyFailure(error, current?.stepId);
      Object.assign(error, classified);
      if (current) {
        transitionStep(
          plan,
          current.stepId,
          classified.code === 'CANCELLED' ? 'cancelled' : 'failed',
          classified.message,
        );
        emit('step.updated', current);
      }
      for (const s of plan.steps.filter((s) => s.status === 'queued')) {
        transitionStep(plan, s.stepId, 'skipped', '前置步骤未完成');
        emit('step.updated', s);
      }
      await persist(
        run.id,
        {
          plan,
          text,
          manifest: context.manifest,
          failure: {
            ...classified,
            finishReason: error.finishReason ?? null,
            outputLimit: error.outputLimit ?? null,
            attempts: error.attempts ?? [],
            diagnostics: error.diagnostics ?? null,
          },
          ...(error.validation ? { validation: error.validation } : {}),
        },
        classified.code === 'CANCELLED' ? 'cancelled' : 'failed',
      );
      throw error;
    }
  };
}
