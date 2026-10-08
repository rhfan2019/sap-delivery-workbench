import { createHash, randomUUID } from 'node:crypto';
import { failure } from '../../../platform/auth.mjs';
import { validateCommand } from '@sap-delivery-workbench/contracts/fs-workspace';

const base = '/api/projects/:projectId/fs-roles';
const roles = ['business_approver', 'technical_reviewer', 'publisher'];
const envelope = (req, data) => ({ data, meta: { request_id: req.id, workspace_revision: null } });
const admin = (project) => {
  if (project.access_level !== 'admin') throw failure(403, '仅项目内管理员可配置 FS 角色。');
};

export function registerRoleRoutes(app, c) {
  app.get(base, async (req) => {
    const { project } = await c.read(req);
    admin(project);
    const { rows } = await c.pool.query(
      `SELECT user_id,coalesce(array_agg(role ORDER BY role) FILTER(WHERE enabled),'{}') AS roles,max(row_version)::text AS revision
      FROM app.fs_project_role WHERE organization_id=$1 AND project_id=$2 GROUP BY user_id ORDER BY user_id`,
      [c.organizationId, req.params.projectId],
    );
    return envelope(req, rows);
  });
  app.post(base, async (req) =>
    c.write(req, async (db, current, project) => {
      await db.query('SELECT id FROM app.project WHERE organization_id=$1 AND id=$2 FOR UPDATE', [
        c.organizationId,
        req.params.projectId,
      ]);
      project = await c.access(db, current, req.params.projectId, true);
      admin(project);
      if (!validateCommand('setFsProjectRoles', req.body).ok) throw failure(400, '角色配置无效。');
      const key = req.headers['idempotency-key'];
      if (
        typeof key !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)
      )
        throw failure(428, '需要合法的 Idempotency-Key。');
      const input = {
        user_id: req.body.user_id,
        roles: [...new Set(req.body.roles)].sort(),
        expected_revision: req.body.expected_revision,
      };
      const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
      const values = [
        c.organizationId,
        req.params.projectId,
        current.user.id,
        'setFsProjectRoles',
        key,
      ];
      const { rows: receipts } = await db.query(
        'SELECT request_hash,result FROM app.fs_project_command_receipt WHERE organization_id=$1 AND project_id=$2 AND actor_id=$3 AND action=$4 AND key=$5',
        values,
      );
      if (receipts.length) {
        if (receipts[0].request_hash !== hash) {
          const error = failure(409, '同一幂等键不能用于不同内容。');
          error.code = 'IDEMPOTENCY_CONFLICT';
          throw error;
        }
        return envelope(req, receipts[0].result);
      }
      const { rows: members } = await db.query(
        `SELECT pm.user_id FROM app.project_member pm JOIN app.organization_member om ON om.organization_id=pm.organization_id AND om.user_id=pm.user_id JOIN app.app_user u ON u.id=pm.user_id
      WHERE pm.organization_id=$1 AND pm.project_id=$2 AND pm.user_id=$3 AND pm.status='active' AND om.status='active' AND u.status='active'`,
        [c.organizationId, req.params.projectId, input.user_id],
      );
      if (!members.length) throw failure(404, '项目成员不存在或不可用。');
      const {
        rows: [old],
      } = await db.query(
        'SELECT coalesce(max(row_version),0)::text AS revision FROM app.fs_project_role WHERE organization_id=$1 AND project_id=$2 AND user_id=$3',
        [c.organizationId, req.params.projectId, input.user_id],
      );
      if (old.revision !== input.expected_revision) throw failure(409, '角色配置已更新，请刷新。');
      const revision = (BigInt(old.revision) + 1n).toString();
      for (const role of roles)
        await db.query(
          `INSERT INTO app.fs_project_role(organization_id,project_id,user_id,role,enabled,row_version) VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(organization_id,project_id,user_id,role) DO UPDATE SET enabled=EXCLUDED.enabled,row_version=EXCLUDED.row_version`,
          [
            c.organizationId,
            req.params.projectId,
            input.user_id,
            role,
            input.roles.includes(role),
            revision,
          ],
        );
      const result = { user_id: input.user_id, roles: input.roles, revision };
      await db.query(
        'INSERT INTO app.fs_project_command_receipt(organization_id,project_id,actor_id,action,key,request_hash,result) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [...values, hash, result],
      );
      await db.query(
        "INSERT INTO app.audit_event(organization_id,actor_user_id,action,outcome,subject_type,subject_id,request_id,details) VALUES($1,$2,'fs.roles_updated','success','project',$3,$4,$5)",
        [c.organizationId, current.user.id, req.params.projectId, randomUUID(), result],
      );
      return envelope(req, result);
    }),
  );
}
