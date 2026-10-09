import { randomUUID } from 'node:crypto';
import { loadTask, saveTask, command, dedupe } from './repository.mjs';
import { hash, fault } from './policy.mjs';

export function chatArtifact(a) {
  if (!a) return null;
  const markdown =
    '# ' +
    (a.kind === 'FSD' ? '功能说明书' : '设计初稿') +
    '\n\n' +
    Object.values(a.objects)
      .sort((x, y) => x.section - y.section || x.object_id.localeCompare(y.object_id))
      .map((o) => `## ${o.section}\n\n${o.content}`)
      .join('\n\n');
  return {
    id: a.id,
    revision: a.version,
    contentHash: hash({
      id: a.id,
      version: a.version,
      objects: a.objects,
      evidence_refs: a.evidence_refs,
    }),
    markdown,
    spec: { issues: a.issues ?? [], objects: a.objects },
  };
}
export function chatDecision(task) {
  if (task.wait_reason !== 'CLARIFICATION' || task.wait?.status !== 'OPEN') return null;
  return {
    id: task.wait.id,
    kind: 'business',
    message: '请确认以下需求问题。',
    questions: task.wait.questions.map((q) => ({
      id: q.id,
      title: q.question ?? q.title ?? q.text,
      allowText: q.options.some((o) => o.other),
      options: q.options
        .filter((o) => !o.other)
        .map((o) => ({
          value: o.id,
          label: o.label,
          description: o.description ?? '',
          recommended: !!o.recommended,
        })),
    })),
  };
}
async function taskFor(db, scope, id, lock = false) {
  const task = await loadTask(db, scope, id, lock);
  if (!task.chat) throw fault('NOT_FOUND', 'INPUT', 404);
  return task;
}
export async function chatWorkflow(db, scope, id) {
  const t = await taskFor(db, scope, id);
  const artifact = t.artifacts.find((a) => a.id === t.current_artifact_id) ?? t.artifacts.at(-1);
  const a = chatArtifact(artifact);
  const run = (
    await db.query('SELECT status,state FROM app.fsd_v1_run WHERE id=$1', [t.active_run_id])
  ).rows[0];
  const approval = (kind) => {
    const c = t.confirmations.findLast(
      (c) => c.kind === kind && (kind === 'PLAN_CONFIRM' || c.artifact_id === artifact?.id),
    );
    const original = t.artifacts.find((a) => a.id === c?.artifact_id);
    return c && original
      ? {
          revisionId: c.artifact_id,
          contentHash: chatArtifact(original).contentHash,
          actorId: c.actor_id,
          at: c.at,
        }
      : null;
  };
  return {
    phase:
      t.status === 'DELIVERED'
        ? 'completed'
        : t.chat.draftApproved
          ? 'refining'
          : t.wait_reason === 'PLAN_CONFIRM'
            ? 'draft_review'
            : t.wait_reason === 'FSD_CONFIRM'
              ? 'final_review'
              : 'analysis',
    version: String(t.revision),
    activeRevisionId: a?.id ?? null,
    activeRevision: a?.revision ?? null,
    activeContentHash: a?.contentHash ?? null,
    activeArtifact: a,
    activeRunId: ['QUEUED', 'RUNNING'].includes(run?.status)
      ? (run.state.chat_turn_id ?? t.active_run_id)
      : null,
    draftApproval: approval('PLAN_CONFIRM'),
    finalApproval: approval('FSD_CONFIRM'),
    baselineId: t.delivered_artifact_id ?? null,
    updatedAt: new Date().toISOString(),
    updatedBy: t.actor_id,
    revisions: t.artifacts.map((x) => ({
      id: x.id,
      revision: x.version,
      contentHash: chatArtifact(x).contentHash,
      kind: x.kind,
      createdAt: x.created_at,
    })),
  };
}
export async function chatWorkflowCommand(db, scope, id, input) {
  return dedupe(
    db,
    scope,
    { ...input, request_id: input.requestId, operation: 'chat.workflow', conversationId: id },
    async () => {
      let t = await taskFor(db, scope, id, true);
      if (String(t.revision) !== input.expectedVersion)
        throw fault('VERSION_CONFLICT', 'INPUT', 409);
      const current = t.artifacts.find((a) => a.id === t.current_artifact_id) ?? t.artifacts.at(-1);
      if (!current || chatArtifact(current).contentHash !== input.contentHash)
        throw fault('STALE_CONFIRMATION', 'INPUT', 409);
      if (
        (
          await db.query(
            "SELECT 1 FROM app.fsd_v1_run WHERE task_id=$1 AND status IN ('QUEUED','RUNNING')",
            [id],
          )
        ).rowCount
      )
        throw fault('CHAT_RUN_ACTIVE', 'INPUT', 409);
      if (['approve_draft', 'approve_final'].includes(input.command)) {
        if (
          current.id !== input.revisionId ||
          t.wait_reason !== (input.command === 'approve_draft' ? 'PLAN_CONFIRM' : 'FSD_CONFIRM')
        )
          throw fault('STALE_CONFIRMATION', 'INPUT', 409);
        t = await command(db, scope, id, {
          request_id: randomUUID(),
          command: 'confirm',
          revision: t.revision,
          artifact_id: current.id,
          artifact_version: current.version,
          scope: current.scope,
          confirmed: true,
        });
        if (input.command === 'approve_draft') {
          // Original UI explicitly asks the user to trigger final generation after approval.
          await db.query("UPDATE app.fsd_v1_run SET status='WAITING' WHERE id=$1", [
            t.active_run_id,
          ]);
          t.status = 'WAITING';
          t.chat.draftApproved = true;
          await saveTask(db, t);
        }
      } else if (input.command === 'revise') {
        t.chat.draftApproved = false;
        t.chat.revising = true;
        t.confirmations = [];
        t.wait = null;
        t.wait_reason = 'CHAT_READY';
        t.status = 'WAITING';
        t.revision++;
        await db.query('UPDATE app.fsd_v1_run SET expected_revision=$2 WHERE id=$1', [
          t.active_run_id,
          t.revision,
        ]);
        await saveTask(db, t);
      } else if (input.command === 'rollback') {
        const selected = t.artifacts.find((a) => a.id === input.revisionId);
        if (!selected) throw fault('NOT_FOUND', 'INPUT', 404);
        // A historical revision is a new review basis, never an inherited approval.
        t.current_artifact_id = selected.id;
        t.objects = structuredClone(selected.objects);
        t.confirmations = [];
        t.chat.draftApproved = false;
        t.chat.revising = true;
        t.wait = null;
        t.wait_reason = 'CHAT_READY';
        t.status = 'WAITING';
        t.revision++;
        await db.query('UPDATE app.fsd_v1_run SET expected_revision=$2 WHERE id=$1', [
          t.active_run_id,
          t.revision,
        ]);
        await saveTask(db, t);
      } else throw fault('INVALID_INPUT');
      return chatWorkflow(db, scope, id);
    },
  );
}
