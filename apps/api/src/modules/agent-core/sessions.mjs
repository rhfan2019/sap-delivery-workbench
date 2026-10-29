import { randomUUID } from 'node:crypto';
import { failure } from '../../platform/auth.mjs';

// Conversation lifecycle shared by the assistants (docs/guides/development-discipline.md 5):
// rename, archive and restore; conversations are never deleted. An archived conversation is
// read-only until restored.
export const SESSION_ARCHIVED = '对话已归档，恢复后再继续。';
export const SESSION_RUNNING = '对话正在运行，结束后再归档。';

// `{ title?, archived? }` of PATCH .../sessions/:sessionId, either or both.
export function sessionPatch(body) {
  const patch = {};
  if (body?.title !== undefined) {
    if (typeof body.title !== 'string' || !body.title.trim())
      throw failure(400, '请填写对话名称。');
    if (body.title.length > 200) throw failure(400, '对话名称过长。');
    patch.title = body.title.trim();
  }
  if (body?.archived !== undefined) {
    if (typeof body.archived !== 'boolean') throw failure(400, '归档状态无效。');
    patch.archived = body.archived;
  }
  if (!Object.keys(patch).length) throw failure(400, '请填写对话名称。');
  return patch;
}

export function assertSessionOpen(session) {
  if (session.archivedAt) throw failure(409, SESSION_ARCHIVED);
}

// Applies a patch through the agent's own persistence: `rename(id, title)` and
// `setArchived(id, archived)`, which must refuse (return false) while a turn is running.
// Archiving and restoring write an audit event; renaming does not, as before.
export async function changeSession(db, { scope, session, patch, rename, setArchived, subject }) {
  if (patch.archived !== undefined && patch.archived !== !!session.archivedAt) {
    if (patch.archived && session.activeTurnId) throw failure(409, SESSION_RUNNING);
    if (!(await setArchived(session.id, patch.archived))) throw failure(409, SESSION_RUNNING);
    await db.query(
      `INSERT INTO app.audit_event(organization_id,actor_user_id,action,outcome,subject_type,subject_id,request_id,details)
      VALUES($1,$2,$3,'success',$4,$5,$6,$7)`,
      [
        scope.organizationId,
        scope.actorId,
        `${subject}.${patch.archived ? 'archive' : 'restore'}`,
        subject,
        session.id,
        randomUUID(),
        JSON.stringify({ projectId: scope.projectId, itemId: scope.itemId }),
      ],
    );
  }
  if (patch.title !== undefined) await rename(session.id, patch.title);
}
