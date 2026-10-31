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
  referenceCatalog,
  resolveReferences,
  REFERENCE_KINDS,
  sessionPatch,
  changeSession,
  assertSessionOpen,
} from '../agent-core/public.mjs';
import { diffLines } from './artifacts.mjs';
import { SUPPORTED_KINDS } from './context.mjs';
import { runTurn } from './loop.mjs';
import * as repo from './repository.mjs';

// The development assistant reads the item's files and FSD versions by itself (materials.mjs),
// so only the business function and other conversations' files are referenced.
const REFERENCES = ['business_function', 'session_file'];
export const base = '/api/projects/:projectId/development-items/:itemId/abap-dev-agent';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const running = new Map(); // turnId -> AbortController

const text = (value, name, max) => {
  if (typeof value !== 'string' || !value.trim()) throw failure(400, `请填写${name}。`);
  if (value.length > max) throw failure(400, `${name}过长。`);
  return value.trim();
};
const target = (value) => {
  if (!['plan', 'code'].includes(value)) throw failure(400, '批注对象必须是开发方案或代码。');
  return value;
};

export function registerAbapDevAgent(app, pool, organizationId, requireSession, deps = {}) {
  const c = createWorkContext(pool, organizationId, requireSession, 'development');
  const folder =
    process.env.ABAP_DEV_AGENT_FILES_DIR ??
    fileURLToPath(new URL('../../../../../.runtime/abap-dev-agent-files/', import.meta.url));
  if (
    process.env.NODE_ENV === 'production' &&
    (!process.env.ABAP_DEV_AGENT_FILES_DIR || !isAbsolute(folder))
  )
    throw new Error('Production requires an absolute ABAP_DEV_AGENT_FILES_DIR.');

  async function session(req, writing) {
    await c.authorize(req, pool, writing);
    if (!UUID.test(req.params.sessionId)) throw failure(404, '会话不存在。');
    const s = await repo.findSession(pool, req.work.scope, req.params.sessionId);
    if (!s) throw failure(404, '会话不存在或不属于当前开发项。');
    return s;
  }
  const version = async (s, value) => {
    const v = await repo.getVersion(pool, s.id, Number(value));
    if (!v) throw failure(404, '版本不存在。');
    return v;
  };

  app.addHook('onReady', async () => {
    await repo.interruptOrphanTurns(pool, organizationId);
  });

  app.get(base + '/sessions', async (req) => {
    await c.authorize(req, pool, false);
    const { scope, item } = req.work;
    let model = null;
    try {
      model = (await (deps.resolveModel ?? resolveAgentModel)(pool, organizationId)).config.name;
    } catch {}
    return {
      project: { name: scope.projectName },
      item: {
        code: item.code,
        name: item.name,
        module: item.module,
        kind: item.kind,
        changeType: item.change_type,
        transactionCode: item.transaction_code ?? '',
        businessFunction: item.business_function ?? '',
        objects: await c.itemObjects(pool, item.id),
      },
      supported: !!SUPPORTED_KINDS[item.kind],
      canEdit: req.work.canEdit,
      canFinalize: req.work.canFinalize,
      stages: req.work.stages,
      model,
      sessions: await repo.listSessions(pool, scope),
    };
  });

  // The item drawer (docs/specs/agent-workspace-start-and-composer.md 6.4): the newest and the
  // final plan and code, readable with agent.dev:view alone; no conversation, no comments.
  app.get(base + '/outputs', async (req) => {
    await c.authorizeView(req);
    return repo.itemOutputs(pool, organizationId, req.work.item.id);
  });

  app.get(base + '/outputs/:sessionId/:version', async (req, reply) => {
    await c.authorizeView(req);
    const number = Number(req.params.version);
    const v =
      UUID.test(req.params.sessionId) && Number.isInteger(number)
        ? await repo.itemVersion(
            pool,
            organizationId,
            req.work.item.id,
            req.params.sessionId,
            number,
          )
        : null;
    if (!v) throw failure(404, '版本不存在。');
    if (req.query?.download) {
      const t = target(req.query.download);
      if (!v[t]) throw failure(404, t === 'code' ? '还没有代码。' : '还没有开发方案。');
      const name =
        t === 'code'
          ? `${req.work.scope.itemCode}-v${v.version}.abap`
          : `${req.work.scope.itemCode}-开发方案-v${v.version}.md`;
      reply
        .header('Content-Type', `${t === 'code' ? 'text/plain' : 'text/markdown'}; charset=utf-8`)
        .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
      return v[t];
    }
    return v;
  });

  // Models the composer offers, fetched each time the picker opens (spec 4.3).
  app.get(base + '/models', async (req) => {
    await c.authorize(req, pool, false);
    return (deps.listModels ?? listAgentModels)(pool, organizationId);
  });

  // Item materials a message may reference instead of uploading again (spec 4.2).
  const NO_SESSION = '00000000-0000-0000-0000-000000000000';
  async function referenceSources(req, sessionId) {
    const files = REFERENCES.includes('item_file') ? await c.itemFiles(pool, req.work.item.id) : [];
    const others = await repo.itemAttachments(pool, req.work.scope, sessionId ?? NO_SESSION);
    return { item: req.work.item, files, others, kinds: REFERENCES };
  }
  app.get(base + '/references', async (req) => {
    await c.authorize(req, pool, false);
    const sid = UUID.test(String(req.query?.session ?? '')) ? req.query.session : null;
    return { groups: referenceCatalog(await referenceSources(req, sid)) };
  });

  app.post(base + '/sessions', async (req, reply) => {
    await c.authorize(req, pool, true);
    const id = await repo.createSession(pool, req.work.scope, String(req.body?.title ?? ''));
    reply.code(201);
    return repo.findSession(pool, req.work.scope, id);
  });

  app.patch(base + '/sessions/:sessionId', async (req) => {
    const s = await session(req, true);
    const scope = req.work.scope;
    await changeSession(pool, {
      scope,
      session: s,
      patch: sessionPatch(req.body),
      rename: (id, title) => repo.renameSession(pool, scope, id, title),
      setArchived: (id, archived) => repo.setArchived(pool, scope, id, archived),
      subject: 'abap_dev_agent_session',
    });
    return repo.findSession(pool, scope, s.id);
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
      version: (await repo.latestVersion(pool, s.id)) ?? null,
      versions: await repo.listVersions(pool, s.id),
      comments: await repo.listComments(pool, s.id),
      attachments: await repo.listAttachments(pool, s.id),
    };
  });

  app.post(base + '/sessions/:sessionId/messages', { bodyLimit: 200000 }, async (req, reply) => {
    const s = await session(req, true);
    assertSessionOpen(s);
    const answers = Array.isArray(req.body?.answers) ? req.body.answers.slice(0, 5) : null;
    const content = answers?.length
      ? answersText(answers) + (req.body?.content?.trim() ? '\n\n' + req.body.content.trim() : '')
      : text(req.body?.content, '消息', 100000);
    const environment = sapSelector(req.body?.sapSystemId, 'development');
    // Referenced item materials become this session's attachments, once per source.
    if (Array.isArray(req.body?.references) && req.body.references.length) {
      const rows = await resolveReferences(req.body.references, {
        ...(await referenceSources(req, s.id)),
        ...(deps.parseFile ? { parse: deps.parseFile } : {}),
      });
      for (const r of rows)
        if (!(await repo.findReferenced(pool, s.id, r.storageKey)))
          await repo.addAttachment(pool, s.id, {
            id: randomUUID(),
            ...r,
            actorId: req.work.scope.actorId,
          });
    }
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
    if (!claimed) {
      // Archived between reading the session and claiming it.
      assertSessionOpen((await repo.findSession(pool, req.work.scope, s.id)) ?? s);
      throw failure(409, '上一轮还在进行中，请等待完成或先停止。');
    }
    await repo.appendMessage(pool, s.id, {
      turnId,
      role: 'user',
      content,
      payload: answers?.length ? { answers } : {},
      actorId: req.work.scope.actorId,
    });
    if (!s.title) await repo.setTitle(pool, s.id, content);
    const emit = openTurn(turnId);
    const controller = new AbortController();
    running.set(turnId, controller);
    const scope = req.work.scope;
    Promise.resolve()
      .then(() =>
        (deps.runTurn ?? runTurn)({
          pool,
          work: c,
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
    const t = target(req.body?.target);
    const v = await version(s, req.body?.anchorVersion);
    const anchorText = text(req.body?.anchorText, '批注原文', 5000);
    if (!v[t].includes(anchorText)) throw failure(400, '批注原文不在该版本中。');
    const line = Number(req.body?.anchorLine);
    const id = await repo.addComment(pool, s.id, {
      target: t,
      anchorText,
      anchorVersion: v.version,
      anchorLine: t === 'code' && Number.isInteger(line) && line > 0 ? line : null,
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

  app.get(base + '/sessions/:sessionId/versions', async (req) => {
    const s = await session(req, false);
    return repo.listVersions(pool, s.id);
  });

  app.get(base + '/sessions/:sessionId/versions/:version', async (req) => {
    const s = await session(req, false);
    return version(s, req.params.version);
  });

  // Line diff of the plan or the code between two versions (`from` empty = from nothing).
  app.get(base + '/sessions/:sessionId/diff', async (req) => {
    const s = await session(req, false);
    const t = target(req.query?.target ?? 'code');
    const to = await version(s, req.query?.to);
    const from = req.query?.from ? await version(s, req.query.from) : null;
    return {
      target: t,
      from: from?.version ?? null,
      to: to.version,
      ...diffLines(from?.[t] ?? '', to[t]),
    };
  });

  app.post(base + '/sessions/:sessionId/versions/:version/labels', async (req) => {
    const s = await session(req, true);
    // Labels mark a version final (定稿): contract 3.5, agent.dev:finalize.
    if (!req.work.canFinalize) throw deniedError('agent.dev:finalize');
    const labels = Array.isArray(req.body?.labels)
      ? [...new Set(req.body.labels.map((l) => String(l).trim()).filter(Boolean))].slice(0, 10)
      : null;
    if (!labels || labels.some((l) => l.length > 30)) throw failure(400, '标签无效。');
    if (
      !(await repo.setLabels(
        pool,
        s.id,
        Number(req.params.version),
        labels,
        req.work.scope.actorId,
      ))
    )
      throw failure(404, '版本不存在。');
    return { labels };
  });

  app.get(base + '/sessions/:sessionId/export', async (req, reply) => {
    const s = await session(req, false);
    const t = target(req.query?.target ?? 'code');
    const v = req.query?.version
      ? await version(s, req.query.version)
      : await repo.latestVersion(pool, s.id);
    if (!v?.[t]) throw failure(404, t === 'code' ? '还没有代码。' : '还没有开发方案。');
    const name =
      t === 'code'
        ? `${req.work.scope.itemCode}-v${v.version}.abap`
        : `${req.work.scope.itemCode}-开发方案-v${v.version}.md`;
    reply
      .header('Content-Type', `${t === 'code' ? 'text/plain' : 'text/markdown'}; charset=utf-8`)
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    return v[t];
  });

  app.get(base + '/sessions/:sessionId/attachments/:attachmentId', async (req) => {
    const s = await session(req, false);
    const found = (await repo.listAttachments(pool, s.id, { withText: true })).find(
      (a) => a.id === req.params.attachmentId,
    );
    if (!found) throw failure(404, '附件不存在。');
    return found;
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
