import { StateGraph, Annotation, START, END, interrupt } from '@langchain/langgraph';
import { randomUUID } from 'node:crypto';
import { transaction } from '../../platform/auth.mjs';
import { guard, stepCommit, reserve, settle, event } from './repository.mjs';
import {
  fault,
  hash,
  withoutSupersededFields,
  dropUnknownReferences,
  normalizeClarification,
  normalizeReview,
  modelOutputLimit,
  WIRE_KINDS,
  validateOutput,
  validateTool,
  validateEvidence,
  safeError,
  MODEL_CONCURRENCY,
} from './policy.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import { executeChatNode } from './chat-node.mjs';
import { parseFsdWire } from '@sap-delivery-workbench/contracts/design-assistant/fsd-report-wire';
import {
  draftSkeleton,
  outlineProblems,
  pickParts,
  partProblems,
  WRITE_JOBS,
  jobForPath,
  dropDanglingReferences,
  stampVersion,
} from './document.mjs';
import {
  mergeFsdPatch,
  orderSections,
} from '@sap-delivery-workbench/contracts/design-assistant/fsd-report-patch';
import { validateFsdReport } from '@sap-delivery-workbench/contracts/design-assistant/fsd-report';

// Parallel FSD part writing; the provider's own rate limit still applies per call.
const WRITE_CONCURRENCY = MODEL_CONCURRENCY;

