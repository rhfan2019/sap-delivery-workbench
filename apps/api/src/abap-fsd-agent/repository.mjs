import { lockWorkflow, isFsdSession, initialWorkflow, assertGenerationState } from './workflow.mjs';
import { randomUUID } from 'node:crypto';
import { failure } from '../auth.mjs';
import { sha256, renderMarkdown } from './specification.mjs';
export async function conversation(db, org, actor, id, selection) {
  const r = await db.query(
    'SELECT * FROM app.fsd_agent_session WHERE organization_id=$1 AND actor_id=$2 AND id=$3 AND cleared_at IS NULL',
    [org, actor, id],
  );
  if (!r.rows[0]) throw failure(404, '会话不存在或无权访问。');
  if (selection && sha256(r.rows[0].selection) !== sha256(selection)) {
    // JSONB key ordering is not significant.
    const keys = new Set([...Object.keys(r.rows[0].selection), ...Object.keys(selection)]);
    if (
      [...keys].some(
        (k) =>
          !(k === 'itemRowVersion' && selection.workspaceStage) &&
          r.rows[0].selection[k] !== selection[k],
      )
    )
      throw failure(409, '会话目标已固定，请开始新对话。');
  }
  return r.rows[0];
}
export async function createConversation(db, org, actor, selection) {
  const id = randomUUID();
  await db.query(
    'INSERT INTO app.fsd_agent_session(id,organization_id,actor_id,selection) VALUES($1,$2,$3,$4)',
    [id, org, actor, selection],
  );
  return id;
}
export async function saveRevision(
  db,
  {
    org,
    actor,
    conversationId,
    runId,
    spec,
    evidence,
    manifest,
    signal,
    render = renderMarkdown,
    decorate = true,
    completionSnapshot,
  },
) {
  const session = await lockWorkflow(db, org, actor, conversationId);
  const workflow = isFsdSession(session) ? { ...initialWorkflow(), ...session.workflow } : null;
  if (workflow) {
    assertGenerationState(workflow, manifest?.workflow);
    const {
      rows: [run],
    } = await db.query(
      'SELECT state FROM app.fsd_agent_run WHERE id=$1 AND conversation_id=$2 AND lease_until>clock_timestamp() FOR UPDATE',
      [runId, conversationId],
    );
    if (!run || !['queued', 'running'].includes(run.state))
      throw failure(409, '运行已结束，结果未保存。');
  }
  signal?.throwIfAborted();
  const {
    rows: [r],
  } = await db.query(
    'SELECT COALESCE(MAX(revision),0)+1 AS n FROM app.fsd_agent_revision WHERE conversation_id=$1',
    [conversationId],
  );
  spec = decorate
    ? {
        ...spec,
        specId: 'SPEC-' + BigInt('0x' + conversationId.replaceAll('-', '')).toString(),
        revision: r.n,
      }
    : spec;
  const id = randomUUID();
  const renderStarted = performance.now();
  const markdown = render(spec);
  const rendering = {
    engine: 'local-javascript',
    modelCalls: 0,
    durationMs: performance.now() - renderStarted,
  };
  const contentHash = sha256(spec);
  await db.query(
    'INSERT INTO app.fsd_agent_revision(id,organization_id,actor_id,conversation_id,run_id,revision,spec,markdown,content_hash,evidence,manifest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
    [
      id,
      org,
      actor,
      conversationId,
      runId,
      r.n,
      spec,
      markdown,
      contentHash,
      JSON.stringify(evidence),
      manifest,
    ],
  );
  if (workflow) {
    const kind = workflow.phase === 'refining' ? 'final' : 'draft';
    await db.query('UPDATE app.fsd_agent_revision SET kind=$2 WHERE id=$1', [id, kind]);
    await db.query('UPDATE app.fsd_agent_session SET workflow=$2 WHERE id=$1', [
      conversationId,
      {
        ...workflow,
        phase: kind === 'final' ? 'final_review' : 'draft_review',
        version: String(BigInt(workflow.version) + 1n),
        activeRevisionId: id,
        activeRevision: r.n,
        activeContentHash: contentHash,
        finalApproval: null,
        ...(kind === 'draft' ? { draftApproval: null } : {}),
        updatedAt: new Date().toISOString(),
        updatedBy: actor,
      },
    ]);
  }
  signal?.throwIfAborted();
  if (completionSnapshot) {
    await db.query(
      "UPDATE app.fsd_agent_run SET state='completed',snapshot=snapshot || $2::jsonb WHERE id=$1 AND conversation_id=$3 AND state IN ('queued','running')",
      [
        runId,
        JSON.stringify({
          ...completionSnapshot,
          artifactId: id,
          rendering,
          finishedAt: new Date().toISOString(),
        }),
        conversationId,
      ],
    );
  }
  return { id, spec, markdown, contentHash, revision: r.n, rendering };
}
