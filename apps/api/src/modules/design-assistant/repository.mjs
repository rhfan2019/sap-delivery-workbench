import { randomUUID } from 'node:crypto';
import {
  fault,
  hash,
  canonical,
  validateAnswer,
  assertConfirmation,
  validateBudget,
  safeError,
  DEFAULT_BUDGET,
  MODEL_CONCURRENCY,
} from './policy.mjs';
import { currentTrace } from './telemetry.mjs';

// All mutating functions take a transaction client. Callers own BEGIN/COMMIT.
export async function event(db, taskId, runId, type, data = {}, actorId = null, dispatch = false) {
  if (data.error_code || data.error_origin) {
    const error = safeError({ code: data.error_code, error_origin: data.error_origin });
    data = { ...data, error_code: error.code, error_origin: error.error_origin };
  }
  const id = randomUUID();
  await db.query(
    'INSERT INTO app.fsd_v1_event(id,task_id,run_id,actor_id,event_type,data,dispatch_status) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [
      id,
      taskId,
      runId,
      actorId,
      type,
      { ...data, trace_context: currentTrace() },
      dispatch ? 'PENDING' : 'RECORDED',
    ],
  );
  return id;
}
export async function loadTask(db, scope, id, lock = false) {
  const row = (
    await db.query(
      `SELECT * FROM app.fsd_v1_task WHERE id=$1 AND organization_id=$2 AND project_id=$3 AND item_id=$4${lock ? ' FOR UPDATE' : ''}`,
      [id, scope.organizationId, scope.projectId, scope.itemId],
    )
  ).rows[0];
  if (!row) throw fault('NOT_FOUND', 'INPUT', 404);
  if (row.state.chat && row.actor_id !== scope.actorId) throw fault('NOT_FOUND', 'INPUT', 404);
  return {
    ...row.state,
    id: row.id,
    revision: row.revision,
    organization_id: row.organization_id,
    project_id: row.project_id,
    item_id: row.item_id,
    actor_id: row.actor_id,
  };
}
export async function saveTask(db, t) {
  const { id, revision, organization_id, project_id, item_id, actor_id, ...state } = t;
  await db.query(
    'UPDATE app.fsd_v1_task SET state=$2,revision=$3,updated_at=clock_timestamp() WHERE id=$1',
    [id, state, revision],
  );
}
export async function dedupe(db, scope, input, operation) {
  if (!/^[0-9a-f-]{36}$/i.test(input.request_id ?? '')) throw fault('INVALID_REQUEST_ID');
  const digest = hash({ project_id: scope.projectId, item_id: scope.itemId, input });
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    scope.organizationId + scope.actorId + input.request_id,
  ]);
  const old = (
    await db.query(
      'SELECT * FROM app.fsd_v1_request WHERE organization_id=$1 AND actor_id=$2 AND request_id=$3',
      [scope.organizationId, scope.actorId, input.request_id],
    )
  ).rows[0];
  if (old) {
    if (old.payload_hash !== digest) throw fault('IDEMPOTENCY_CONFLICT', 'INPUT', 409);
    return old.result;
  }
  const result = await operation();
  await db.query('INSERT INTO app.fsd_v1_request VALUES($1,$2,$3,$4,$5)', [
    scope.organizationId,
    scope.actorId,
    input.request_id,
    digest,
    result,
  ]);
  return result;
}
export async function newRun(db, t, assets, processingKind = 'INITIAL', replayOf = null) {
  const id = randomUUID(),
    thread = randomUUID(),
    snapshotId = randomUUID();
  const snapshot = {
    ...structuredClone(t.input),
    input_version: t.input_version,
    artifact_version: t.artifact_version,
    base_document: structuredClone(t.document ?? null),
    base_evidence: structuredClone(t.evidence),
    answers: structuredClone(t.answers),
    prior_answers: structuredClone(t.answered ?? []),
    attachment_ids: [...(t.attachment_ids ?? [])],
    target: t.target,
    scope: t.scope,
    scope_direction: structuredClone(t.scope_direction ?? null),
  };
  const materials = (
    await db.query(
      'SELECT id,content_hash,extraction FROM app.fsd_v1_attachment WHERE task_id=$1 AND id=ANY($2::uuid[]) ORDER BY id',
      [t.id, snapshot.attachment_ids],
    )
  ).rows;
  snapshot.materials = materials.map((a) => ({
    id: a.id,
    content_hash: a.content_hash,
    extraction: a.extraction,
  }));
  await db.query(
    "INSERT INTO app.fsd_v1_run(id,task_id,thread_id,input_snapshot_id,snapshot,assets,status,expected_revision,state) VALUES($1,$2,$3,$4,$5,$6,'QUEUED',$7,$8)",
    [
      id,
      t.id,
      thread,
      snapshotId,
      snapshot,
      assets,
      t.revision,
      {
        processing_kind: processingKind,
        replay_of_run_id: replayOf,
        budget: { model_calls: 0, tool_calls: 0, tokens: 0, active_ms: 0, steps: 0 },
        commit_status: 'NOT_COMMITTED',
      },
    ],
  );
  t.active_run_id = id;
  t.input_snapshot_id = snapshotId;
  t.status = 'ACTIVE';
  t.wait_reason = null;
  await event(
    db,
    t.id,
    id,
    'run.queued',
    { thread_id: thread, input_snapshot_id: snapshotId, asset_manifest_id: hash(assets) },
    t.actor_id,
    true,
  );
  return id;
}
export async function createTask(db, scope, input, assets) {
  return dedupe(db, scope, input, async () => {
    if (
      typeof input.text !== 'string' ||
      !input.text.trim() ||
      input.text.length > 100000 ||
      !input.target?.target_ref ||
      !['SYNTHETIC', 'REAL'].includes(input.mode)
    )
      throw fault('INVALID_INPUT');
    validateBudget(assets.budget);
    const id = randomUUID();
    const t = {
      id,
      organization_id: scope.organizationId,
      project_id: scope.projectId,
      item_id: scope.itemId,
      actor_id: scope.actorId,
      revision: 0,
      schema_version: 1,
      status: 'ACTIVE',
      phase: 1,
      mode: input.mode,
      target: input.target,
      scope: ['report'],
      input: { text: input.text.trim() },
      input_version: 1,
      artifact_version: null,
      artifacts: [],
      // The FSD content (fsd-report/1); cover comes from the development item.
      document: null,
      cover: {
        doc_id: scope.itemCode ?? null,
        title: scope.itemName ?? null,
        project: scope.projectName ?? null,
      },
      confirmations: [],
      answers: {},
      sessions: [{ id: randomUUID(), created_at: new Date().toISOString() }],
      messages: [],
      attachment_ids: [],
      blocking_issues: [],
      evidence: [],
      budget: { model_calls: 0, tool_calls: 0, tokens: 0, active_ms: 0 },
      assets,
    };
    await db.query(
      'INSERT INTO app.fsd_v1_task(id,organization_id,project_id,item_id,actor_id,state) VALUES($1,$2,$3,$4,$5,$6)',
      [id, scope.organizationId, scope.projectId, scope.itemId, scope.actorId, t],
    );
    await newRun(db, t, assets);
    await saveTask(db, t);
    return t;
  });
}
export async function command(db, scope, taskId, input) {
  return dedupe(db, scope, { ...input, task_id: taskId }, async () => {
    const t = await loadTask(db, scope, taskId, true);
    if (input.revision !== t.revision) throw fault('VERSION_CONFLICT', 'BUSINESS_COMMIT', 409);
    const r = (
      await db.query('SELECT * FROM app.fsd_v1_run WHERE id=$1 FOR UPDATE', [t.active_run_id])
    ).rows[0];
    if (r.status === 'RUNNING') await chargeActive(db, t, r);
    const before = { status: t.status, phase: t.phase, revision: t.revision };
    if (input.command === 'answer') {
      if (!['WAITING', 'PAUSED'].includes(t.status) || t.wait_reason !== 'CLARIFICATION')
        throw fault('INVALID_TRANSITION');
      const q = t.wait?.questions?.find((q) => q.id === input.question_id);
      if (!q) throw fault('INVALID_ANSWER');
      const attachments = (
        await db.query('SELECT id,extraction FROM app.fsd_v1_attachment WHERE task_id=$1', [t.id])
      ).rows.map((a) => ({ id: a.id, state: a.extraction.state }));
      t.answers[q.id] = validateAnswer(q, input, attachments);
      t.answer_version = (t.answer_version ?? 0) + 1;
    } else if (input.command === 'complete_batch') {
      if (
        t.status !== 'WAITING' ||
        t.wait_reason !== 'CLARIFICATION' ||
        !t.wait.questions.every((q) => t.answers[q.id])
      )
        throw fault('INVALID_TRANSITION');
      if (t.wait.scope_direction && t.answers['scope-direction']?.option_id === 'end') {
        t.status = 'ENDED';
        t.wait.status = 'RESOLVED';
        t.wait_reason = null;
        await db.query(
          "UPDATE app.fsd_v1_run SET status='CANCELLED',generation=generation+1,lease_until=NULL WHERE id=$1",
          [r.id],
        );
      } else {
        if (t.wait.scope_direction && t.answers['scope-direction']?.option_id === 'continue')
          t.scope_direction = {
            direction: t.wait.scope_direction,
            answer: structuredClone(t.answers['scope-direction']),
            actor_id: scope.actorId,
          };
        await db.query(
          "UPDATE app.fsd_v1_run SET status='COMPLETED',generation=generation+1,lease_until=NULL,state=state || $2::jsonb WHERE id=$1",
          [r.id, { completion_reason: 'SUPERSEDED_BY_INPUT' }],
        );
        t.input_version++;
        t.revision++;
        const oldId = r.id;
        await newRun(db, t, t.assets, 'ANSWERS');
        t.wait.status = 'RESOLVED';
        await db.query('UPDATE app.fsd_v1_run SET state=state || $2::jsonb WHERE id=$1', [
          oldId,
          { successor_run_id: t.active_run_id },
        ]);
      }
    } else if (input.command === 'confirm') {
      if (t.status !== 'WAITING' || !['PLAN_CONFIRM', 'FSD_CONFIRM'].includes(t.wait_reason))
        throw fault('INVALID_TRANSITION');
      assertConfirmation(t.wait, input);
      const decision = {
        id: randomUUID(),
        wait_event_id: t.wait.id,
        kind: t.wait_reason,
        artifact_id: input.artifact_id,
        artifact_version: input.artifact_version,
        scope: input.scope,
        actor_id: scope.actorId,
        at: new Date().toISOString(),
      };
      t.confirmations.push(decision);
      t.wait.status = 'RESOLVED';
      t.wait.decision_id = decision.id;
      t.status = 'ACTIVE';
      await db.query(
        "UPDATE app.fsd_v1_run SET status='QUEUED',generation=generation+1,lease_until=NULL,state=state || $2::jsonb WHERE id=$1",
        [r.id, { resume_decision: decision.id }],
      );
      await event(
        db,
        t.id,
        r.id,
        'decision.recorded',
        {
          decision_id: decision.id,
          wait_event_id: t.wait.id,
          artifact_id: input.artifact_id,
          artifact_version: input.artifact_version,
        },
        scope.actorId,
        true,
      );
    } else if (['pause', 'withdraw', 'cancel', 'end', 'reset'].includes(input.command)) {
      t.status = ['end', 'reset'].includes(input.command) ? 'ENDED' : 'PAUSED';
      t.pause_reason =
        input.command === 'withdraw' ? 'PREMISE_WITHDRAWN' : input.command.toUpperCase();
      await db.query(
        "UPDATE app.fsd_v1_run SET status=$2,generation=generation+1,lease_until=NULL WHERE id=$1 AND status NOT IN ('COMPLETED','CANCELLED')",
        [r.id, ['cancel', 'end', 'reset'].includes(input.command) ? 'CANCELLED' : 'WAITING'],
      );
      if (input.command === 'reset')
        t.reset_context = { session_id: randomUUID(), at: new Date().toISOString() };
    } else if (input.command === 'reopen_budget') {
      if (t.status !== 'WAITING' || t.wait_reason !== 'BUDGET' || r.status !== 'WAITING')
        throw fault('INVALID_TRANSITION');
      if (
        ![input.reason, input.condition].every(
          (v) => typeof v === 'string' && v.trim() && v.length <= 2000,
        ) ||
        !input.increments ||
        typeof input.increments !== 'object' ||
        Array.isArray(input.increments) ||
        !Object.keys(input.increments).length
      )
        throw fault('INVALID_BUDGET_AUTHORIZATION');
      const limits = { ...r.assets.budget, ...t.budget_limits, ...r.state.budget_limits };
      const allowed = new Set([
        'run_model_calls',
        'run_tool_calls',
        'run_total_tokens',
        'run_active_time',
        'max_graph_steps_per_run',
        'task_model_calls',
        'task_tool_calls',
        'task_total_tokens',
        'task_active_time',
      ]);
      for (const [key, increment] of Object.entries(input.increments)) {
        if (
          !allowed.has(key) ||
          !Number.isSafeInteger(increment) ||
          increment <= 0 ||
          limits[key] + increment > DEFAULT_BUDGET[key]
        )
          throw fault('INVALID_BUDGET');
        limits[key] += increment;
      }
      const authorization = {
        id: randomUUID(),
        actor_id: scope.actorId,
        at: new Date().toISOString(),
        reason: input.reason.trim(),
        condition: input.condition.trim(),
        increments: input.increments,
        prior_usage: structuredClone(t.budget),
        run_id: r.id,
      };
      t.budget_authorizations = [...(t.budget_authorizations ?? []), authorization];
      t.budget_limits = Object.fromEntries(
        Object.entries(limits).filter(([key]) => key.startsWith('task_')),
      );
      r.state.budget_limits = Object.fromEntries(
        Object.entries(limits).filter(([key]) => !key.startsWith('task_')),
      );
      r.state.budget_authorization_id = authorization.id;
      t.status = 'ACTIVE';
      t.wait_reason = null;
      await db.query(
        "UPDATE app.fsd_v1_run SET state=$2,status='QUEUED',generation=generation+1,lease_until=NULL WHERE id=$1",
        [r.id, r.state],
      );
      await event(
        db,
        t.id,
        r.id,
        'budget.authorized',
        {
          authorization_id: authorization.id,
          increments: input.increments,
          prior_usage: authorization.prior_usage,
        },
        scope.actorId,
        true,
      );
    } else if (input.command === 'resume' || input.command === 'recover') {
      if (
        ['CANCELLED', 'COMPLETED'].includes(r.status) ||
        t.status === 'ENDED' ||
        (input.command === 'recover' && t.status === 'PAUSED')
      )
        throw fault('INVALID_TRANSITION');
      if (
        t.wait?.status === 'OPEN' &&
        ['CLARIFICATION', 'PLAN_CONFIRM', 'FSD_CONFIRM'].includes(t.wait_reason)
      )
        t.status = 'WAITING';
      else {
        t.status = 'ACTIVE';
        await db.query(
          "UPDATE app.fsd_v1_run SET status='QUEUED',generation=generation+1,lease_until=NULL WHERE id=$1",
          [r.id],
        );
        await event(db, t.id, r.id, 'recovery.requested', {}, scope.actorId, true);
      }
    } else if (input.command === 'new_session') {
      t.sessions.push({ id: randomUUID(), created_at: new Date().toISOString() });
    } else if (input.command === 'supplement' || input.command === 'change_scope') {
      if (
        typeof input.text !== 'string' ||
        !input.text.trim() ||
        input.text.length > 100000 ||
        t.status === 'ENDED'
      )
        throw fault('INVALID_INPUT');
      t.messages.push({
        id: randomUUID(),
        session_id: t.sessions.at(-1).id,
        text: input.text,
        at: new Date().toISOString(),
      });
      // Free-text changes can alter scope; an earlier direction is not a blanket authorization.
      t.scope_direction = null;
      if (t.wait?.scope_direction && t.wait.status === 'OPEN') delete t.answers['scope-direction'];
      if (t.wait_reason === 'CLARIFICATION' && t.wait?.status === 'OPEN')
        t.input.pending = (t.input.pending ?? []).concat(input.text);
      else {
        await db.query(
          "UPDATE app.fsd_v1_run SET status='COMPLETED',generation=generation+1,lease_until=NULL,state=state || $2::jsonb WHERE id=$1",
          [r.id, { completion_reason: 'SUPERSEDED_BY_INPUT', commit_status: 'STALE' }],
        );
        t.input = {
          ...t.input,
          supplements: [...(t.input.supplements ?? []), { text: input.text, kind: input.command }],
          previous_snapshot_id: t.input_snapshot_id,
        };
        t.input_version++;
        t.revision++;
        t.phase = 2;
        t.wait = null;
        await newRun(db, t, t.assets, 'CHANGE');
        await db.query('UPDATE app.fsd_v1_run SET state=state || $2::jsonb WHERE id=$1', [
          r.id,
          { successor_run_id: t.active_run_id },
        ]);
      }
    } else throw fault('INVALID_TRANSITION');
    if (t.revision === before.revision) t.revision++;
    await db.query('UPDATE app.fsd_v1_run SET expected_revision=$2 WHERE id=$1', [
      t.active_run_id,
      t.revision,
    ]);
    await saveTask(db, t);
    await event(
      db,
      t.id,
      t.active_run_id,
      'command.' + input.command,
      { before, after: { status: t.status, phase: t.phase, revision: t.revision } },
      scope.actorId,
    );
    return t;
  });
}
export async function claim(db, owner, runId = null) {
  // Lock task before run everywhere to avoid command/worker deadlocks.
  const row = (
    await db.query(
      `SELECT t.* FROM app.fsd_v1_task t JOIN app.fsd_v1_run r ON r.id=(t.state->>'active_run_id')::uuid WHERE ((t.state->>'status'='ACTIVE' AND r.status='QUEUED') OR (t.state->>'status' IN ('ACTIVE','WAITING','DELIVERED') AND r.status='RUNNING' AND r.lease_until<clock_timestamp())) AND ($1::uuid IS NULL OR r.id=$1) ORDER BY r.created_at FOR UPDATE OF t SKIP LOCKED LIMIT 1`,
      [runId],
    )
  ).rows[0];
  if (!row) return null;
  const prior = (
    await db.query(
      'SELECT *,lease_until<clock_timestamp() AS lease_expired FROM app.fsd_v1_run WHERE id=$1 FOR UPDATE',
      [row.state.active_run_id],
    )
  ).rows[0];
  // The join's READ COMMITTED snapshot can predate another claimant's commit.
  // Recheck the run under its own row lock before incrementing the fence.
  if (
    !prior ||
    (!(prior.status === 'QUEUED' && row.state.status === 'ACTIVE') &&
      !(prior.status === 'RUNNING' && prior.lease_expired))
  )
    return null;
  if (prior.status === 'RUNNING')
    await chargeActive(
      db,
      {
        ...row.state,
        id: row.id,
        revision: row.revision,
        organization_id: row.organization_id,
        project_id: row.project_id,
        item_id: row.item_id,
        actor_id: row.actor_id,
      },
      prior,
    );
  const r = (
    await db.query(
      "UPDATE app.fsd_v1_run SET status='RUNNING',generation=generation+1,lease_until=clock_timestamp()+interval '30 seconds',lease_owner=$2 WHERE id=$1 RETURNING *",
      [row.state.active_run_id, owner],
    )
  ).rows[0];
  r.state.active_accounted_until = new Date().toISOString();
  await db.query('UPDATE app.fsd_v1_run SET state=$2 WHERE id=$1', [r.id, r.state]);
  if (prior.status === 'RUNNING') {
    await db.query(
      'UPDATE app.fsd_v1_attempt SET ended_at=clock_timestamp(),state=state || $2::jsonb WHERE run_id=$1 AND ended_at IS NULL AND generation<$3',
      [
        r.id,
        {
          status: 'ABANDONED',
          end_reason: 'LEASE_EXPIRED',
          superseded_by_generation: r.generation,
        },
        r.generation,
      ],
    );
  }
  const attemptId = randomUUID();
  await db.query('INSERT INTO app.fsd_v1_attempt(id,run_id,generation,state) VALUES($1,$2,$3,$4)', [
    attemptId,
    r.id,
    r.generation,
    { status: 'RUNNING', checkpoint_from: r.state.checkpoint_id ?? null },
  ]);
  await db.query(
    "UPDATE app.fsd_v1_event SET dispatch_status='CLAIMED',dispatch_attempts=dispatch_attempts+1 WHERE run_id=$1 AND dispatch_status IN ('PENDING','CLAIMED')",
    [r.id],
  );
  await event(db, row.id, r.id, 'worker.claim', {
    attempt_id: attemptId,
    generation: r.generation,
    thread_id: r.thread_id,
  });
  return {
    ...r,
    assets: {
      ...r.assets,
      budget: { ...r.assets.budget, ...row.state.budget_limits, ...r.state.budget_limits },
    },
    attempt_id: attemptId,
    scope: {
      organizationId: row.organization_id,
      projectId: row.project_id,
      itemId: row.item_id,
      actorId: row.actor_id,
    },
  };
}
export async function guard(db, lease, { allowWaiting = false } = {}) {
  await db.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))', [
    lease.scope.organizationId,
  ]);
  const permitted = (
    await db.query(
      `SELECT 1 FROM app.project p JOIN app.project_member pm ON pm.project_id=p.id AND pm.organization_id=p.organization_id JOIN app.organization_member om ON om.organization_id=p.organization_id AND om.user_id=pm.user_id JOIN app.app_user u ON u.id=pm.user_id JOIN app.organization o ON o.id=p.organization_id JOIN app.development_item i ON i.project_id=p.id AND i.organization_id=p.organization_id WHERE p.id=$1 AND p.organization_id=$2 AND pm.user_id=$3 AND i.id=$4 AND p.status<>'archived' AND pm.status='active' AND om.status='active' AND u.status='active' AND o.status='active' AND i.deleted_at IS NULL AND (om.access_level='admin' OR COALESCE(i.business_owner_id,i.created_by)=u.id)`,
      [lease.scope.projectId, lease.scope.organizationId, lease.scope.actorId, lease.scope.itemId],
    )
  ).rowCount;
  if (!permitted) throw fault('AUTH_DENIED', 'BUSINESS_COMMIT', 403);
  const t = await loadTask(db, lease.scope, lease.task_id, true);
  const r = (
    await db.query(
      'SELECT *,lease_until>clock_timestamp() AS lease_valid FROM app.fsd_v1_run WHERE id=$1 FOR UPDATE',
      [lease.id],
    )
  ).rows[0];
  if (t.status === 'PAUSED') throw fault('USER_PAUSED', 'BUSINESS_COMMIT', 409);
  if (!r || String(r.generation) !== String(lease.generation) || !r.lease_valid)
    throw fault('LEASE_LOST', 'BUSINESS_COMMIT', 409);
  if (['CANCELLED', 'COMPLETED'].includes(r.status) || t.status === 'ENDED')
    throw fault('RUN_CANCELLED', 'BUSINESS_COMMIT', 409);
  if (t.input_snapshot_id !== r.input_snapshot_id || t.active_run_id !== r.id)
    throw fault('STALE_INPUT', 'BUSINESS_COMMIT', 409);
  if (t.revision !== r.expected_revision) throw fault('VERSION_CONFLICT', 'BUSINESS_COMMIT', 409);
  if (!allowWaiting && t.status !== 'ACTIVE')
    throw fault('INVALID_TRANSITION', 'BUSINESS_COMMIT', 409);
  return {
    t,
    r: {
      ...r,
      assets: {
        ...r.assets,
        budget: { ...r.assets.budget, ...t.budget_limits, ...r.state.budget_limits },
      },
    },
  };
}
export async function renew(db, lease) {
  const { t, r } = await guard(db, lease, { allowWaiting: true });
  await chargeActive(db, t, r);
  if (
    r.state.budget.active_ms >= r.assets.budget.run_active_time ||
    t.budget.active_ms >= r.assets.budget.task_active_time
  )
    throw fault('BUDGET_EXHAUSTED', 'BUSINESS_COMMIT');
  await db.query(
    "UPDATE app.fsd_v1_run SET lease_until=clock_timestamp()+interval '30 seconds' WHERE id=$1",
    [r.id],
  );
}
export async function chargeActive(db, t, r) {
  const now = Date.now(),
    until = Math.min(now, r.lease_until ? new Date(r.lease_until).getTime() : now);
  const from = Date.parse(r.state.active_accounted_until ?? new Date(until).toISOString());
  const elapsed = Math.max(0, until - from);
  t.budget.active_ms += elapsed;
  r.state.budget.active_ms += elapsed;
  r.state.active_accounted_until = new Date(until).toISOString();
  await saveTask(db, t);
  await db.query('UPDATE app.fsd_v1_run SET state=$2 WHERE id=$1', [r.id, r.state]);
}
export async function stopUnauthorized(db, lease) {
  const t = await loadTask(db, lease.scope, lease.task_id, true);
  const r = (await db.query('SELECT * FROM app.fsd_v1_run WHERE id=$1 FOR UPDATE', [lease.id]))
    .rows[0];
  if (!r || String(r.generation) !== String(lease.generation) || t.active_run_id !== r.id) return;
  await chargeActive(db, t, r);
  t.status = 'WAITING';
  t.wait_reason = 'AUTHORIZATION';
  t.revision++;
  r.state.error = { code: 'AUTH_DENIED', error_origin: 'AUTH' };
  await saveTask(db, t);
  await db.query(
    "UPDATE app.fsd_v1_run SET status='WAITING',generation=generation+1,lease_until=NULL,state=$2,expected_revision=$3 WHERE id=$1",
    [r.id, r.state, t.revision],
  );
  await event(db, t.id, r.id, 'authorization.revoked', {
    attempt_id: lease.attempt_id,
    error_code: 'AUTH_DENIED',
    error_origin: 'AUTH',
  });
}
export async function stepCommit(db, lease, step, proposal, apply) {
  const { t, r } = await guard(db, lease, { allowWaiting: true });
  const key = hash([r.id, step, r.input_snapshot_id]);
  const old = (await db.query('SELECT * FROM app.fsd_v1_commit WHERE commit_key=$1', [key]))
    .rows[0];
  if (old) {
    if (old.proposal_hash !== hash(proposal))
      throw fault('IDEMPOTENCY_CONFLICT', 'BUSINESS_COMMIT', 409);
    await event(db, t.id, r.id, 'recovery.reconciled', { commit_key: key, result: 'SKIP_APPLIED' });
    return old.result;
  }
  const before = t.revision;
  const result = await apply(t, r);
  t.revision++;
  const eid = await event(db, t.id, r.id, 'business.commit', {
    step_id: step,
    commit_key: key,
    before_revision: before,
    after_revision: t.revision,
    artifact_version: t.artifact_version,
  });
  await db.query(
    'INSERT INTO app.fsd_v1_commit VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,clock_timestamp())',
    [key, r.id, step, r.input_snapshot_id, hash(proposal), before, t.revision, result, eid],
  );
  await saveTask(db, t);
  await db.query(
    'UPDATE app.fsd_v1_run SET expected_revision=$2,state=$3,updated_at=clock_timestamp() WHERE id=$1',
    [r.id, t.revision, { ...r.state, commit_status: 'APPLIED' }],
  );
  return result;
}
export async function reserve(db, lease, operationId, kind, tokens = 0) {
  const { t, r } = await guard(db, lease);
  const existing = (await db.query('SELECT * FROM app.fsd_v1_operation WHERE id=$1', [operationId]))
    .rows[0];
  if (existing) return existing;
  if (kind === 'model') {
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended('fsd-v1-model-concurrency',0))");
    const active = (
      await db.query(
        "SELECT count(*)::int AS n FROM app.fsd_v1_operation o JOIN app.fsd_v1_run r ON r.id=o.run_id WHERE o.kind='model' AND o.status='RESERVED' AND r.status='RUNNING' AND r.lease_until>clock_timestamp() AND o.reservation->>'generation'=r.generation::text",
      )
    ).rows[0].n;
    if (active >= MODEL_CONCURRENCY) throw fault('RATE_LIMIT', 'MODEL', 429);
  }
  const b = r.assets.budget,
    rb = r.state.budget,
    tb = t.budget,
    key = kind === 'model' ? 'model_calls' : 'tool_calls';
  if (
    rb[key] + 1 > b['run_' + key] ||
    tb[key] + 1 > b['task_' + key] ||
    rb.tokens + tokens > b.run_total_tokens ||
    tb.tokens + tokens > b.task_total_tokens
  )
    throw fault('BUDGET_EXHAUSTED', kind === 'model' ? 'MODEL' : 'SAP_ADAPTER');
  rb[key]++;
  tb[key]++;
  rb.tokens += tokens;
  tb.tokens += tokens;
  await saveTask(db, t);
  await db.query('UPDATE app.fsd_v1_run SET state=$2 WHERE id=$1', [r.id, r.state]);
  const reservation = { tokens, kind, generation: lease.generation };
  await db.query(
    "INSERT INTO app.fsd_v1_operation(id,run_id,kind,status,reservation) VALUES($1,$2,$3,'RESERVED',$4)",
    [operationId, r.id, kind, reservation],
  );
  await event(db, t.id, r.id, kind + '.reserved', { operation_id: operationId, tokens });
  return { id: operationId, status: 'RESERVED', reservation };
}
export async function settle(db, lease, operationId, result, error = null, usage = null) {
  if (error) error = safeError(error);
  const { t, r } = await guard(db, lease);
  const op = (
    await db.query('SELECT * FROM app.fsd_v1_operation WHERE id=$1 FOR UPDATE', [operationId])
  ).rows[0];
  if (!op || op.run_id !== r.id) throw fault('UNKNOWN_REFERENCE');
  if (op.status === 'SETTLED') return op.result;
  const known = usage && Number.isSafeInteger(usage.total_tokens) && usage.total_tokens >= 0;
  if (known && op.reservation.tokens) {
    const delta = usage.total_tokens - op.reservation.tokens;
    t.budget.tokens += delta;
    r.state.budget.tokens += delta;
    await saveTask(db, t);
    await db.query('UPDATE app.fsd_v1_run SET state=$2 WHERE id=$1', [r.id, r.state]);
  }
  await db.query(
    'UPDATE app.fsd_v1_operation SET reservation=reservation || $2::jsonb WHERE id=$1',
    [
      operationId,
      { usage_known: !!known, actual_tokens: known ? usage.total_tokens : null, cost: null },
    ],
  );
  await db.query(
    'UPDATE app.fsd_v1_operation SET status=$2,result=$3,result_hash=$4,error=$5,settled_at=clock_timestamp() WHERE id=$1',
    [operationId, error ? 'UNKNOWN' : 'SETTLED', result, result ? hash(result) : null, error],
  );
  await event(db, t.id, r.id, error ? 'operation.failed' : 'operation.completed', {
    operation_id: operationId,
    error_code: error?.code ?? null,
    error_origin: error?.error_origin ?? null,
    usage_known: !!known,
    cost: null,
  });
  return result;
}