export function buildGraph(
  pool,
  lease,
  { checkpointer, model, streamModel, tool, telemetry, signal, onBoundary = async () => {} },
) {
  const checkEvidence = (e, target, required) =>
    validateEvidence(
      e,
      target,
      required,
      lease.state.processing_kind === 'FIXED_REPLAY'
        ? Date.parse(lease.state.replay_at)
        : Date.now(),
    );
  const tx = (fn) => transaction(pool, fn);
  const attrs = {
    task_id: lease.task_id,
    logical_run_id: lease.id,
    attempt_id: lease.attempt_id,
    thread_id: lease.thread_id,
  };
  // Output the model can correct on one more attempt: malformed JSON or references to evidence it was not given.
  const repairable = new Set(['INVALID_OUTPUT', 'UNKNOWN_REFERENCE', 'OUT_OF_SCOPE']);
  const current = () => tx((db) => guard(db, lease, { allowWaiting: true }));
  // part (FSD wire calls): { key, parts?, section?, outline?, draft?, reason?, issues?,
  // problems?, check? }; key separates the parallel calls of one node in the ledger.
  // A wire answer is returned as { text, parsed }; check(parsed) lists problems that make
  // the answer unusable, which get the same one repair as a malformed answer.
  async function call(kind, state, part = null) {
    const { t, r } = await current();
    const phase = state.cycle ?? 0;
    const wire = WIRE_KINDS.has(kind);
    const projected = {
      ...t,
      evidence: withoutSupersededFields(
        t.evidence.filter((e) => checkEvidence(e, t.target, e.required_properties).valid),
      ),
    };
    const accept = (output) => {
      const parsed = parseFsdWire(output.text);
      return {
        text: output.text,
        parsed,
        problems: [...parsed.errors, ...(part?.check?.(parsed) ?? [])],
      };
    };
    let repairReason = null;
    for (let repair = 0; repair <= r.assets.budget.format_repairs; repair++) {
      const op = hash(
        part?.key
          ? [r.id, kind, state.round, phase, repair, part.key]
          : [r.id, kind, state.round, phase, repair],
      );
      const existing = (await pool.query('SELECT * FROM app.fsd_v1_operation WHERE id=$1', [op]))
        .rows[0];
      if (existing?.status === 'SETTLED') return wire ? accept(existing.result) : existing.result;
      if (existing && existing.status !== 'SETTLED') {
        if (repairable.has(existing.error?.code) && repair < r.assets.budget.format_repairs) {
          repairReason = { code: existing.error.code, details: [] };
          continue;
        }
        throw fault(
          repairable.has(existing.error?.code) ? existing.error.code : 'OUTCOME_UNKNOWN',
          'MODEL',
        );
      }
      // Characters, not tokens: mixed Chinese/JSON prompts measured ~2 characters per token,
      // and settlement replaces the reservation with the reported usage.
      const estimated = Math.ceil(
        (JSON.stringify(r.snapshot).length +
          JSON.stringify(projected.evidence).length +
          JSON.stringify(part?.draft ?? r.state.draft ?? t.document ?? {}).length +
          r.assets.prompt_text.length +
          3000) /
          2,
      );
      await waitForSlot(() =>
        tx((db) =>
          reserve(db, lease, op, 'model', estimated + modelOutputLimit(kind, r.assets.budget)),
        ),
      );
      await telemetry.span(
        'prompt.construct',
        { ...attrs, operation_id: op, prompt_hash: r.assets.prompt_hash },
        () =>
          tx((db) =>
            event(db, t.id, r.id, 'context.manifest', {
              operation_id: op,
              input_snapshot_id: r.input_snapshot_id,
              prompt_hash: r.assets.prompt_hash,
              evidence_refs: projected.evidence.map((e) => e.id),
              artifact_version: t.artifact_version,
              input_estimate: estimated,
              excluded_reason:
                projected.evidence.length < t.evidence.length ? 'INVALID_EVIDENCE' : 'none',
              coverage: 'selected snapshot',
              ...(part?.key ? { part: part.key } : {}),
            }),
          ),
      );
      let result;
      try {
        const combined = AbortSignal.any([
          signal,
          AbortSignal.timeout(r.assets.budget.model_call_timeout),
        ]);
        result = await telemetry.span('model.attempt', { ...attrs, operation_id: op }, () =>
          bounded(
            () =>
              model({
                kind,
                context: { t: projected, r, pool },
                signal: combined,
                repair: repair ? repairReason : null,
                part,
              }),
            combined,
          ),
        );
        let value;
        if (wire) {
          if (typeof result.output?.text !== 'string')
            throw Object.assign(fault('INVALID_OUTPUT', 'OUTPUT_VALIDATION'), {
              usage: result.usage,
            });
          value = accept(result.output);
          // The last attempt is kept with its problems listed: the document check after the
          // merge decides what is still unusable, instead of discarding the whole part here.
          if (value.problems.length && repair < r.assets.budget.format_repairs)
            throw Object.assign(fault('INVALID_OUTPUT', 'OUTPUT_VALIDATION', 422, value.problems), {
              usage: result.usage,
            });
          // Remaining problems, and structure the parser repaired itself, stay inspectable.
          if (value.problems.length || value.parsed.warnings.length)
            await tx((db) =>
              event(db, t.id, r.id, 'output.problems', {
                operation_id: op,
                kind,
                part: part?.key ?? null,
                problems: value.problems.slice(0, 20),
                normalized: value.parsed.warnings.slice(0, 20),
              }),
            );
        } else {
          result.output = normalizeReview(normalizeClarification(result.output));
          result.output = dropUnknownReferences(
            result.output,
            projected.evidence.map((e) => e.id),
          );
          // The snapshot id and base version are echoes of this prompt, which the server just
          // built; smaller models miscopy the UUID, so restore them instead of failing STALE_INPUT.
          if (result.output && typeof result.output === 'object') {
            Object.assign(result.output, {
              input_snapshot_id: r.input_snapshot_id,
              base_artifact_version: t.artifact_version ?? null,
            });
            // reason_code is a short audit code; models write a sentence. Cut it, don't repair.
            if (typeof result.output.reason_code === 'string')
              result.output.reason_code = result.output.reason_code.slice(0, 160);
          }
          await telemetry.span('output.validate', attrs, async () =>
            validateOutput(result.output, {
              expectedKind: kind,
              snapshotId: r.input_snapshot_id,
              artifactVersion: t.artifact_version,
              evidenceIds: projected.evidence.map((e) => e.id),
            }),
          );
          value = result.output;
        }
        await tx((db) => settle(db, lease, op, result.output, null, result.usage));
        await onBoundary('after_operation_result_before_checkpoint', {
          run_id: r.id,
          operation_id: op,
        });
        return value;
      } catch (e) {
        const error = safeError({
          code:
            e.name === 'TimeoutError'
              ? 'TIMEOUT'
              : (e.code ?? (signal.aborted ? 'CANCELLED' : 'UNKNOWN')),
          error_origin: e.error_origin ?? 'MODEL',
        });
        // A rejected but completed answer still reports usage; settle it so the
        // reservation (a pessimistic estimate) does not exhaust the budget for the repair.
        await tx((db) => settle(db, lease, op, null, error, result?.usage ?? e.usage)).catch(
          () => {},
        );
        // A rejected answer stays inspectable: what failed, and the start of what came back.
        if (repairable.has(e.code))
          await tx((db) =>
            event(db, t.id, r.id, 'output.rejected', {
              operation_id: op,
              kind,
              part: part?.key ?? null,
              code: e.code,
              details: (e.details ?? []).slice(0, 20),
              excerpt: String(e.raw ?? (result?.output ? JSON.stringify(result.output) : '')).slice(
                0,
                3000,
              ),
            }),
          ).catch(() => {});
        if (!repairable.has(e.code) || repair === r.assets.budget.format_repairs)
          throw fault(error.code, error.error_origin);
        repairReason = { code: e.code, details: e.details ?? [] };
      }
    }
  }
  // RATE_LIMIT from reserve means every model slot is busy (MODEL_CONCURRENCY); wait for one
  // within the call timeout instead of failing the run.
  async function waitForSlot(action) {
    const deadline = Date.now() + 300000;
    for (;;) {
      try {
        return await action();
      } catch (e) {
        if (e.code !== 'RATE_LIMIT' || Date.now() > deadline) throw e;
        await delay(200, undefined, { signal });
      }
    }
  }
  async function commit(step, proposal, apply) {
    const result = await telemetry.span('business.commit', { ...attrs, step_id: step }, () =>
      tx((db) => stepCommit(db, lease, step, proposal, apply)),
    );
    await onBoundary('after_business_commit_before_checkpoint', {
      run_id: lease.id,
      step_id: step,
    });
    return result;
  }
  function node(name, fn) {
    return async (s) =>
      telemetry.span('graph.node.' + name, { ...attrs, node_id: name }, async () => {
        signal.throwIfAborted();
        await tx(async (db) => {
          const { t, r } = await guard(db, lease, { allowWaiting: true });
          r.state.budget.steps++;
          if (
            r.state.budget.tokens > r.assets.budget.run_total_tokens ||
            t.budget.tokens > r.assets.budget.task_total_tokens
          )
            throw fault('BUDGET_EXHAUSTED', 'MODEL');
          if (r.state.budget.steps > r.assets.budget.max_graph_steps_per_run)
            throw fault('BUDGET_EXHAUSTED', 'BUSINESS_COMMIT');
          await db.query('UPDATE app.fsd_v1_run SET state=$2 WHERE id=$1', [r.id, r.state]);
          await event(db, t.id, r.id, 'node.started', {
            node_id: name,
            attempt_id: lease.attempt_id,
          });
        });
        const result = await fn(s);
        await tx((db) =>
          event(db, lease.task_id, lease.id, 'node.completed', {
            node_id: name,
            route: result.route ?? null,
          }),
        );
        return result;
      });
  }
  const state = Annotation.Root({
    run_id: Annotation(),
    round: Annotation(),
    cycle: Annotation(),
    route: Annotation(),
    proposal_ref: Annotation(),
    query_ref: Annotation(),
    wait_ref: Annotation(),
  });
  const g = new StateGraph(state);
  g.addNode(
    'N01',
    node('N01', async () =>
      // A retried final generation (chat-service FSD_RETRY) starts at the FSD round: the plan
      // is already approved, so analysis and plan proposal are not repeated.
      lease.state.fsd_round
        ? { route: 'N07', cycle: 1, round: 0 }
        : { route: lease.snapshot.chat_action === 'dialogue' ? 'CHAT' : 'N02' },
    ),
  );
  g.addNode(
    'N02',
    node('N02', async (s) => {
      await commit('N02:phase', {}, (t) => {
        t.phase = 2;
        return { phase: 2 };
      });
      const out = await call('AnalysisResult', s);
      // The writing calls get the analysis as context (claims with their basis, gaps).
      await commit('N02:analysis', { goal: out.goal }, (_t, run) => {
        run.state.analysis = {
          goal: out.goal,
          scope: out.scope,
          standard_fit: out.standard_fit,
          claims: out.claims,
          gaps: out.gaps,
          unresolved_issues: out.unresolved_issues,
        };
        return { claims: out.claims.length };
      });
      const { r, t } = await current();
      const direction =
        out.scope !== 'report' ? out.scope : out.standard_fit === 'SATISFIES' ? 'standard' : null;
      const accepted = r.snapshot.scope_direction;
      if (direction && accepted?.direction !== direction) {
        await commit('N02:direction', { direction }, (_t, run) => {
          run.state.scope_direction = direction;
          return { direction };
        });
        return { route: 'N06' };
      }
      // Without SAP nothing can be queried: the gaps become open items of the proposal.
      if (out.decision === 'NEED_QUERY' && t.target.sap_disabled) return { route: 'N07' };
      return {
        route: out.decision === 'NEED_QUERY' ? 'N03' : out.decision === 'PROPOSE' ? 'N07' : 'N06',
      };
    }),
  );
  g.addNode(
    'N03',
    node('N03', async (s) => {
      const { t, r } = await current();
      if (s.round >= r.assets.budget.query_rounds) throw fault('NO_PROGRESS', 'SAP_ADAPTER');
      const plan = await call('QueryPlan', s);
      plan.items.forEach((i) => validateTool(i, t.target));
      const signature = hash(
        plan.items
          .map((i) => [
            t.target.target_ref,
            i.tool_name,
            i.arguments,
            [...i.required_properties].sort(),
          ])
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      );
      const ref = hash([r.id, 'query', s.round]);
      await commit('N03:' + s.round, plan, (task, run) => {
        if ((run.state.query_signatures ?? []).includes(signature))
          throw fault('NO_PROGRESS', 'SAP_ADAPTER');
        task.phase = 3;
        run.state.query_signatures = [...(run.state.query_signatures ?? []), signature];
        run.state.query_plan = plan;
        return { query_ref: ref };
      });
      return { query_ref: ref, route: 'N04' };
    }),
  );
  g.addNode(
    'N04',
    node('N04', async (s) => {
      const { t, r } = await current();
      const results = [];
      const unique = new Map(
        (r.state.query_plan?.items ?? []).map((i) => [
          hash([t.target, i.tool_name, i.arguments, i.required_properties]),
          i,
        ]),
      );
      for (const [key, item] of unique) {
        let final;
        for (let attempt = 0; attempt <= r.assets.budget.tool_retries; attempt++) {
          const op = hash([r.id, key, s.round, attempt]);
          const existing = (
            await pool.query('SELECT * FROM app.fsd_v1_operation WHERE id=$1', [op])
          ).rows[0];
          if (existing?.status === 'SETTLED') {
            final = existing.result;
            break;
          }
          if (existing) continue; // UNKNOWN is never refunded; next attempt gets a new generation.
          await tx((db) => reserve(db, lease, op, 'tool'));
          try {
            const read_generation = op;
            const combined = AbortSignal.any([
              signal,
              AbortSignal.timeout(r.assets.budget.tool_call_timeout),
            ]);
            const result = await telemetry.span(
              'tool.attempt',
              {
                ...attrs,
                operation_id: op,
                read_generation,
                attempt_no: attempt,
                retry_reason: final?.error ?? 'FIRST_ATTEMPT',
              },
              () =>
                bounded(
                  () =>
                    tool(item, {
                      target: t.target,
                      read_generation,
                      signal: combined,
                      attempt,
                      onPage: async (page, read) => {
                        const pageOp = hash([op, page.offset]);
                        await tx((db) => reserve(db, lease, pageOp, 'tool'));
                        return telemetry.span(
                          'result.page',
                          { ...attrs, operation_id: pageOp, read_generation },
                          async () => {
                            try {
                              const value = await bounded(read, combined);
                              await tx((db) =>
                                settle(db, lease, pageOp, {
                                  parent_operation_id: op,
                                  offset: page.offset,
                                  read_generation,
                                  result_hash: hash(value),
                                  remote_outcome: 'SUCCEEDED',
                                }),
                              );
                              return value;
                            } catch (e) {
                              await tx((db) =>
                                settle(db, lease, pageOp, null, {
                                  code: e.name === 'TimeoutError' ? 'TIMEOUT' : safeError(e).code,
                                  error_origin: 'SAP_ADAPTER',
                                  remote_outcome: 'UNKNOWN',
                                }),
                              );
                              throw e;
                            }
                          },
                        );
                      },
                    }),
                  combined,
                ),
            );
            const valid = checkEvidence(result, t.target, item.required_properties);
            final = {
              ...result,
              id: 'e-' + op,
              required_properties: item.required_properties,
              gap_id: key,
              validity: valid.valid ? 'VALID' : 'PENDING_REVIEW',
              limitations: valid.reasons,
            };
            await tx((db) => settle(db, lease, op, final));
            break;
          } catch (e) {
            const code = e.name === 'TimeoutError' ? 'TIMEOUT' : safeError(e).code;
            await tx((db) =>
              settle(db, lease, op, null, {
                code,
                error_origin: e.error_origin ?? 'SAP_ADAPTER',
                remote_outcome: 'UNKNOWN',
                read_progress: e.read_progress,
              }),
            );
            final = {
              status: 'FAILED',
              remote_outcome: 'UNKNOWN',
              gap_id: item.gap_id,
              error: code,
            };
            if (
              ![
                'TIMEOUT',
                'OUTCOME_UNKNOWN',
                'CONNECTION_ERROR',
                'RATE_LIMIT',
                'BUSY',
                'PARTIAL_RESULT',
                'RESULT_EXPIRED',
              ].includes(code)
            )
              break;
            if (attempt < r.assets.budget.tool_retries) {
              const wait = Math.min(
                1000,
                Math.max(20, Number(e.retry_after_ms) || 100 * (attempt + 1)),
              );
              await tx((db) =>
                event(db, t.id, r.id, 'tool.retry', {
                  operation_id: op,
                  error_code: code,
                  error_origin: 'SAP_ADAPTER',
                  remote_outcome: 'UNKNOWN',
                  retry_after_ms: wait,
                }),
              );
              await delay(wait, undefined, { signal });
            }
          }
        }
        results.push(final ?? { status: 'FAILED', error: 'OUTCOME_UNKNOWN' });
      }
      await commit('N04:' + s.round, results, (task, run) => {
        const evidence = results.filter((x) => x.status === 'SUCCESS' || x.status === 'PARTIAL');
        task.evidence = Array.from(
          new Map([...task.evidence, ...evidence].map((e) => [e.gap_id, e])).values(),
        );
        run.state.query_results = results;
        return { count: results.length };
      });
      return { route: 'N05' };
    }),
  );
  g.addNode(
    'N05',
    node('N05', async (s) => {
      const out = await call('EvidenceAssessment', s);
      const { t, r } = await current();
      // Evidence from earlier runs ages out after 15 minutes (e.g. while the customer answers
      // questions); it is simply not used, it must not force another clarification round.
      const sufficient =
        t.evidence.some((e) => checkEvidence(e, t.target, e.required_properties).valid) &&
        r.state.query_results?.every((x) => x.status === 'SUCCESS');
      if (!sufficient) return { route: 'N06' };
      // Real models keep finding one more field to read; after the last query round the
      // remaining gaps go into the proposal as unresolved issues instead of NO_PROGRESS.
      const lastRound = s.round + 1 >= r.assets.budget.query_rounds;
      return {
        route:
          out.decision === 'NEED_QUERY'
            ? lastRound
              ? 'N07'
              : 'N03'
            : out.decision === 'PROPOSE'
              ? 'N07'
              : 'N06',
        round: out.decision === 'NEED_QUERY' ? s.round + 1 : s.round,
      };
    }),
  );
  g.addNode(
    'N06',
    node('N06', async (s) => {
      const { r } = await current();
      const direction = r.state.scope_direction;
      const option = (id, label, impact, recommended = false, other = false) => ({
        id,
        label,
        impact,
        recommended,
        other,
        requires_material: false,
      });
      const batch = direction
        ? {
            return_phase: 2,
            questions: [
              {
                id: 'scope-direction',
                question: '请确认本次设计的范围与处理方向。',
                background:
                  direction === 'standard'
                    ? '模型提出标准功能可能满足需求；这只是待核实候选，不代表已验证 SAP 标准功能。'
                    : direction === 'mixed'
                      ? '需求包含报表之外的操作，需要限定本次只读报表设计范围。'
                      : direction === 'as_is'
                        ? '本次按现状梳理，保留现有行为，改进建议需单独标识。'
                        : '当前需求超出报表范围，继续前需要限定为报表设计。',
                recommendation_reason: '先明确范围，避免强迫自开发或扩展到写操作。',
                options: [
                  option(
                    'continue',
                    direction === 'standard'
                      ? '继续核实标准功能与差距'
                      : direction === 'as_is'
                        ? '仅梳理现状'
                        : '仅继续报表部分',
                    '保持只读 FSD 范围，未核实内容仍作为证据缺口。',
                    true,
                  ),
                  option('end', '结束本次设计', '保留历史与审计，不生成成果。'),
                  option('other', '其他', '补充方向后重新澄清。', false, true),
                ],
              },
            ],
          }
        : await call('ClarificationBatch', s);
      const wait = await commit('N06:' + s.round, batch, (t) => {
        const wait = {
          id: randomUUID(),
          status: 'OPEN',
          kind: 'CLARIFICATION',
          questions: batch.questions,
          return_phase: batch.return_phase,
          scope_direction: direction ?? null,
        };
        t.wait = wait;
        t.status = 'WAITING';
        t.wait_reason = 'CLARIFICATION';
        // Keep earlier rounds visible to later runs; ids may repeat across batches.
        t.answered = [...(t.answered ?? []), ...Object.values(t.answers ?? {})];
        t.answers = {};
        return wait;
      });
      return { wait_ref: wait.id, route: 'N10' };
    }),
  );
  // N07 writes or revises the FSD document (fsd-report/1) in the wire format.
  // First write: one outline call fixes every logic section and message id, then the
  // fixed parts and each logic section are written in parallel against that outline, and
  // the messages/analysis tables last (they cover what the sections say). A revision (review
  // findings, new customer input, the final FSD round) answers only what changes.
  // The merged draft must pass the content model; failing parts get one targeted fix call,
  // references still pointing nowhere are removed and listed as an open item.
  g.addNode(
    'N07',
    node('N07', async (s) => {
      const { r, t } = await current();
      const open = r.state.review_open ?? [];
      // A committed draft is the task document now; only an open draft is built upon.
      const base = (!r.state.draft_committed && r.state.draft) || t.document || null;
      let draft, outline, changed;
      if (!base) {
        outline = (await call('FsdOutline', s, { key: 'outline', check: outlineProblems })).parsed
          .outline;
        const jobs = [
          ...WRITE_JOBS.filter((j) => j.key !== 'tail'),
          ...outline
            .filter((o) => o.type === '逻辑')
            .map((o) => ({
              key: 'section:' + o.id,
              parts: ['section:' + o.id],
              section: { id: o.id, title: o.title },
            })),
        ];
        const written = await parallel(
          jobs.map(
            (job) => () => call('FsdWrite', s, { ...job, outline, check: partProblems(job) }),
          ),
          WRITE_CONCURRENCY,
        );
        draft = draftSkeleton(
          t,
          withoutSupersededFields(
            t.evidence.filter((e) => checkEvidence(e, t.target, e.required_properties).valid),
          ),
        );
        written.forEach((w, i) => {
          draft = mergeFsdPatch(draft, pickParts(w.parsed.doc, jobs[i].parts)).doc;
        });
        draft = orderSections(draft, outline);
        const tail = WRITE_JOBS.find((j) => j.key === 'tail');
        const last = await call('FsdWrite', s, { ...tail, outline, draft });
        draft = mergeFsdPatch(draft, pickParts(last.parsed.doc, tail.parts)).doc;
        changed = ['*'];
      } else {
        outline = r.state.outline ?? null;
        const reason = open.length ? 'review' : s.cycle === 1 ? 'final' : 'input';
        const answer = await call('FsdRevise', s, {
          key: 'revise:' + reason,
          reason,
          issues: open,
          draft: base,
        });
        ({ doc: draft, changed } = mergeFsdPatch(base, answer.parsed.doc, answer.parsed.deletions));
      }
      // Content-model check; each failing part is rewritten once with its problems listed.
      let check = validateFsdReport(draft);
      const failing = new Map();
      for (const e of check.ok ? [] : check.errors) {
        const job = jobForPath(e.path, draft);
        if (!job) throw fault('INVALID_OUTPUT', 'OUTPUT_VALIDATION', 422, [e]);
        failing.set(job.key, { job, problems: [...(failing.get(job.key)?.problems ?? []), e] });
      }
      for (const { job, problems } of failing.values()) {
        const fixed = await call('FsdWrite', s, {
          ...job,
          key: job.key + ':fix',
          outline,
          draft,
          problems,
        });
        const merged = mergeFsdPatch(draft, pickParts(fixed.parsed.doc, job.parts));
        draft = merged.doc;
        changed = [...new Set([...changed, ...merged.changed])];
      }
      ({ doc: draft } = dropDanglingReferences(draft));
      check = validateFsdReport(draft);
      if (!check.ok) {
        await tx((db) =>
          event(db, lease.task_id, lease.id, 'document.invalid', {
            errors: check.errors.slice(0, 40),
          }),
        );
        throw fault('INVALID_OUTPUT', 'OUTPUT_VALIDATION', 422, check.errors);
      }
      const ref = hash(draft);
      await commit('N07:' + s.round + ':' + (s.cycle ?? 0), { draft_hash: ref }, (_t, run) => {
        run.state.draft = draft;
        run.state.draft_committed = false;
        run.state.proposal_ref = ref;
        run.state.outline = outline;
        run.state.last_changed = changed;
        return { proposal_ref: ref, changed: changed.length };
      });
      await onBoundary('after_proposal_persist_before_commit', { run_id: r.id });
      return { proposal_ref: ref, route: 'N08' };
    }),
  );
  g.addNode(
    'N08',
    node('N08', async (s) => {
      const review = await call('ReviewResult', s);
      const { r } = await current();
      const open = review.issues.filter((i) => i.status === 'OPEN');
      // After the last repair round the remaining review findings go to the human gate as
      // unresolved issues; a self-review that never fully converges must not discard the work.
      const exhausted = open.length > 0 && s.round >= r.assets.budget.review_repairs;
      if (open.length && !exhausted) {
        await commit('N08:review:' + s.round + ':' + (s.cycle ?? 0), review, (_t, run) => {
          run.state.review_open = open;
          return { count: open.length };
        });
        return { round: s.round + 1, route: 'N07' };
      }
      const draft = r.state.draft;
      if (!draft) throw fault('UNKNOWN_REFERENCE', 'BUSINESS_COMMIT');
      // A revision answering review findings must actually change the document (09 FLOW-06).
      if (!exhausted && r.state.review_open?.length && !r.state.last_changed?.length)
        throw fault('REVIEW_NOT_APPLIED', 'OUTPUT_VALIDATION');
      await commit(
        'N08:' + s.round + ':' + (s.cycle ?? 0),
        { draft_hash: hash(draft) },
        (task, run) => {
          // Evidence from earlier runs expires while the customer answers questions; only the
          // current valid reads back this commit.
          const valid = task.evidence.filter(
            (e) => checkEvidence(e, task.target, e.required_properties).valid,
          );
          if (!valid.length && !task.target.sap_disabled)
            throw fault('STALE_EVIDENCE', 'RETRIEVAL');
          const version = (task.artifact_version ?? 0) + 1;
          const kind = s.cycle === 1 ? 'FSD' : 'PLAN';
          const document = stampVersion(draft, version, kind);
          if (!validateFsdReport(document).ok)
            throw fault('INCOMPLETE_ARTIFACT', 'OUTPUT_VALIDATION');
          const issues = [
            ...(document.working?.open_issues ?? [])
              .filter((i) => i.status === 'OPEN')
              .map((i) => ({
                id: i.id,
                description: i.title + (i.impact ? '：' + i.impact : ''),
                blocking: i.blocking,
                evidence_refs: [],
              })),
            ...(exhausted ? open : []).map((i) => ({
              id: i.issue_id,
              description: '审查未闭环：' + i.counterexample + ' 建议：' + i.suggestion,
              blocking: false,
              evidence_refs: i.evidence_refs,
            })),
          ];
          const artifact = {
            id: randomUUID(),
            version,
            workspace_version_id: lease.snapshot.workspace_version_id ?? null,
            kind,
            // The FSD rests on the approved plan; a retried FSD round runs under a new input
            // snapshot, so the plan is found by its approval, not by snapshot id.
            plan_artifact_id:
              kind === 'FSD'
                ? task.artifacts
                    .filter(
                      (a) =>
                        a.kind === 'PLAN' &&
                        task.confirmations.some(
                          (c) =>
                            c.kind === 'PLAN_CONFIRM' &&
                            c.artifact_id === a.id &&
                            c.artifact_version === a.version,
                        ),
                    )
                    .at(-1)?.id
                : null,
            scope: task.scope,
            document,
            evidence_refs: valid.map((e) => e.id),
            issues,
            created_at: new Date().toISOString(),
            input_snapshot_id: task.input_snapshot_id,
          };
          task.document = document;
          task.artifacts.push(artifact);
          task.artifact_version = version;
          task.current_artifact_id = artifact.id;
          task.blocking_issues = issues.filter((i) => i.blocking);
          task.phase = task.phase >= 5 ? 6 : 4;
          // The final draft exists now; the chat layer's "plan approved, final pending" flag ends.
          if (kind === 'FSD' && task.chat) task.chat.draftApproved = false;
          // The draft stays: a crash before the checkpoint re-enters N08, which needs it.
          run.state.draft_committed = true;
          run.state.review_open = [];
          run.state.last_changed = [];
          return { artifact_id: artifact.id, version };
        },
      );
      return { route: 'N09' };
    }),
  );
  g.addNode(
    'N09',
    node('N09', async () => {
      const { t } = await current();
      const artifact = t.artifacts.at(-1);
      if (!artifact) throw fault('INCOMPLETE_ARTIFACT');
      const kind = artifact.kind === 'FSD' ? 'FSD_CONFIRM' : 'PLAN_CONFIRM';
      const confirmed = t.confirmations.find(
        (c) =>
          c.kind === kind &&
          c.artifact_id === artifact.id &&
          c.artifact_version === artifact.version,
      );
      if (confirmed) {
        if (kind === 'FSD_CONFIRM') return { route: 'N11' };
        await commit('N09:plan-confirmed', { decision_id: confirmed.id }, (task) => {
          task.phase = 5;
          task.wait_reason = null;
          task.status = 'ACTIVE';
          return { phase: 5 };
        });
        return { round: 0, cycle: 1, route: 'N07' };
      }
      const wait = await commit('N09:wait:' + artifact.id, { artifact_id: artifact.id }, (task) => {
        const wait = {
          id: randomUUID(),
          status: 'OPEN',
          kind,
          artifact_id: artifact.id,
          artifact_version: artifact.version,
          scope: task.scope,
        };
        task.wait = wait;
        task.status = 'WAITING';
        task.wait_reason = kind;
        return wait;
      });
      return { wait_ref: wait.id, route: 'N10' };
    }),
  );
  g.addNode(
    'N10',
    node('N10', async (s) => {
      const { t } = await current();
      if (t.wait?.id === s.wait_ref && t.wait.status === 'RESOLVED') return { route: 'N09' };
      interrupt({ wait_ref: s.wait_ref });
      return { route: 'N09' };
    }),
  );
  g.addNode(
    'N11',
    node('N11', async () => {
      await commit('N11', {}, (t) => {
        const a = t.artifacts.at(-1);
        const plan = t.artifacts.find((p) => p.id === a.plan_artifact_id);
        // No-SAP mode has no evidence by construction; the FSD carries that as open items.
        const evidenceMissing =
          !t.target.sap_disabled &&
          (!t.evidence.length ||
            !a.evidence_refs.length ||
            a.evidence_refs.some((id) => !t.evidence.some((e) => e.id === id)) ||
            t.evidence.some((e) => !checkEvidence(e, t.target, e.required_properties).valid));
        if (
          t.blocking_issues.length ||
          evidenceMissing ||
          !plan ||
          !t.confirmations.some(
            (c) =>
              c.kind === 'PLAN_CONFIRM' &&
              c.artifact_id === plan.id &&
              c.artifact_version === plan.version &&
              hash(c.scope) === hash(a.scope),
          ) ||
          !t.confirmations.some(
            (c) =>
              c.kind === 'FSD_CONFIRM' &&
              c.artifact_id === a.id &&
              c.artifact_version === a.version &&
              hash(c.scope) === hash(a.scope),
          )
        )
          throw fault('DELIVERY_BLOCKED');
        if (t.publication_disabled) throw fault('REPLAY_PUBLICATION_DENIED');
        if (t.mode === 'REAL' && process.env.FSD_REAL_DELIVERY_APPROVED !== 'true')
          throw fault('BUSINESS_GATE_UNCONFIRMED');
        t.status = 'DELIVERED';
        t.phase = 7;
        t.wait_reason = null;
        t.delivered_artifact_id = a.id;
        return { artifact_id: a.id, version: a.version };
      });
      return { route: END };
    }),
  );
  g.addNode(
    'CHAT',
    node('CHAT', async () => {
      await executeChatNode(pool, lease, { streamModel, signal, telemetry, onBoundary });
      return { route: END };
    }),
  );
  g.addEdge('CHAT', END);
  g.addEdge(START, 'N01');
  for (let i = 1; i <= 11; i++) {
    const name = 'N' + String(i).padStart(2, '0');
    g.addConditionalEdges(name, (s) => s.route);
  }
  return g.compile({ checkpointer });
}
// Runs tasks with at most limit in flight; results keep the task order.
async function parallel(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, async () => {
      while (next < tasks.length) {
        const k = next++;
        results[k] = await tasks[k]();
      }
    }),
  );
  return results;
}
async function bounded(action, signal) {
  signal.throwIfAborted();
  let rejectAbort;
  const aborted = new Promise((_, reject) => {
    rejectAbort = () => reject(signal.reason);
    signal.addEventListener('abort', rejectAbort, { once: true });
  });
  try {
    return await Promise.race([action(), aborted]);
  } finally {
    signal.removeEventListener('abort', rejectAbort);
  }
}
