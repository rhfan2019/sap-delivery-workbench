import { randomUUID } from 'node:crypto';
import { createTask, loadTask, saveTask, newRun, dedupe, command } from './repository.mjs';
import { createTurn, loadTurn } from './chat-events.mjs';
import { fault } from './policy.mjs';
import { chatArtifact, chatDecision } from './chat-workflow.mjs';

export async function loadConversation(db, scope, id, lock = false) {
  const task = await loadTask(db, scope, id, lock);
  if (task.actor_id !== scope.actorId || !task.chat) throw fault('NOT_FOUND', 'INPUT', 404);
  return task;
}

export async function createChatConversation(db, scope, assets) {
  const task = await createTask(
    db,
    scope,
    {
      request_id: randomUUID(),
      text: '新对话',
      mode: assets.model.mode,
      target: { target_ref: 'chat' },
    },
    assets,
  );
  // The transaction never exposes the placeholder to a worker.
  await db.query("UPDATE app.fsd_v1_run SET status='WAITING' WHERE id=$1", [task.active_run_id]);
  await db.query(
    "UPDATE app.fsd_v1_event SET dispatch_status='DONE' WHERE run_id=$1 AND dispatch_status='PENDING'",
    [task.active_run_id],
  );
  task.chat = { title: '新对话' };
  task.status = 'WAITING';
  task.wait_reason = 'CHAT_READY';
  await saveTask(db, task);
  return task;
}

