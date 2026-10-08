import { failure } from '../../platform/auth.mjs';
import { text, version } from '../admin/validation.mjs';
import { fsInput, validatePeople } from './validation.mjs';
import { base } from './items.mjs';
export function fsRoutes(app, c) {
  async function load(db, req, lock = false) {
    const { rows } = await db.query(
      `SELECT fs_number AS "fsNumber",sections,row_version::text AS "rowVersion",submitted_version_id AS "submittedVersionId",updated_at AS "updatedAt" FROM app.fs_draft WHERE item_id=$1${lock ? ' FOR UPDATE' : ''}`,
      [req.params.id],
    );
    if (!rows[0]) throw failure(404, 'FS不存在。');
    const versions = await db.query(
      `SELECT v.id,v.version_number AS number,v.fs_number AS "fsNumber",v.sections,v.note,v.created_at AS "createdAt",u.display_name AS "authorName" FROM app.fs_version v JOIN app.app_user u ON u.id=v.created_by WHERE item_id=$1 ORDER BY version_number DESC`,
      [req.params.id],
    );
    return { ...rows[0], versions: versions.rows };
  }
  async function authorize(db, req, current, project) {
    const item = await c.item(db, req, true);
    if (
      project.access_level !== 'admin' &&
      (item.business_owner_id ?? item.created_by) !== current.user.id
    )
      throw failure(403, 'FS 仅可由业务负责人或本项目内的企业管理员维护。');
    const migrated = await db.query(
      'SELECT 1 FROM app.fs_workspace WHERE organization_id=$1 AND project_id=$2 AND item_id=$3 AND legacy_imported_at IS NOT NULL LIMIT 1',
      [c.organizationId, req.params.projectId, req.params.id],
    );
    if (migrated.rowCount) {
      const error = failure(409, '该开发项已启用 FS 智能工作区，请通过新工作区操作。');
      error.code = 'FS_WORKSPACE_ENABLED';
      throw error;
    }
    return item;
  }
  app.get(base + '/:id/fs', async (req) => {
    await c.read(req);
    await c.item(c.pool, req);
    return load(c.pool, req);
  });
  app.patch(base + '/:id/fs', { bodyLimit: 1700000 }, async (req) =>
    c.write(req, async (db, current, project) => {
      await authorize(db, req, current, project);
      const expected = version(req.body?.rowVersion),
        input = fsInput(req.body),
        old = await load(db, req, true);
      if (expected !== old.rowVersion)
        throw failure(409, 'FS 草稿已更新。你的内容已保留，请读取最新版本后处理。');
      await db.query(
        'UPDATE app.fs_draft SET fs_number=$2,sections=$3,row_version=row_version+1,updated_at=now(),updated_by=$4 WHERE item_id=$1',
        [req.params.id, input.fsNumber, JSON.stringify(input.sections), current.user.id],
      );
      await c.event(db, req, current, 'fs_saved');
      return load(db, req);
    }),
  );
  async function snapshot(db, req, current, old, note) {
    const number = (old.versions[0]?.number ?? 0) + 1;
    const { rows } = await db.query(
      `INSERT INTO app.fs_version(organization_id,project_id,item_id,version_number,fs_number,sections,note,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,version_number AS number,fs_number AS "fsNumber",sections,note,created_at AS "createdAt"`,
      [
        c.organizationId,
        req.params.projectId,
        req.params.id,
        number,
        old.fsNumber,
        JSON.stringify(old.sections),
        note,
        current.user.id,
      ],
    );
    return rows[0];
  }
  app.post(base + '/:id/fs/versions', async (req, reply) =>
    c.write(req, async (db, current, project) => {
      await authorize(db, req, current, project);
      const old = await load(db, req, true);
      if (version(req.body?.rowVersion) !== old.rowVersion)
        throw failure(409, 'FS已更新，请先刷新。');
      const result = await snapshot(
        db,
        req,
        current,
        old,
        text(req.body?.note, '版本说明', 500, { optional: true }),
      );
      await db.query('UPDATE app.fs_draft SET row_version=row_version+1 WHERE item_id=$1', [
        req.params.id,
      ]);
      await c.event(db, req, current, 'fs_version', { number: result.number });
      reply.code(201);
      return result;
    }),
  );
  app.post(base + '/:id/fs/submit', async (req) =>
    c.write(req, async (db, current, project) => {
      const item = await authorize(db, req, current, project),
        old = await load(db, req, true);
      if (
        version(req.body?.rowVersion) !== old.rowVersion ||
        version(req.body?.itemVersion) !== String(item.row_version)
      )
        throw failure(409, 'FS或开发项已更新，请先刷新。');
      if (!item.business_owner_id || !item.developer_id)
        throw failure(400, '请先分配业务顾问和开发人员。');
      await validatePeople(db, c.organizationId, req.params.projectId, {
        businessOwnerId: item.business_owner_id,
        developerId: item.developer_id,
      });
      if (!old.fsNumber || ['rules', 'acceptance', 'cases'].some((k) => !old.sections[k]?.trim()))
        throw failure(400, '请填写 FS 编号、业务规则、验收条件和初版测试案例。');
      if (item.blocked_reason) throw failure(400, '请先处理并清除当前阻塞原因。');
      const result = await snapshot(db, req, current, old, '提交开发');
      await db.query(
        'UPDATE app.fs_draft SET submitted_version_id=$2,row_version=row_version+1,updated_at=now(),updated_by=$3 WHERE item_id=$1',
        [item.id, result.id, current.user.id],
      );
      await db.query(
        "UPDATE app.development_item SET stage='ready',row_version=row_version+1,updated_at=now() WHERE id=$1",
        [item.id],
      );
      await c.event(db, req, current, 'fs_submitted', {
        number: result.number,
        previousVersionId: old.submittedVersionId,
      });
      return load(db, req);
    }),
  );
}
