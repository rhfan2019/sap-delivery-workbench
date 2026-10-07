import { randomUUID } from 'node:crypto';
import { failure } from '../auth.mjs';
import { sha256, renderMarkdown } from './specification.mjs';
export const isFsdSession = (session) => session.selection?.workspaceStage !== 'development';
export function initialWorkflow() {
  return {
    phase: 'analysis',
    version: '1',
    activeRevisionId: null,
    activeRevision: null,
    activeContentHash: null,
    draftApproval: null,
    finalApproval: null,
    baselineId: null,
  };
}
export function transitionWorkflow(state, input, actor, at = new Date().toISOString()) {
  if (String(input.expectedVersion) !== String(state.version))
    throw failure(409, '阶段已变化，请刷新后重试。');
  const next = {
    ...state,
    version: String(BigInt(state.version) + 1n),
    updatedBy: actor,
    updatedAt: at,
  };
  if (input.command === 'approve_draft' || input.command === 'approve_final') {
    const draft = input.command === 'approve_draft';
    if (
      state.phase !== (draft ? 'draft_review' : 'final_review') ||
      !state.activeRevisionId ||
      input.revisionId !== state.activeRevisionId ||
      input.contentHash !== state.activeContentHash
    )
      throw failure(409, '只能确认当前待审阅版本及其完整内容哈希。');
    next[draft ? 'draftApproval' : 'finalApproval'] = {
      revisionId: state.activeRevisionId,
      contentHash: state.activeContentHash,
      actorId: actor,
      at,
    };
    next.phase = draft ? 'refining' : 'completed';
  } else if (input.command === 'revise') {
    next.phase =
      ['final_review', 'completed', 'refining'].includes(state.phase) && state.draftApproval
        ? 'refining'
        : 'analysis';
    next.finalApproval = null;
    if (next.phase === 'analysis') next.draftApproval = null;
  } else if (input.command !== 'rollback') throw failure(400, '阶段操作无效。');
  return next;
}
export function assertGenerationState(state, frozen) {
  if (
    !frozen ||
    String(state.version) !== String(frozen.version) ||
    state.phase !== frozen.phase ||
    state.activeRevisionId !== frozen.activeRevisionId
  )
    throw failure(409, '生成依据的阶段或版本已变化，结果未保存。');
  if (!['analysis', 'refining'].includes(state.phase))
    throw failure(409, '请先确认当前版本或选择修订，再生成说明书。');
  if (state.phase === 'refining' && !state.draftApproval) throw failure(409, '初稿尚未确认。');
}
export async function lockWorkflow(db, org, actor, id) {
  const {
    rows: [session],
  } = await db.query(
    'SELECT * FROM app.fsd_agent_session WHERE organization_id=$1 AND actor_id=$2 AND id=$3 AND cleared_at IS NULL FOR UPDATE',
    [org, actor, id],
  );
  if (!session) throw failure(404, '会话不存在或无权访问。');
  return session;
}
export async function recoverInterruptedRuns(db, id) {
  await db.query(
    `UPDATE app.fsd_agent_run SET state='failed',snapshot=snapshot || jsonb_build_object('failure',jsonb_build_object('code','INTERRUPTED','message','服务重启或运行租约失效，请重新发送。'),'finishedAt',clock_timestamp()) WHERE conversation_id=$1 AND state IN ('queued','running') AND (lease_until IS NULL OR lease_until<clock_timestamp())`,
    [id],
  );
}
export async function assertIdle(db, id) {
  await recoverInterruptedRuns(db, id);
  const { rows } = await db.query(
    "SELECT id FROM app.fsd_agent_run WHERE conversation_id=$1 AND state IN ('queued','running') LIMIT 1",
    [id],
  );
  if (rows.length) throw failure(409, '生成正在进行，请先等待完成或取消运行。');
}
export async function readWorkflow(db, session) {
  if (!isFsdSession(session)) throw failure(404, '开发阶段不使用说明书阶段流程。');
  const { rows } = await db.query(
    'SELECT id,revision,content_hash,kind,created_at,spec,markdown FROM app.fsd_agent_revision WHERE conversation_id=$1 ORDER BY revision',
    [session.id],
  );
  const state = { ...initialWorkflow(), ...session.workflow };
  const active = rows.find((r) => r.id === state.activeRevisionId);
  await recoverInterruptedRuns(db, session.id);
  const runs = await db.query(
    "SELECT id FROM app.fsd_agent_run WHERE conversation_id=$1 AND state IN ('queued','running') LIMIT 1",
    [session.id],
  );
  return {
    ...state,
    activeRunId: runs.rows[0]?.id ?? null,
    activeArtifact: active
      ? {
          id: active.id,
          revision: active.revision,
          contentHash: active.content_hash,
          spec: active.spec,
          markdown: active.markdown,
        }
      : null,
    revisions: rows.map((r) => ({
      id: r.id,
      revision: r.revision,
      contentHash: r.content_hash,
      kind: r.kind,
      createdAt: r.created_at,
    })),
  };
}
export async function applyWorkflow(db, session, input, actor) {
  if (!isFsdSession(session)) throw failure(404, '开发阶段不使用说明书阶段流程。');
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (
    !uuid.test(input?.requestId ?? '') ||
    !/^\d+$/.test(String(input?.expectedVersion ?? '')) ||
    !['approve_draft', 'approve_final', 'revise', 'rollback'].includes(input?.command)
  )
    throw failure(400, '阶段操作格式无效。');
  const hash = sha256(input);
  const prior = await db.query(
    'SELECT request_hash,resulting_state FROM app.fsd_agent_workflow_event WHERE conversation_id=$1 AND request_id=$2',
    [session.id, input.requestId],
  );
  if (prior.rows[0]) {
    if (prior.rows[0].request_hash !== hash) throw failure(409, '请求标识已用于其他操作。');
    return readWorkflow(db, session);
  }
  await assertIdle(db, session.id);
  const before = { ...initialWorkflow(), ...session.workflow };
  const next = transitionWorkflow(before, input, actor);
  if (input.command === 'rollback') {
    if (!uuid.test(input.revisionId ?? '')) throw failure(400, '回退版本无效。');
    const {
      rows: [source],
    } = await db.query('SELECT * FROM app.fsd_agent_revision WHERE conversation_id=$1 AND id=$2', [
      session.id,
      input.revisionId,
    ]);
    if (!source) throw failure(404, '回退版本不存在。');
    const {
      rows: [counter],
    } = await db.query(
      'SELECT COALESCE(MAX(revision),0)+1 AS n FROM app.fsd_agent_revision WHERE conversation_id=$1',
      [session.id],
    );
    const id = randomUUID(),
      spec = { ...source.spec, revision: counter.n },
      contentHash = sha256(spec);
    await db.query(
      'INSERT INTO app.fsd_agent_revision(id,organization_id,actor_id,conversation_id,run_id,revision,spec,markdown,content_hash,evidence,manifest,kind) VALUES($1,$2,$3,$4,NULL,$5,$6,$7,$8,$9,$10,$11)',
      [
        id,
        session.organization_id,
        actor,
        session.id,
        counter.n,
        spec,
        renderMarkdown(spec),
        contentHash,
        JSON.stringify(source.evidence),
        { ...source.manifest, restoredFrom: source.id, workflow: before },
        source.kind,
      ],
    );
    Object.assign(next, {
      phase: source.kind === 'final' ? 'final_review' : 'draft_review',
      activeRevisionId: id,
      activeRevision: counter.n,
      activeContentHash: contentHash,
      draftApproval: null,
      finalApproval: null,
      baselineId: randomUUID(),
    });
  }
  await db.query('UPDATE app.fsd_agent_session SET workflow=$2 WHERE id=$1', [session.id, next]);
  await db.query(
    'INSERT INTO app.fsd_agent_workflow_event(id,conversation_id,request_id,request_hash,actor_id,command,previous_state,resulting_state) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [randomUUID(), session.id, input.requestId, hash, actor, input.command, before, next],
  );
  return readWorkflow(db, { ...session, workflow: next });
}