export async function startChatTurn(db, scope, input, assets, target = null) {
  return dedupe(
    db,
    scope,
    { ...input, request_id: input.requestId, operation: 'chat.turn' },
    async () => {
      if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 100000)
        throw fault('INVALID_INPUT');
      let task = input.conversationId
        ? await loadConversation(db, scope, input.conversationId, true)
        : await createChatConversation(db, scope, assets);
      if (
        (
          await db.query(
            "SELECT 1 FROM app.fsd_v1_run WHERE task_id=$1 AND status IN ('QUEUED','RUNNING')",
            [task.id],
          )
        ).rowCount
      )
        throw fault('CHAT_RUN_ACTIVE', 'INPUT', 409);
      if (!['dialogue', 'draft'].includes(input.action)) throw fault('INVALID_INPUT');
      if (input.decisionAnswer || input.resumeRunId) {
        const old = await loadTurn(db, scope, input.resumeRunId);
        if (
          old.task_id !== task.id ||
          old.run_id !== task.active_run_id ||
          task.wait_reason !== 'CLARIFICATION' ||
          task.wait.id !== input.decisionAnswer?.decisionId
        )
          throw fault('STALE_CONFIRMATION', 'INPUT', 409);
        const values = input.decisionAnswer.values;
        if (!values || Object.keys(values).length !== task.wait.questions.length)
          throw fault('INVALID_ANSWER');
        const answered = task.messages.find((m) => m.decision?.id === task.wait.id);
        if (answered) {
          answered.answeredAt = new Date().toISOString();
          answered.status = 'completed';
          answered.answers = task.wait.questions.map((q) => ({
            question: q.question ?? q.title ?? q.text,
            label: values[q.id]?.startsWith('text:')
              ? values[q.id].slice(5)
              : (q.options.find((o) => o.id === values[q.id])?.label ?? values[q.id]),
            value: values[q.id],
          }));
          await saveTask(db, task);
        }
        for (const question of task.wait.questions) {
          const value = values[question.id];
          if (typeof value !== 'string') throw fault('INVALID_ANSWER');
          const custom = value.startsWith('text:');
          const option = custom ? question.options.find((o) => o.other)?.id : value;
          task = await command(db, scope, task.id, {
            request_id: randomUUID(),
            command: 'answer',
            revision: task.revision,
            question_id: question.id,
            option_id: option,
            text: custom ? value.slice(5) : '',
            attachment_ids: input.attachmentIds ?? [],
          });
        }
        task = await command(db, scope, task.id, {
          request_id: randomUUID(),
          command: 'complete_batch',
          revision: task.revision,
        });
        return recordTurn(db, scope, task, input, task.active_run_id);
      }
      // draftApproved stays set until the FSD round has saved a final draft (graph N08), so a
      // failed final generation can be retried without losing the plan approval.
      if (input.action === 'draft' && task.chat.draftApproved) {
        if (task.wait_reason === 'TECHNICAL') {
          // Retry after a failure: a successor run redoes only the FSD round (fresh model calls,
          // nothing reused from the rejected attempt); approvals and saved objects are kept.
          const failed = task.active_run_id;
          task.wait_reason = null;
          task.revision++;
          await newRun(db, task, task.assets, 'FSD_RETRY');
          await db.query(
            "UPDATE app.fsd_v1_run SET status='COMPLETED',generation=generation+1,lease_until=NULL,state=state || $2::jsonb WHERE id=$1",
            [
              failed,
              { completion_reason: 'SUPERSEDED_BY_RETRY', successor_run_id: task.active_run_id },
            ],
          );
          await db.query('UPDATE app.fsd_v1_run SET state=state || $2::jsonb WHERE id=$1', [
            task.active_run_id,
            { fsd_round: true },
          ]);
          return recordTurn(db, scope, task, input, task.active_run_id);
        }
        task.status = 'ACTIVE';
        await db.query("UPDATE app.fsd_v1_run SET status='QUEUED' WHERE id=$1", [
          task.active_run_id,
        ]);
        return recordTurn(db, scope, task, input, task.active_run_id);
      }
      const attachmentIds = input.attachmentIds ?? [];
      if (
        !Array.isArray(attachmentIds) ||
        attachmentIds.length > 10 ||
        attachmentIds.some((id) => typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id))
      )
        throw fault('INVALID_INPUT');
      const attachments = (
        await db.query(
          'SELECT id FROM app.fsd_v1_attachment WHERE task_id=$1 AND id=ANY($2::uuid[])',
          [task.id, attachmentIds],
        )
      ).rows;
      if (attachments.length !== new Set(attachmentIds).size)
        throw fault('NOT_FOUND', 'INPUT', 404);
      if (attachmentIds.some((id) => task.chat.removedAttachments?.includes(id)))
        throw fault('NOT_FOUND', 'INPUT', 404);
      if (
        input.action === 'dialogue' &&
        ['CLARIFICATION', 'PLAN_CONFIRM', 'FSD_CONFIRM'].includes(task.wait_reason)
      ) {
        task.chat.pendingDesign = Object.fromEntries(
          [
            'active_run_id',
            'input_snapshot_id',
            'input',
            'input_version',
            'assets',
            'mode',
            'wait',
            'wait_reason',
            'status',
            'attachment_ids',
          ].map((key) => [key, structuredClone(task[key])]),
        );
      }
      task.attachment_ids = attachmentIds;
      task.assets = assets;
      task.mode = assets.model.mode;
      task.input = {
        text: input.prompt.trim(),
        chat_action: input.action,
        workspace_version_id: input.workspaceVersionId ?? null,
        chat_messages: [
          ...task.messages
            .filter((m) => m.status === 'completed')
            .map((m) => ({ role: m.role, content: m.content })),
          { role: 'user', content: input.prompt.trim() },
        ],
      };
      if (JSON.stringify(task.input.chat_messages).length > 300000)
        throw fault('CHAT_CONTEXT_LIMIT', 'INPUT', 409);
      task.revision++;
      task.input_version++;
      if (input.action === 'draft') {
        if (!target && task.target.target_ref === 'chat')
          throw fault('SAP_CAPABILITY_UNVERIFIED', 'SAP_ADAPTER', 409);
        if (target) task.target = target;
        task.phase = 1;
        task.wait = null;
        task.confirmations = [];
        task.chat.revising = false;
      }
      const runId = await newRun(db, task, assets, 'CHAT');
      return recordTurn(db, scope, task, input, runId);
    },
  );
}

async function recordTurn(db, scope, task, input, runId) {
  const turn = await createTurn(db, scope, task.id, runId, {
    prompt: input.prompt,
    modelId: input.modelId,
    selection: input.selection,
    action: input.action,
    attachmentIds: input.attachmentIds ?? [],
  });
  await db.query('UPDATE app.fsd_v1_run SET state=state || $2::jsonb WHERE id=$1', [
    runId,
    { chat_turn_id: turn.id },
  ]);
  task.messages.push({
    id: turn.id + ':user',
    runId: turn.id,
    role: 'user',
    content: input.decisionAnswer
      ? Object.values(input.decisionAnswer.values).join('\n')
      : input.prompt,
    status: 'completed',
    createdAt: turn.created_at.toISOString(),
  });
  if (task.status === 'ENDED') {
    await db.query(
      "INSERT INTO app.fsd_v1_chat_event(turn_id,seq,type,data) VALUES($1,1,'run.completed','{}')",
      [turn.id],
    );
    await db.query('UPDATE app.fsd_v1_chat_turn SET terminal=true,last_seq=1 WHERE id=$1', [
      turn.id,
    ]);
    task.messages.push({
      id: turn.id + ':assistant',
      runId: turn.id,
      role: 'assistant',
      content: '本次设计已结束，历史记录已保留。',
      status: 'completed',
      createdAt: new Date().toISOString(),
    });
  }
  if (task.chat.title === '新对话') task.chat.title = task.input.text.slice(0, 60);
  await saveTask(db, task);
  return {
    runId: turn.id,
    conversationId: task.id,
    action: input.action,
    createdAt: turn.created_at.toISOString(),
    serverTime: new Date().toISOString(),
  };
}

