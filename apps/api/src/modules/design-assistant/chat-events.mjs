import { randomUUID } from 'node:crypto';
import { guard, loadTask } from './repository.mjs';
import { fault } from './policy.mjs';

const terminals = new Set(['run.completed', 'run.failed', 'run.cancelled', 'run.waiting_user']);
const types = new Set([
  ...terminals,
  'message.reset',
  'message.delta',
  'technical.delta',
  'generation.progress',
  'step.updated',
  'artifact.ready',
]);

// Mutations require a transaction client. Task/run fencing precedes the turn lock.
export async function createTurn(db, scope, taskId, runId, input) {
  const task = await loadTask(db, scope, taskId, true);
  if (task.actor_id !== scope.actorId) throw fault('NOT_FOUND', 'INPUT', 404);
  const run = (
    await db.query('SELECT id FROM app.fsd_v1_run WHERE id=$1 AND task_id=$2', [runId, taskId])
  ).rows[0];
  if (!run) throw fault('NOT_FOUND', 'INPUT', 404);
  return (
    await db.query(
      'INSERT INTO app.fsd_v1_chat_turn(id,task_id,run_id,input) VALUES($1,$2,$3,$4) RETURNING *',
      [randomUUID(), taskId, runId, input],
    )
  ).rows[0];
}

export async function appendChatEvent(db, lease, turnId, type, data) {
  await guard(db, lease, { allowWaiting: true });
  if (!types.has(type)) throw fault('INVALID_CHAT_EVENT');
  const turn = (
    await db.query(
      'SELECT * FROM app.fsd_v1_chat_turn WHERE id=$1 AND run_id=$2 AND task_id=$3 FOR UPDATE',
      [turnId, lease.id, lease.task_id],
    )
  ).rows[0];
  if (!turn) throw fault('NOT_FOUND', 'INPUT', 404);
  if (turn.terminal) throw fault('CHAT_TURN_TERMINAL', 'INPUT', 409);
  const seq = turn.last_seq + 1;
  await db.query('INSERT INTO app.fsd_v1_chat_event(turn_id,seq,type,data) VALUES($1,$2,$3,$4)', [
    turnId,
    seq,
    type,
    data,
  ]);
  await db.query('UPDATE app.fsd_v1_chat_turn SET last_seq=$2,terminal=$3 WHERE id=$1', [
    turnId,
    seq,
    terminals.has(type),
  ]);
  return { runId: turnId, seq, type, data };
}

export async function loadTurn(db, scope, id) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id ?? ''))
    throw fault('INVALID_INPUT');
  const turn = (
    await db.query(
      'SELECT c.* FROM app.fsd_v1_chat_turn c JOIN app.fsd_v1_task t ON t.id=c.task_id WHERE c.id=$1 AND t.organization_id=$2 AND t.project_id=$3 AND t.item_id=$4 AND t.actor_id=$5',
      [id, scope.organizationId, scope.projectId, scope.itemId, scope.actorId],
    )
  ).rows[0];
  if (!turn) throw fault('NOT_FOUND', 'INPUT', 404);
  return turn;
}

export async function readChatEvents(db, scope, id, after = 0) {
  if (!Number.isSafeInteger(after) || after < 0) throw fault('INVALID_CURSOR');
  await loadTurn(db, scope, id);
  return (
    await db.query(
      'SELECT turn_id AS "runId",seq,type,data FROM app.fsd_v1_chat_event WHERE turn_id=$1 AND seq>$2 ORDER BY seq LIMIT 200',
      [id, after],
    )
  ).rows;
}
