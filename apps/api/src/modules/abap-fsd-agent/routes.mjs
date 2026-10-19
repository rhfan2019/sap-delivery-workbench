import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { failure } from '../../platform/auth.mjs';
import { deniedError } from '../access/public.mjs';
import { createWorkContext } from '../item-workspace/public.mjs';
import { resolveAgentModel, listAgentModels } from '../models/public.mjs';
import {
  parseFile,
  openTurn,
  streamTurnEvents,
  answersText,
  sapSelector,
} from '../agent-core/public.mjs';
import { runTurn } from './loop.mjs';
import * as repo from './repository.mjs';

export const base = '/api/projects/:projectId/development-items/:itemId/abap-fsd-agent';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const running = new Map(); // turnId -> AbortController

const text = (value, name, max) => {
  if (typeof value !== 'string' || !value.trim()) throw failure(400, `请填写${name}。`);
  if (value.length > max) throw failure(400, `${name}过长。`);
  return value.trim();
};

export { answersText };

export function registerAbapFsdAgent(app, pool, organizationId, requireSession, deps = {}) {
  const c = createWorkContext(pool, organizationId, requireSession, 'design');
  const folder =
    process.env.ABAP_FSD_AGENT_FILES_DIR ??
    fileURLToPath(new URL('../../../../../.runtime/abap-fsd-agent-files/', import.meta.url));
  if (
    process.env.NODE_ENV === 'production' &&
    (!process.env.ABAP_FSD_AGENT_FILES_DIR || !isAbsolute(folder))
  )
    throw new Error('Production requires an absolute ABAP_FSD_AGENT_FILES_DIR.');

  async function session(req, writing) {
    await c.authorize(req, pool, writing);
    if (!UUID.test(req.params.sessionId)) throw failure(404, '会话不存在。');
    const s = await repo.findSession(pool, req.work.scope, req.params.sessionId);
    if (!s) throw failure(404, '会话不存在或不属于当前开发项。');
    return s;
  }

  app.addHook('onReady', async () => {
    await repo.interruptOrphanTurns(pool, organizationId);
  });

  app.get(base + '/sessions', async (req) => {
    await c.authorize(req, pool, false);
    const item = req.work.item;
    let model = null;
    try {
      model = (await (deps.resolveModel ?? resolveAgentModel)(pool, organizationId)).config.name;
    } catch {}
    return {
      project: { name: req.work.scope.projectName },
      item: {
        code: item.code,
        name: item.name,
        module: item.module,
        kind: item.kind,
        businessFunction: item.business_function ?? '',
      },
      canEdit: req.work.canEdit,
      canFinalize: req.work.canFinalize,
      stages: req.work.stages,
      model,
      sessions: await repo.listSessions(pool, req.work.scope),
    };
  });

  app.get(base + '/sessions/:sessionId/attachments/:attachmentId', async (req) => {
    const s = await session(req, false);
    const found = (await repo.listAttachments(pool, s.id, { withText: true })).find(
      (a) => a.id === req.params.attachmentId,
    );
    if (!found) throw failure(404, '附件不存在。');
    return found;
  });

  // The item drawer (docs/specs/agent-workspace-start-and-composer.md 6.4): the newest and the
  // final FSD, readable with agent.fsd:view alone; no conversation, no comments.
  app.get(base + '/outputs', async (req) => {
    await c.authorizeView(req);
    return repo.itemOutputs(pool, organizationId, req.work.item.id);
  });

  app.get(base + '/outputs/:sessionId/:version', async (req, reply) => {
    await c.authorizeView(req);
    const version = Number(req.params.version);
    const doc =
      UUID.test(req.params.sessionId) && Number.isInteger(version)
        ? await repo.itemDocument(
            pool,
            organizationId,
            req.work.item.id,
            req.params.sessionId,
            version,
          )
        : null;
    if (!doc) throw failure(404, '文档版本不存在。');
    if (req.query?.download) {
      const name = `${req.work.scope.itemCode}-FSD-v${doc.version}.md`;
      reply
        .header('Content-Type', 'text/markdown; charset=utf-8')
        .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
      return doc.markdown;
    }
    return {
      sessionId: doc.sessionId,
      version: doc.version,
      labels: doc.labels,
      markdown: doc.markdown,
    };
  });

  // Models the composer offers, fetched each time the picker opens (spec 4.3).
  app.get(base + '/models', async (req) => {
    await c.authorize(req, pool, false);
    return (deps.listModels ?? listAgentModels)(pool, organizationId);
  });

  app.post(base + '/sessions', async (req, reply) => {
    await c.authorize(req, pool, true);
    const id = await repo.createSession(pool, req.work.scope, String(req.body?.title ?? ''));
    reply.code(201);
    return repo.findSession(pool, req.work.scope, id);
  });

  app.patch(base + '/sessions/:sessionId', async (req) => {
    const s = await session(req, true);
    await repo.renameSession(pool, req.work.scope, s.id, text(req.body?.title, '对话名称', 200));
    return repo.findSession(pool, req.work.scope, s.id);
  });

  app.get(base + '/sessions/:sessionId', async (req) => {
    const s = await session(req, false);
    return {
      session: s,
      canEdit: req.work.canEdit,
      canFinalize: req.work.canFinalize,
      messages: await repo.listMessages(pool, s.id),
      turns: await repo.listTurns(pool, s.id),
      toolCalls: await repo.listToolCalls(pool, s.id),
      document: (await repo.latestDocument(pool, s.id)) ?? null,
      documents: await repo.listDocuments(pool, s.id),
      comments: await repo.listComments(pool, s.id),
      attachments: await repo.listAttachments(pool, s.id),
    };
  });

  app.post(base + '/sessions/:sessionId/messages', { bodyLimit: 200000 }, async (req, reply) => {
    const s = await session(req, true);
    const answers = Array.isArray(req.body?.answers) ? req.body.answers.slice(0, 5) : null;
    const content = answers?.length
      ? answersText(answers) + (req.body?.content?.trim() ? '\n\n' + req.body.content.trim() : '')
      : text(req.body?.content, '消息', 100000);
    const environment = sapSelector(req.body?.sapSystemId, 'test');
    // The model the user picked for this message, else the organization default (spec 4.3).
    const model = await (deps.resolveModel ?? resolveAgentModel)(
      pool,
      organizationId,
      req.body?.modelId || undefined,
    );
    const turnId = randomUUID();
    const claimed = await repo.claimTurn(pool, s.id, turnId, req.work.scope.actorId, {
      versionId: model.versionId,
      name: model.config.name,
      modelId: model.config.modelId,
      sap: environment.systemId ?? environment.purpose,
    });
    if (!claimed) throw failure(409, '上一轮还在进行中，请等待完成或先停止。');
    await repo.appendMessage(pool, s.id, {
      turnId,
      role: 'user',
      content,
      payload: answers?.length ? { answers } : {},
      actorId: req.work.scope.actorId,
    });
    if (!s.title)
      await pool.query('UPDATE app.abap_fsd_agent_session SET title=$2 WHERE id=$1', [
        s.id,
        content.slice(0, 60),
      ]);
    const emit = openTurn(turnId);
    const controller = new AbortController();
    running.set(turnId, controller);
    const scope = req.work.scope;
    Promise.resolve()
      .then(() =>
        (deps.runTurn ?? runTurn)({
          pool,
          scope,
          sessionId: s.id,
          turnId,
          model,
          emit,
          signal: controller.signal,
          environment,
          deps: deps.loop,
        }),
      )
      .catch(async (e) => {
        // Failures before the loop could take over (e.g. reading the session) still end the turn.
        const error = { code: e.code ?? 'ERROR', message: String(e.message).slice(0, 500) };
        await repo
          .finishTurn(pool, s.id, turnId, { status: 'failed', stopReason: 'error', error })
          .catch(() => {});
        emit('turn.end', { status: 'failed', stopReason: 'error', error });
      })
      .finally(() => running.delete(turnId));
    reply.code(202);
    return { turnId };
  });

  app.post(base + '/sessions/:sessionId/cancel', async (req) => {
    const s = await session(req, true);
    if (s.activeTurnId) running.get(s.activeTurnId)?.abort();
    return { cancelled: !!s.activeTurnId };
  });

  // SSE for one turn. `after` resumes after the last event sequence the client saw.
  app.get(base + '/sessions/:sessionId/turns/:turnId/events', async (req, reply) => {
    const s = await session(req, false);
    if (!UUID.test(req.params.turnId)) throw failure(404, '运行不存在。');
    const after = Math.max(0, Number(req.query?.after) || 0);
    await streamTurnEvents(reply, req.params.turnId, after, async () =>
      (await repo.listTurns(pool, s.id)).find((t) => t.id === req.params.turnId),
    );
  });

  app.get(base + '/sessions/:sessionId/comments', async (req) => {
    const s = await session(req, false);
    return repo.listComments(pool, s.id);
  });

  app.post(base + '/sessions/:sessionId/comments', async (req, reply) => {
    const s = await session(req, true);
    const version = Number(req.body?.anchorVersion);
    if (!Number.isInteger(version) || !(await repo.getDocument(pool, s.id, version)))
      throw failure(400, '批注所在的文档版本不存在。');
    const id = await repo.addComment(pool, s.id, {
      anchorText: text(req.body?.anchorText, '批注原文', 5000),
      anchorVersion: version,
      body: text(req.body?.body, '批注内容', 5000),
      actorId: req.work.scope.actorId,
    });
    reply.code(201);
    return (await repo.listComments(pool, s.id)).find((x) => x.id === id);
  });

  app.patch(base + '/sessions/:sessionId/comments/:commentId', async (req) => {
    const s = await session(req, true);
    const status = req.body?.status;
    if (!['open', 'resolved'].includes(status)) throw failure(400, '批注状态无效。');
    if (
      !UUID.test(req.params.commentId) ||
      !(await repo.setCommentStatus(pool, s.id, req.params.commentId, status))
    )
      throw failure(404, '批注不存在。');
    return { status };
  });

  app.get(base + '/sessions/:sessionId/documents', async (req) => {
    const s = await session(req, false);
    return repo.listDocuments(pool, s.id);
  });

  app.get(base + '/sessions/:sessionId/documents/:version', async (req) => {
    const s = await session(req, false);
    const doc = await repo.getDocument(pool, s.id, Number(req.params.version));
    if (!doc) throw failure(404, '文档版本不存在。');
    return doc;
  });

  app.post(base + '/sessions/:sessionId/documents/:version/labels', async (req) => {
    const s = await session(req, true);
    // Labels mark a version final (定稿): contract 3.5, agent.fsd:finalize.
    if (!req.work.canFinalize) throw deniedError('agent.fsd:finalize');
    const labels = Array.isArray(req.body?.labels)
      ? [...new Set(req.body.labels.map((l) => String(l).trim()).filter(Boolean))].slice(0, 10)
      : null;
    if (!labels || labels.some((l) => l.length > 30)) throw failure(400, '标签无效。');
    if (!(await repo.setLabels(pool, s.id, Number(req.params.version), labels)))
      throw failure(404, '文档版本不存在。');
    return { labels };
  });

  app.get(base + '/sessions/:sessionId/export', async (req, reply) => {
    const s = await session(req, false);
    const doc = req.query?.version
      ? await repo.getDocument(pool, s.id, Number(req.query.version))
      : await repo.latestDocument(pool, s.id);
    if (!doc) throw failure(404, '还没有文档。');
    const name = `${req.work.scope.itemCode}-FSD-v${doc.version}.md`;
    reply
      .header('Content-Type', 'text/markdown; charset=utf-8')
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    return doc.markdown;
  });

  app.post(
    base + '/sessions/:sessionId/attachments',
    { bodyLimit: 15 * 1024 * 1024 },
    async (req, reply) => {
      const s = await session(req, true);
      const fileName = text(req.body?.fileName, '文件名', 200).replace(/[\\/:*?"<>|]/g, '_');
      const bytes = Buffer.from(String(req.body?.contentBase64 ?? ''), 'base64');
      if (!bytes.length) throw failure(400, '文件为空。');
      if (bytes.length > MAX_FILE_BYTES) throw failure(413, '单个文件不能超过 10MB。');
      const id = randomUUID();
      const dir = join(folder, organizationId, s.id);
      await mkdir(dir, { recursive: true });
      const path = join(dir, id);
      await writeFile(path, bytes, { flag: 'wx' });
      const parsed = await (deps.parseFile ?? parseFile)(path, fileName);
      const extracted = (parsed.regions ?? []).map((r) => r.text).join('\n\n');
      await repo.addAttachment(pool, s.id, {
        id,
        fileName,
        size: bytes.length,
        storageKey: join(organizationId, s.id, id),
        parseState: parsed.state,
        text: extracted,
        warnings: parsed.warnings ?? [],
        actorId: req.work.scope.actorId,
      });
      reply.code(201);
      return (await repo.listAttachments(pool, s.id)).find((a) => a.id === id);
    },
  );
}
