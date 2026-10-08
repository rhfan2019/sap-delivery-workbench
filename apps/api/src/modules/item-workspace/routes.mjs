import { randomUUID } from 'node:crypto';
import { deliveryContext } from '../delivery/context.mjs';
import { failure } from '../../platform/auth.mjs';
import { findWorkspace } from '../fs-workspace/workspace/repository.mjs';
import { initialize, snapshot, appendVersion, version, viewVersion } from './service.mjs';
import { listModels } from '../models/store.mjs';
import { readSessionState } from '../agent-runtime/session-state.mjs';
import { sha256 } from '../agent-runtime/specification.mjs';
import { registerConversationFiles } from './conversations.mjs';

export const workBase = '/api/projects/:projectId/development-items/:itemId/work/:stage';
export function createWorkContext(pool, organizationId, requireSession) {
  const delivery = deliveryContext(pool, organizationId, requireSession);
  async function authorize(req, db = pool, writing = !['GET', 'HEAD'].includes(req.method)) {
    if (!['design', 'development'].includes(req.params.stage))
      throw failure(404, '工作阶段不存在。');
    const current = await requireSession(req, true);
    const project = await delivery.access(db, current, req.params.projectId, writing);
    const item = await delivery.item(
      db,
      { params: { ...req.params, id: req.params.itemId } },
      writing,
    );
    const owner =
      req.params.stage === 'design'
        ? (item.business_owner_id ?? item.created_by)
        : (item.developer_id ?? item.created_by);
    const canEdit =
      project.status !== 'archived' &&
      (project.access_level === 'admin' || owner === current.user.id);
    if (writing && !canEdit) throw failure(403, '仅本阶段负责人或项目内管理员可修改。');
    req.work = {
      current,
      item,
      canEdit,
      scope: {
        organizationId,
        projectId: project.id,
        projectName: project.name,
        itemId: item.id,
        actorId: current.user.id,
        sessionId: current.sessionId,
      },
    };
    return current;
  }
  async function write(req, action, subjectType, operation, transactionOptions) {
    return delivery.write(
      req,
      async (db) => {
        await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          organizationId + ':' + req.params.itemId,
        ]);
        const current = await authorize(req, db, true);
        const result = await operation(db, current);
        await db.query(
          "INSERT INTO app.audit_event(organization_id,actor_user_id,action,outcome,subject_type,subject_id,request_id) VALUES($1,$2,$3,'success',$4,$5,$6)",
          [organizationId, current.user.id, action, subjectType, result.subjectId, randomUUID()],
        );
        return result.data;
      },
      transactionOptions,
    );
  }
  function assertConversation(req, session) {
    const s = session.selection;
    if (
      s.projectId !== req.params.projectId ||
      s.itemId !== req.params.itemId ||
      s.workspaceStage !== req.params.stage
    )
      throw failure(404, '会话不属于当前开发项与阶段。');
  }
  function selection(req, input = {}) {
    if (
      (input.projectId && input.projectId !== req.params.projectId) ||
      (input.itemId && input.itemId !== req.params.itemId) ||
      (input.workspaceStage && input.workspaceStage !== req.params.stage)
    )
      throw failure(409, '会话目标与工作区不一致。');
    return {
      ...input,
      projectId: req.params.projectId,
      itemId: req.params.itemId,
      itemRowVersion: String(req.work.item.row_version),
      workspaceStage: req.params.stage,
    };
  }
  return { pool, organizationId, delivery, authorize, write, assertConversation, selection };
}
export function registerItemWorkspaceRoutes(app, pool, org, requireSession) {
  const c = createWorkContext(pool, org, requireSession);
  registerConversationFiles(app, c, workBase);
  const state = (req) =>
    snapshot(pool, req.work.scope, req.params.stage, req.work.item, req.work.canEdit);
  app.get(workBase, async (req) => {
    await c.authorize(req);
    return state(req);
  });
  app.post(workBase, async (req) =>
    c.write(req, 'item_work.initialize', 'development_item', async (db) => {
      await initialize(db, req.work.scope, req.params.stage, req.work.item);
      return {
        subjectId: req.params.itemId,
        data: await snapshot(db, req.work.scope, req.params.stage, req.work.item, req.work.canEdit),
      };
    }),
  );
  app.patch(workBase, { bodyLimit: 2000000 }, async (req) =>
    c.write(req, 'item_work.save', 'development_item', async (db) => {
      if (
        !req.body ||
        Object.keys(req.body).some(
          (k) => !['baseVersionId', 'document', 'designVersionId'].includes(k),
        )
      )
        throw failure(400, '工作稿保存字段无效。');
      const ws = await findWorkspace(db, req.work.scope);
      if (!ws) throw failure(404, '请先启用工作区。');
      if (req.params.stage === 'design' && req.body.document?.spec) {
        const old = await version(db, ws.id, req.body.baseVersionId, 'design');
        const previous = old.document.spec,
          spec = req.body.document.spec;
        if (
          !previous ||
          ['systemContext', 'evidence', 'specId', 'revision'].some(
            (k) => sha256(spec[k] ?? null) !== sha256(previous[k] ?? null),
          )
        )
          throw failure(422, '系统核验证据与版本标识不可手工改写；请在工作备注中记录待核实信息。');
        for (const object of spec.sapObjects ?? []) {
          const prior = previous.sapObjects?.find((o) => o.id === object.id);
          if (
            prior &&
            ['verificationStatus', 'verificationScope', 'evidenceIds'].some(
              (k) => sha256(object[k] ?? null) !== sha256(prior[k] ?? null),
            )
          )
            throw failure(422, 'SAP核验状态不可手工改写。');
          if (!prior || prior.name !== object.name || prior.kind !== object.kind) {
            object.verificationStatus = 'unverified';
            object.evidenceIds = [];
            object.verificationScope = '对象已人工修改，等待重新核验';
          }
        }
      }
      await appendVersion(db, req.work.scope, ws, req.params.stage, req.body);
      return {
        subjectId: ws.id,
        data: await snapshot(db, req.work.scope, req.params.stage, req.work.item, req.work.canEdit),
      };
    }),
  );
  app.get(workBase + '/versions/:versionId', async (req) => {
    await c.authorize(req);
    const ws = await findWorkspace(pool, req.work.scope);
    if (!ws) throw failure(404, '工作区不存在。');
    return viewVersion(await version(pool, ws.id, req.params.versionId, req.params.stage));
  });
  app.post(workBase + '/restore', async (req) =>
    c.write(req, 'item_work.restore', 'development_item', async (db) => {
      if (
        !req.body ||
        Object.keys(req.body).some((k) => !['versionId', 'baseVersionId'].includes(k))
      )
        throw failure(400, '历史恢复参数无效。');
      const ws = await findWorkspace(db, req.work.scope);
      if (!ws) throw failure(404, '工作区不存在。');
      const prior = await version(db, ws.id, req.body.versionId, req.params.stage);
      await appendVersion(db, req.work.scope, ws, req.params.stage, {
        baseVersionId: req.body.baseVersionId,
        document: prior.document,
        designVersionId: prior.design_version_id,
        sourceArtifactId: prior.source_artifact_id,
      });
      return {
        subjectId: ws.id,
        data: await snapshot(db, req.work.scope, req.params.stage, req.work.item, true),
      };
    }),
  );
  app.get(workBase + '/models', async (req) => {
    await c.authorize(req);
    return listModels(pool, org);
  });
  app.get(workBase + '/legacy', async (req) => {
    const current = await c.authorize(req);
    const ws = await findWorkspace(pool, req.work.scope);
    const versions = ws
      ? (
          await pool.query(
            'SELECT id,seq,ast,created_at FROM app.fs_document_revision WHERE workspace_id=$1 ORDER BY seq DESC',
            [ws.id],
          )
        ).rows
      : [];
    const { rows } = await pool.query(
      `SELECT id,created_at FROM app.fsd_agent_session WHERE organization_id=$1 AND actor_id=$2 AND cleared_at IS NULL AND selection->>'projectId'=$3 AND selection->>'itemId'=$4 AND NOT(selection ? 'workspaceStage') ORDER BY created_at DESC,id DESC`,
      [org, current.user.id, req.params.projectId, req.params.itemId],
    );
    const sessions = [];
    for (const s of rows)
      sessions.push({ ...s, ...(await readSessionState(pool, org, current.user.id, s.id)) });
    return { versions, sessions };
  });
  app.get(workBase + '/sessions', async (req) => {
    const current = await c.authorize(req);
    const { rows } = await pool.query(
      `SELECT s.id,s.created_at,s.context, r.id AS "runId",r.snapshot->>'prompt' AS title FROM app.fsd_agent_session s LEFT JOIN LATERAL (SELECT id,snapshot FROM app.fsd_agent_run WHERE conversation_id=s.id ORDER BY created_at DESC,id DESC LIMIT 1) r ON true WHERE s.organization_id=$1 AND s.actor_id=$2 AND s.cleared_at IS NULL AND s.selection->>'projectId'=$3 AND s.selection->>'itemId'=$4 AND s.selection->>'workspaceStage'=$5 ORDER BY s.created_at DESC,s.id DESC`,
      [org, current.user.id, req.params.projectId, req.params.itemId, req.params.stage],
    );
    return { items: rows };
  });
  app.post(workBase + '/adopt', async (req) =>
    c.write(req, 'item_work.adopt', 'development_item', async (db) => {
      if (!/^[0-9a-f-]{36}$/i.test(req.body?.artifactId ?? ''))
        throw failure(400, '候选标识无效。');
      const {
        rows: [a],
      } = await db.query(
        `SELECT r.* FROM app.fsd_agent_revision r JOIN app.fsd_agent_session s ON s.id=r.conversation_id WHERE r.id=$1 AND r.organization_id=$2 AND r.actor_id=$3 AND s.selection->>'projectId'=$4 AND s.selection->>'itemId'=$5 AND s.selection->>'workspaceStage'=$6`,
        [
          req.body?.artifactId,
          org,
          req.work.current.user.id,
          req.params.projectId,
          req.params.itemId,
          req.params.stage,
        ],
      );
      if (!a) throw failure(404, '候选产物不存在或不属于当前阶段。');
      const ws = await findWorkspace(db, req.work.scope);
      if (!ws) throw failure(404, '工作区不存在。');
      const old = await version(db, ws.id, req.body.baseVersionId, req.params.stage);
      if (a.manifest.workContext?.draftVersionId !== old.id)
        throw failure(409, '此候选基于较早工作稿，请使用当前已保存内容重新生成后采用。');
      const document =
        req.params.stage === 'design'
          ? { kind: 'design', spec: a.spec, notes: old.document.notes }
          : a.spec;
      await appendVersion(db, req.work.scope, ws, req.params.stage, {
        baseVersionId: old.id,
        document,
        sourceArtifactId: a.id,
      });
      return {
        subjectId: ws.id,
        data: await snapshot(db, req.work.scope, req.params.stage, req.work.item, true),
      };
    }),
  );
  return c;
}
