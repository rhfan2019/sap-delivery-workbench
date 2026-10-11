import { randomUUID } from 'node:crypto';
import { deliveryContext } from '../delivery/context.mjs';
import { failure } from '../../platform/auth.mjs';

// Access context for one stage of a development item: design (abap-fsd-agent)
// or development (abap-dev-agent). The stage decides who owns the work.
export function createWorkContext(pool, organizationId, requireSession, stage) {
  if (!['design', 'development'].includes(stage)) throw new Error('Unknown work stage: ' + stage);
  const delivery = deliveryContext(pool, organizationId, requireSession);
  async function authorize(req, db = pool, writing = !['GET', 'HEAD'].includes(req.method)) {
    const current = await requireSession(req, true);
    const project = await delivery.access(db, current, req.params.projectId, writing);
    const item = await delivery.item(
      db,
      { params: { ...req.params, id: req.params.itemId } },
      writing,
    );
    const owner =
      stage === 'design'
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
        itemCode: item.code,
        itemName: item.name,
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
  return { pool, organizationId, delivery, authorize, write };
}
