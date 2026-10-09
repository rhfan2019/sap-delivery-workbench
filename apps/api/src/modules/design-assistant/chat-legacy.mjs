import { readSessionState } from '../agent-runtime/public.mjs';
import { fault } from './policy.mjs';

const validId = (id) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id ?? ''))
    throw fault('INVALID_INPUT');
  return id;
};
const scopeValues = (scope) => [scope.organizationId, scope.actorId, scope.projectId, scope.itemId];
const scopeClause =
  "s.organization_id=$1 AND s.actor_id=$2 AND s.selection->>'projectId'=$3 AND s.selection->>'itemId'=$4 AND s.selection->>'workspaceStage'='design' AND s.cleared_at IS NULL";

export async function legacyChatSession(db, scope, id) {
  const row = (
    await db.query(`SELECT s.* FROM app.fsd_agent_session s WHERE ${scopeClause} AND s.id=$5`, [
      ...scopeValues(scope),
      validId(id),
    ])
  ).rows[0];
  if (!row) throw fault('NOT_FOUND', 'INPUT', 404);
  return row;
}

export async function listLegacyChatSessions(db, scope) {
  const rows = (
    await db.query(
      `SELECT s.id,s.created_at,s.context,r.id AS "runId",r.snapshot->>'prompt' AS title FROM app.fsd_agent_session s LEFT JOIN LATERAL (SELECT id,snapshot FROM app.fsd_agent_run WHERE conversation_id=s.id AND organization_id=s.organization_id AND actor_id=s.actor_id ORDER BY created_at DESC,id DESC LIMIT 1) r ON true WHERE ${scopeClause} ORDER BY s.created_at DESC,s.id DESC`,
      scopeValues(scope),
    )
  ).rows;
  return rows.map((row) => ({ ...row, legacy: true }));
}

export async function legacyChatRun(db, scope, runId) {
  const run = (
    await db.query(
      'SELECT * FROM app.fsd_agent_run WHERE organization_id=$1 AND actor_id=$2 AND id=$3',
      [scope.organizationId, scope.actorId, validId(runId)],
    )
  ).rows[0];
  if (!run) throw fault('NOT_FOUND', 'INPUT', 404);
  await legacyChatSession(db, scope, run.conversation_id);
  const state = await readSessionState(
    db,
    scope.organizationId,
    scope.actorId,
    run.conversation_id,
  );
  const artifact = state.artifacts.find((a) => a.runId === run.id) ?? null;
  const interrupted = !['completed', 'failed', 'cancelled'].includes(run.state);
  return {
    runId: run.id,
    createdAt: run.created_at,
    serverTime: new Date().toISOString(),
    conversationId: run.conversation_id,
    state: interrupted ? 'failed' : run.state,
    snapshot: interrupted
      ? {
          ...run.snapshot,
          decision: null,
          failure: {
            code: 'LEGACY_READ_ONLY',
            message: '此历史会话仅供查阅，旧执行引擎已停用。请在新对话中继续。',
          },
        }
      : run.snapshot,
    artifact,
    history: state.history,
    artifacts: state.artifacts,
    latestArtifact: state.latestArtifact,
    latestRunId: state.latestRunId,
    legacy: true,
  };
}

export async function legacyChatArtifact(db, scope, artifactId) {
  const row = (
    await db.query(
      'SELECT * FROM app.fsd_agent_revision WHERE organization_id=$1 AND actor_id=$2 AND id=$3',
      [scope.organizationId, scope.actorId, validId(artifactId)],
    )
  ).rows[0];
  if (!row) throw fault('NOT_FOUND', 'INPUT', 404);
  await legacyChatSession(db, scope, row.conversation_id);
  return {
    id: row.id,
    spec: row.spec,
    markdown: row.markdown,
    contentHash: row.content_hash,
    evidence: row.evidence,
    manifest: row.manifest,
    revision: row.revision,
    legacy: true,
  };
}

export async function legacyChatFiles(db, scope, conversationId) {
  await legacyChatSession(db, scope, conversationId);
  const values = [scope.organizationId, scope.actorId, conversationId];
  const inputs = (
    await db.query(
      "SELECT id,name,bytes,state,created_at,extraction->'warnings' AS warnings FROM app.fsd_agent_attachment WHERE organization_id=$1 AND actor_id=$2 AND conversation_id=$3 AND state<>'deleted' ORDER BY created_at,id",
      values,
    )
  ).rows;
  const outputs = (
    await db.query(
      'SELECT id,revision,created_at,content_hash FROM app.fsd_agent_revision WHERE organization_id=$1 AND actor_id=$2 AND conversation_id=$3 ORDER BY revision DESC',
      values,
    )
  ).rows;
  return { inputs, outputs, legacy: true };
}

export async function legacyChatFile(db, scope, conversationId, fileId) {
  await legacyChatSession(db, scope, conversationId);
  const row = (
    await db.query(
      "SELECT id,name,state,extraction FROM app.fsd_agent_attachment WHERE organization_id=$1 AND actor_id=$2 AND conversation_id=$3 AND id=$4 AND state<>'deleted'",
      [scope.organizationId, scope.actorId, conversationId, validId(fileId)],
    )
  ).rows[0];
  if (!row) throw fault('NOT_FOUND', 'INPUT', 404);
  return { ...row, legacy: true };
}

export async function legacyChatWorkflow(db, scope, conversationId) {
  const session = await legacyChatSession(db, scope, conversationId);
  return { ...(session.workflow ?? {}), legacy: true, readOnly: true, activeRunId: null };
}
