import { randomUUID } from 'node:crypto';
import { failure, transaction } from '../../platform/auth.mjs';
import { createAccess } from '../access/public.mjs';
import {
  LIST_REPORTS,
  MAX_VIEWS_PER_LIST,
  MAX_VIEW_NAME,
  normalizeViewState,
} from '@sap-delivery-workbench/contracts/list-report/views';

// A person's saved views of a list report (docs/modules/list-report.md 4). A view belongs to its
// owner: another person's view answers 404 like one that does not exist.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUMNS = `id, name, is_default AS "isDefault", auto_apply AS "autoApply", state`;

export function registerListViewRoutes(app, pool, organizationId, requireSession) {
  const access = createAccess(pool, organizationId);
  const base = '/api/projects/:projectId/list-views/:listKey';
  const listOf = (req) => {
    const report = LIST_REPORTS[req.params.listKey];
    if (!report) throw failure(404, '列表不存在。');
    return report;
  };
  const nameOf = (value) => {
    const name = typeof value === 'string' ? value.trim() : '';
    if (!name || name.length > MAX_VIEW_NAME)
      throw failure(400, `视图名称需要 1–${MAX_VIEW_NAME} 个字符。`);
    if (name === '标准') throw failure(400, '“标准”是系统视图的名称，请换一个。');
    return name;
  };
  const keyOf = (req, owner) => [organizationId, req.params.projectId, owner, req.params.listKey];

  // Runs a write inside a transaction with the same checks as the rest of a project's data:
  // 404 outside the person's projects, 403 without the permission, 409 once archived.
  async function write(req, operation) {
    const report = listOf(req);
    const current = await requireSession(req, true);
    try {
      return await transaction(pool, async (db) => {
        await db.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))', [
          organizationId,
        ]);
        const grant = await access.requireProject(db, current, req.params.projectId, report.save);
        if (grant.project.status === 'archived') throw failure(409, '项目已归档，只能查看。');
        return operation(db, current);
      });
    } catch (e) {
      if (e?.code === '23505') throw failure(409, '已有同名视图，请换一个名称。');
      throw e;
    }
  }
  const record = (db, current, action, id, details) =>
    db.query(
      `INSERT INTO app.audit_event(organization_id,actor_user_id,action,outcome,subject_type,subject_id,request_id,details)
      VALUES($1,$2,$3,'success','list_view',$4,$5,$6)`,
      [
        organizationId,
        current.user.id,
        action,
        id,
        randomUUID(),
        JSON.stringify({
          projectId: details.projectId,
          listKey: details.listKey,
          name: details.name,
        }),
      ],
    );
  const clearDefault = (db, req, current) =>
    db.query(
      `UPDATE app.list_view SET is_default=false
      WHERE organization_id=$1 AND project_id=$2 AND owner_id=$3 AND list_key=$4 AND is_default`,
      keyOf(req, current.user.id),
    );
  async function owned(db, req, current) {
    if (!UUID.test(req.params.id)) throw failure(404, '视图不存在。');
    const { rows } = await db.query(
      `SELECT ${COLUMNS} FROM app.list_view
      WHERE organization_id=$1 AND project_id=$2 AND owner_id=$3 AND list_key=$4 AND id=$5 FOR UPDATE`,
      [...keyOf(req, current.user.id), req.params.id],
    );
    if (!rows[0]) throw failure(404, '视图不存在。');
    return rows[0];
  }

  app.get(base, async (req) => {
    const report = listOf(req);
    const current = await requireSession(req, true);
    const grant = await access.requireProject(pool, current, req.params.projectId, report.view);
    const { rows } = await pool.query(
      `SELECT ${COLUMNS} FROM app.list_view
      WHERE organization_id=$1 AND project_id=$2 AND owner_id=$3 AND list_key=$4
      ORDER BY lower(name)`,
      keyOf(req, current.user.id),
    );
    return {
      views: rows,
      canSave: grant.has(report.save) && grant.project.status !== 'archived',
    };
  });

  app.post(base, (req) =>
    write(req, async (db, current) => {
      const name = nameOf(req.body?.name);
      const { rows: count } = await db.query(
        `SELECT count(*)::int AS n FROM app.list_view
        WHERE organization_id=$1 AND project_id=$2 AND owner_id=$3 AND list_key=$4`,
        keyOf(req, current.user.id),
      );
      if (count[0].n >= MAX_VIEWS_PER_LIST)
        throw failure(409, `每个列表最多保存 ${MAX_VIEWS_PER_LIST} 个视图，请先删除不用的。`);
      if (req.body?.isDefault) await clearDefault(db, req, current);
      const id = randomUUID();
      const { rows } = await db.query(
        `INSERT INTO app.list_view(id,organization_id,project_id,owner_id,list_key,name,is_default,auto_apply,state)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${COLUMNS}`,
        [
          id,
          ...keyOf(req, current.user.id),
          name,
          req.body?.isDefault === true,
          req.body?.autoApply !== false,
          JSON.stringify(normalizeViewState(req.body?.state)),
        ],
      );
      await record(db, current, 'list_view.create', id, {
        projectId: req.params.projectId,
        listKey: req.params.listKey,
        name,
      });
      return rows[0];
    }),
  );

  app.patch(base + '/:id', (req) =>
    write(req, async (db, current) => {
      const view = await owned(db, req, current);
      const body = req.body ?? {};
      const name = body.name === undefined ? view.name : nameOf(body.name);
      const isDefault = body.isDefault === undefined ? view.isDefault : body.isDefault === true;
      const autoApply = body.autoApply === undefined ? view.autoApply : body.autoApply === true;
      const state = body.state === undefined ? view.state : normalizeViewState(body.state);
      if (isDefault && !view.isDefault) await clearDefault(db, req, current);
      const { rows } = await db.query(
        `UPDATE app.list_view SET name=$2,is_default=$3,auto_apply=$4,state=$5,updated_at=clock_timestamp()
        WHERE id=$1 RETURNING ${COLUMNS}`,
        [view.id, name, isDefault, autoApply, JSON.stringify(state)],
      );
      await record(db, current, 'list_view.update', view.id, {
        projectId: req.params.projectId,
        listKey: req.params.listKey,
        name,
      });
      return rows[0];
    }),
  );

  app.delete(base + '/:id', (req) =>
    write(req, async (db, current) => {
      const view = await owned(db, req, current);
      await db.query('DELETE FROM app.list_view WHERE id=$1', [view.id]);
      await record(db, current, 'list_view.delete', view.id, {
        projectId: req.params.projectId,
        listKey: req.params.listKey,
        name: view.name,
      });
      return { ok: true };
    }),
  );
}