export async function chatRunSnapshot(db, scope, id) {
  const turn = await loadTurn(db, scope, id);
  const task = await loadConversation(db, scope, turn.task_id);
  const run = (await db.query('SELECT status,state FROM app.fsd_v1_run WHERE id=$1', [turn.run_id]))
    .rows[0];
  const rows = (
    await db.query(
      'SELECT seq,type,data FROM app.fsd_v1_chat_event WHERE turn_id=$1 ORDER BY seq',
      [id],
    )
  ).rows;
  const terminal = rows.findLast((e) => e.type.startsWith('run.'));
  const text = rows
    .filter((e) => e.type === 'message.delta')
    .map((e) => e.data.text)
    .join('');
  const state = terminal ? terminal.type.slice(4) : run.status.toLowerCase();
  const artifact = chatArtifact(task.artifacts.at(-1));
  const decision = terminal?.type === 'run.waiting_user' ? terminal.data.decision : null;
  const history = structuredClone(task.messages);
  if (!history.some((m) => m.id === id + ':assistant'))
    history.push({
      id: id + ':assistant',
      runId: id,
      role: 'assistant',
      content: text,
      status: terminal ? state : 'completed',
      action: turn.input.action,
      createdAt: turn.created_at.toISOString(),
    });
  const latest = (
    await db.query(
      'SELECT id FROM app.fsd_v1_chat_turn WHERE task_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',
      [task.id],
    )
  ).rows[0]?.id;
  return {
    runId: id,
    latestRunId: latest,
    conversationId: task.id,
    state,
    cursor: rows.at(-1)?.seq ?? 0,
    serverTime: new Date().toISOString(),
    snapshot: { input: turn.input, prompt: turn.input.prompt, messages: [], text, decision },
    history,
    artifacts: task.artifacts.map(chatArtifact),
    artifact,
    latestArtifact: artifact,
  };
}

export async function cancelChatTurn(db, scope, id) {
  const initial = await loadTurn(db, scope, id);
  let task = await loadConversation(db, scope, initial.task_id, true);
  const turn = (await db.query('SELECT * FROM app.fsd_v1_chat_turn WHERE id=$1 FOR UPDATE', [id]))
    .rows[0];
  if (turn.terminal) return { cancelled: false };
  if (task.active_run_id !== turn.run_id) throw fault('STALE_INPUT', 'INPUT', 409);
  task = await command(db, scope, task.id, {
    command: 'cancel',
    request_id: randomUUID(),
    revision: task.revision,
  });
  const seq = turn.last_seq + 1;
  await db.query(
    "INSERT INTO app.fsd_v1_chat_event(turn_id,seq,type,data) VALUES($1,$2,'run.cancelled','{}')",
    [id, seq],
  );
  await db.query('UPDATE app.fsd_v1_chat_turn SET terminal=true,last_seq=$2 WHERE id=$1', [
    id,
    seq,
  ]);
  const text = (
    await db.query(
      "SELECT data->>'text' AS text FROM app.fsd_v1_chat_event WHERE turn_id=$1 AND type='message.delta' ORDER BY seq",
      [id],
    )
  ).rows
    .map((r) => r.text)
    .join('');
  task.messages.push({
    id: id + ':assistant',
    runId: id,
    role: 'assistant',
    content: text,
    status: 'cancelled',
    action: turn.input.action,
    createdAt: new Date().toISOString(),
  });
  task.status = 'WAITING';
  task.wait_reason = 'CHAT_READY';
  if (task.chat.pendingDesign) {
    Object.assign(task, task.chat.pendingDesign);
    delete task.chat.pendingDesign;
    await db.query('UPDATE app.fsd_v1_run SET expected_revision=$2 WHERE id=$1', [
      task.active_run_id,
      task.revision,
    ]);
  }
  await saveTask(db, task);
  return { cancelled: true };
}
