import { extractConfirmedAnswers, renderTechnicalOutput } from './feedback.mjs';
const questionKey = (value) =>
  String(value ?? '')
    .normalize('NFKC')
    .replace(/[\s\p{P}]/gu, '')
    .toLowerCase();

// Persisted run snapshots also cover sessions created before the history view existed.
export function readingForRun(row) {
  const s = row.snapshot ?? {};
  if (s.rendered) return s.rendered;
  if (
    !s.artifactId &&
    !s.decision &&
    row.state === 'completed' &&
    /^\s*(?:```json\s*)?\{/.test(s.text ?? '')
  ) {
    try {
      return renderTechnicalOutput(s.text);
    } catch {
      /* Invalid JSON cannot be a reading draft. */
    }
  }
  return undefined;
}
export function sessionDecisions(rows) {
  const answers = new Map();
  for (const row of rows) {
    const snapshot = row.snapshot ?? {};
    for (const answer of snapshot.naturalAnswers?.length
      ? snapshot.naturalAnswers
      : extractConfirmedAnswers(snapshot.messages ?? [], snapshot.prompt ?? ''))
      answers.set(questionKey(answer.question), { ...answer, sourceRunId: row.id });
    for (const answer of snapshot.decisions ?? []) {
      const key = questionKey(answer.question);
      const previous = answers.get(key);
      if (previous && answer.sourceRunId && previous.sourceRunId !== answer.sourceRunId) continue;
      answers.set(key, { ...answer, sourceRunId: answer.sourceRunId ?? row.id });
    }
    for (const answer of snapshot.answer ?? [])
      answers.set(questionKey(answer.question), {
        ...answer,
        sourceRunId: row.id,
        answeredAt: snapshot.answeredAt ?? null,
      });
  }
  return [...answers.values()];
}

export function sessionHistory(rows, artifacts = []) {
  const history = [];
  for (const row of rows) {
    const s = row.snapshot ?? {};
    if (!s.resumeRunId)
      history.push({
        id: row.id + ':user',
        role: 'user',
        content: s.prompt ?? '',
        status: 'completed',
        runId: row.id,
        createdAt: row.created_at,
        authorName: s.author?.name ?? row.actor_name ?? null,
        authorId: s.author?.id ?? row.actor_id ?? null,
      });
    const artifact = artifacts.find((a) => (a.runId ?? a.run_id) === row.id);
    const rendered = artifact ? s.rendered : readingForRun(row);
    history.push({
      id: row.id + ':assistant',
      role: 'assistant',
      runId: row.id,
      content: s.text || s.preflightFailure?.text || s.rawOutput || '',
      status: s.resolvedRunId
        ? 'completed'
        : ['completed', 'waiting_user', 'cancelled'].includes(row.state)
          ? row.state
          : 'failed',
      action: s.input?.action,
      model: s.input?.model?.modelId,
      rendered,
      steps: s.plan?.steps ?? [],
      ...(s.decision
        ? { decision: s.decision, answers: s.answer ?? [], answeredAt: s.answeredAt }
        : {}),
      ...(artifact ? { artifact } : {}),
      ...(s.failure
        ? {
            error: s.failure.message,
            errorCode: s.failure.code,
            finishReason: s.failure.finishReason,
          }
        : {}),
      createdAt: row.created_at,
      finishedAt:
        s.finishedAt ??
        (['completed', 'failed', 'cancelled', 'waiting_user'].includes(row.state)
          ? ((s.plan?.steps ?? [])
              .map((step) => step.finishedAt)
              .filter(Boolean)
              .sort()
              .at(-1) ?? null)
          : null),
    });
    if (s.answer?.length)
      history.push({
        id: row.id + ':answer',
        role: 'user',
        status: 'completed',
        runId: row.id,
        content: s.answer
          .map(
            (a) => `${a.question}\n回答：${a.label}${a.description ? ' — ' + a.description : ''}`,
          )
          .join('\n\n'),
        createdAt: s.answeredAt,
        authorName: s.author?.name ?? row.actor_name ?? null,
        authorId: s.author?.id ?? row.actor_id ?? null,
      });
  }
  return history;
}

export function isReviewContinuation(prompt, { latestArtifact, pending } = {}) {
  if (!latestArtifact || pending) return false;
  return /^(确认请继续|确认继续|请继续|继续|确认|好的请继续|好的继续|同意请继续|同意继续)$/.test(
    questionKey(prompt),
  );
}

export async function readSessionState(db, org, actor, conversationId) {
  const { rows } = await db.query(
    'SELECT r.id,r.state,r.snapshot,r.created_at,r.actor_id,u.display_name AS actor_name FROM app.fsd_agent_run r LEFT JOIN app.app_user u ON u.id=r.actor_id WHERE r.organization_id=$1 AND r.actor_id=$2 AND r.conversation_id=$3 ORDER BY r.created_at,r.id',
    [org, actor, conversationId],
  );
  const revisions = await db.query(
    'SELECT id,run_id,spec,markdown,content_hash,revision FROM app.fsd_agent_revision WHERE organization_id=$1 AND actor_id=$2 AND conversation_id=$3 ORDER BY revision',
    [org, actor, conversationId],
  );
  const artifacts = revisions.rows.map((r) => ({
    id: r.id,
    runId: r.run_id,
    spec: r.spec,
    markdown: r.markdown,
    contentHash: r.content_hash,
    revision: r.revision,
  }));
  const {
    rows: [session],
  } = await db.query(
    'SELECT workflow,selection FROM app.fsd_agent_session WHERE organization_id=$1 AND actor_id=$2 AND id=$3',
    [org, actor, conversationId],
  );
  const workflow = session?.selection?.workspaceStage === 'development' ? null : session?.workflow;
  const contextRows = workflow?.baselineId
    ? rows.filter((r) => r.snapshot?.manifest?.workflow?.baselineId === workflow.baselineId)
    : rows;
  return {
    workflow,
    contextHistory: sessionHistory(contextRows, artifacts),
    decisions: sessionDecisions(contextRows),
    history: sessionHistory(rows, artifacts),
    artifacts,
    latestArtifact: workflow?.activeRevisionId
      ? (artifacts.find((a) => a.id === workflow.activeRevisionId) ?? null)
      : (artifacts.at(-1) ?? null),
    latestRunId: rows.at(-1)?.id ?? null,
    pending: contextRows.some((r) => r.state === 'waiting_user' && !r.snapshot?.resolvedRunId),
  };
}
