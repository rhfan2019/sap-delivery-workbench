import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import {
  createWorkContext,
  resolveWorkAction,
  assistantWorkspaceContext,
  adoptAssistantContent,
} from '../item-workspace/public.mjs';
import { getModel } from '../models/public.mjs';
import { assetManifest } from './assets.mjs';
import { fault, hash } from './policy.mjs';
import {
  createChatConversation,
  startChatTurn,
  chatRunSnapshot,
  loadConversation,
  cancelChatTurn,
} from './chat-service.mjs';
import { loadTurn, readChatEvents } from './chat-events.mjs';
import { chatWorkflow, chatWorkflowCommand, chatArtifact } from './chat-workflow.mjs';
import { registeredTarget } from './sap.mjs';
import { registerChatFiles } from './chat-files.mjs';
import {
  listLegacyChatSessions,
  legacyChatRun,
  legacyChatArtifact,
  legacyChatWorkflow,
  legacyChatSession,
} from './chat-legacy.mjs';
import { saveTask, event, dedupe } from './repository.mjs';

export function registerChatRoutes(app, pool, org, requireSession, base) {
  const c = createWorkContext(pool, org, requireSession);
  const authorize = async (req, db = pool) => {
    req.params.stage = 'design';
    await c.authorize(req, db);
    return req.work.scope;
  };
  const write = (req, operation) => {
    req.params.stage = 'design';
    return c.write(req, 'fsd.v1.chat.command', 'development_item', async (db) => ({
      subjectId: req.params.itemId,
      data: await operation(db, req.work.scope),
    }));
  };
  registerChatFiles(app, pool, base, { authorize, write });
  const fallback = async (current, legacy) => {
    try {
      return await current();
    } catch (error) {
      if (error.code !== 'NOT_FOUND') throw error;
      return legacy();
    }
  };
  const handoff = async (db, scope, id) => {
    const prior = await fallback(
      () => loadConversation(db, scope, id),
      () => legacyChatSession(db, scope, id),
    );
    let messages = prior.messages;
    if (!messages) {
      const sessions = await listLegacyChatSessions(db, scope);
      const latest = sessions.find((s) => s.id === id);
      messages = latest?.runId ? (await legacyChatRun(db, scope, latest.runId)).history : [];
    }
    return messages
      .filter((m) => m.role === 'user' && m.content)
      .slice(-6)
      .map((m) => m.content.slice(0, 700))
      .join('\n');
  };
  app.post(base + '/conversations', (req) =>
    write(req, async (db, scope) => {
      const t = await createChatConversation(
        db,
        scope,
        await assetManifest({ mode: 'REAL', id: 'unselected' }),
      );
      if (req.body?.handoffFrom) {
        t.chat.context = { summary: await handoff(db, scope, req.body.handoffFrom) };
        t.messages = [
          {
            id: t.id + ':handoff',
            role: 'user',
            content: t.chat.context.summary,
            status: 'completed',
          },
        ];
        await saveTask(db, t);
      }
      return { conversationId: t.id };
    }),
  );
  app.get(base + '/sessions', async (req) => {
    const scope = await authorize(req);
    return {
      items: [
        ...(
          await pool.query(
            `SELECT t.id,t.state->'chat'->>'title' AS title,t.created_at,c.id AS "runId" FROM app.fsd_v1_task t LEFT JOIN LATERAL (SELECT id FROM app.fsd_v1_chat_turn WHERE task_id=t.id ORDER BY created_at DESC,id DESC LIMIT 1) c ON true WHERE t.organization_id=$1 AND t.project_id=$2 AND t.item_id=$3 AND t.actor_id=$4 AND t.state ? 'chat' ORDER BY t.updated_at DESC LIMIT 100`,
            [org, scope.projectId, scope.itemId, scope.actorId],
          )
        ).rows,
        ...(await listLegacyChatSessions(pool, scope)),
      ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)),
    };
  });
  app.post(base + '/runs', { bodyLimit: 500000 }, (req) =>
    write(req, async (db, scope) =>
      dedupe(
        db,
        scope,
        { request_id: req.body?.requestId, operation: 'chat.http', body: req.body },
        async () => {
          if (process.env.FSD_REAL_INPUT_APPROVED !== 'true')
            throw fault('REAL_INPUT_NOT_APPROVED', 'INPUT', 409);
          const selected = await getModel(db, org, req.body?.modelId);
          const assets = await assetManifest({
            mode: 'REAL',
            version_id: selected.versionId,
            id: selected.config.modelId,
            protocol: selected.config.protocol,
            config_hash: hash(selected.config),
          });
          const selection = c.selection(req, req.body?.selection);
          let action =
            req.body.action === 'auto' || !req.body.action
              ? resolveWorkAction(req.body.prompt ?? '')
              : req.body.action;
          let task = req.body.conversationId
            ? await fallback(
                () => loadConversation(db, scope, req.body.conversationId),
                async () => {
                  const summary = await handoff(db, scope, req.body.conversationId);
                  const t = await createChatConversation(db, scope, assets);
                  t.messages = [
                    { id: t.id + ':handoff', role: 'user', content: summary, status: 'completed' },
                  ];
                  await saveTask(db, t);
                  return t;
                },
              )
            : null;
          if (req.body.prompt?.trim() === '基于已确认初稿生成正式版') action = 'draft';
          const target =
            action === 'draft' && !req.body.resumeRunId && !task?.chat.draftApproved
              ? await registeredTarget(
                  scope,
                  task?.target.target_ref === 'chat' ? undefined : task?.target.target_ref,
                )
              : null;
          return startChatTurn(
            db,
            scope,
            {
              ...req.body,
              requestId: randomUUID(),
              conversationId: task?.id,
              action,
              selection,
              workspaceVersionId: (await assistantWorkspaceContext(db, scope))?.draftVersionId,
            },
            assets,
            target,
          );
        },
      ),
    ),
  );
  app.get(base + '/runs/:runId', async (req) => {
    const scope = await authorize(req);
    return fallback(
      () => chatRunSnapshot(pool, scope, req.params.runId),
      () => legacyChatRun(pool, scope, req.params.runId),
    );
  });
  app.get(base + '/runs/:runId/markdown', async (req, reply) => {
    const scope = await authorize(req);
    const run = await fallback(
      () => chatRunSnapshot(pool, scope, req.params.runId),
      () => legacyChatRun(pool, scope, req.params.runId),
    );
    const message = run.history.find((m) => m.role === 'assistant' && m.runId === req.params.runId);
    const markdown = message?.artifact?.markdown ?? message?.content ?? run.snapshot.text ?? '';
    return reply
      .header('Content-Type', 'text/markdown; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="run-${req.params.runId}.md"`)
      .send(markdown);
  });
  app.get(base + '/runs/:runId/diagnostics', async (req) => {
    const scope = await authorize(req);
    const snapshot = await fallback(
      () => chatRunSnapshot(pool, scope, req.params.runId),
      () => legacyChatRun(pool, scope, req.params.runId),
    );
    if (snapshot.legacy)
      return {
        ...snapshot,
        prompt: snapshot.snapshot.prompt,
        context: { legacy: true },
        technicalOutput: snapshot.snapshot.text,
        plan: snapshot.snapshot.plan,
        rendered: snapshot.artifact,
      };
    const turn = await loadTurn(pool, scope, req.params.runId);
    const run = (await pool.query('SELECT * FROM app.fsd_v1_run WHERE id=$1', [turn.run_id]))
      .rows[0];
    const timeline = (
      await pool.query(
        "SELECT event_type,data,created_at FROM app.fsd_v1_event WHERE run_id=$1 AND event_type IN ('node.started','node.completed') ORDER BY sequence",
        [turn.run_id],
      )
    ).rows;
    const steps = timeline
      .filter((e) => e.event_type === 'node.started')
      .map((e) => {
        const end = timeline.findLast(
          (c) => c.event_type === 'node.completed' && c.data.node_id === e.data.node_id,
        );
        return {
          stepId: e.data.node_id,
          title: e.data.node_id,
          status: end ? 'succeeded' : snapshot.state === 'running' ? 'running' : 'failed',
          startedAt: e.created_at,
          finishedAt: end?.created_at,
        };
      });
    await event(pool, turn.task_id, turn.run_id, 'diagnostic.viewed', {}, scope.actorId);
    return {
      runId: turn.id,
      conversationId: turn.task_id,
      state: snapshot.state,
      createdAt: turn.created_at,
      model: { provider: run.assets.model.protocol, modelId: run.assets.model.id },
      prompt: turn.input.prompt,
      context: {
        logicalRunId: run.id,
        threadId: run.thread_id,
        inputSnapshotId: run.input_snapshot_id,
        promptHash: run.assets.chat_prompt_hash ?? run.assets.prompt_hash,
        graph: run.assets.graph,
        budget: run.state.budget,
      },
      plan: { steps },
      failure: run.state.error,
      rendered: snapshot.artifact,
      technicalOutput: snapshot.snapshot.text,
    };
  });
  app.post(base + '/runs/:runId/cancel', (req) =>
    write(req, (db, scope) => cancelChatTurn(db, scope, req.params.runId)),
  );
  app.get(base + '/conversations/:conversationId/workflow', async (req) => {
    const scope = await authorize(req);
    return fallback(
      () => chatWorkflow(pool, scope, req.params.conversationId),
      () => legacyChatWorkflow(pool, scope, req.params.conversationId),
    );
  });
  app.post(base + '/conversations/:conversationId/workflow', (req) =>
    write(req, (db, scope) => chatWorkflowCommand(db, scope, req.params.conversationId, req.body)),
  );
  app.get(base + '/artifacts/:artifactId', async (req) => {
    const scope = await authorize(req);
    const task = (
      await pool.query(
        "SELECT id FROM app.fsd_v1_task WHERE organization_id=$1 AND project_id=$2 AND item_id=$3 AND actor_id=$4 AND state ? 'chat' AND EXISTS(SELECT 1 FROM jsonb_array_elements(state->'artifacts') a WHERE a->>'id'=$5)",
        [org, scope.projectId, scope.itemId, scope.actorId, req.params.artifactId],
      )
    ).rows[0];
    if (!task) return legacyChatArtifact(pool, scope, req.params.artifactId);
    return chatArtifact(
      (await loadConversation(pool, scope, task.id)).artifacts.find(
        (a) => a.id === req.params.artifactId,
      ),
    );
  });
  app.post(base + '/adopt', (req) =>
    write(req, async (db, scope) => {
      const row = (
        await db.query(
          "SELECT id FROM app.fsd_v1_task WHERE organization_id=$1 AND project_id=$2 AND item_id=$3 AND actor_id=$4 AND state ? 'chat' AND EXISTS(SELECT 1 FROM jsonb_array_elements(state->'artifacts') a WHERE a->>'id'=$5)",
          [org, scope.projectId, scope.itemId, scope.actorId, req.body?.artifactId],
        )
      ).rows[0];
      const task = row ? await loadConversation(db, scope, row.id, true) : null;
      const raw = task?.artifacts.find((a) => a.id === req.body.artifactId);
      const artifact = raw
        ? chatArtifact(raw)
        : await legacyChatArtifact(db, scope, req.body?.artifactId);
      const adopted = await adoptAssistantContent(db, scope, req.work.item, {
        baseVersionId: req.body.baseVersionId,
        basisVersionId: raw?.workspace_version_id ?? artifact.manifest?.workContext?.draftVersionId,
        artifact,
      });
      if (task)
        await event(
          db,
          task.id,
          null,
          'artifact.adopted',
          {
            artifact_id: raw.id,
            artifact_version: raw.version,
            workspace_version_id: adopted.versionId,
          },
          scope.actorId,
        );
      return adopted.state;
    }),
  );
  app.get(base + '/runs/:runId/events', async (req, reply) => {
    let scope = await authorize(req);
    const id = req.params.runId;
    const raw = String(req.query.after ?? req.headers['last-event-id'] ?? '0');
    if (!/^\d{1,10}$/.test(raw)) throw fault('INVALID_CURSOR');
    let cursor = Number(raw);
    const turn = await loadTurn(pool, scope, id);
    if (cursor > turn.last_seq) throw fault('INVALID_CURSOR');
    let closed = false;
    const disconnect = () => {
      closed = true;
    };
    reply.raw.once('close', disconnect);
    async function* events() {
      try {
        let heartbeat = Date.now();
        while (!closed) {
          // Revalidate session/project access throughout a long-lived subscription.
          scope = await authorize(req);
          const batch = await readChatEvents(pool, scope, id, cursor);
          for (const event of batch) {
            cursor = event.seq;
            yield `id: ${cursor}\ndata: ${JSON.stringify(event)}\n\n`;
            if (event.type.startsWith('run.')) return;
          }
          if ((await loadTurn(pool, scope, id)).terminal && batch.length === 0) return;
          if (Date.now() - heartbeat > 10000) {
            yield ': keepalive\n\n';
            heartbeat = Date.now();
          }
          await delay(100);
        }
      } finally {
        reply.raw.off('close', disconnect);
      }
    }
    return reply
      .header('Content-Type', 'text/event-stream; charset=utf-8')
      .header('Cache-Control', 'no-cache, no-transform')
      .header('X-Accel-Buffering', 'no')
      .send(Readable.from(events()));
  });
}
