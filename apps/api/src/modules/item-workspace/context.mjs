import { randomUUID } from 'node:crypto';
import { deliveryContext } from '../delivery/context.mjs';
import { deniedError } from '../access/public.mjs';
import { SAP_PRODUCTS, DEPLOYMENTS } from '@sap-delivery-workbench/contracts/projects/options';

// The project's SAP landscape in one line for the agents' facts (docs/specs/project-access-admin.md 1.2).
export function landscapeOf(p) {
  return [
    [SAP_PRODUCTS[p.sap_product], p.sap_release].filter(Boolean).join(' '),
    DEPLOYMENTS[p.deployment],
    p.modules?.length ? '实施模块 ' + p.modules.join('、') : '',
    p.namespace ? '开发命名空间 ' + p.namespace : '',
    p.default_package ? '默认开发包 ' + p.default_package : '',
  ]
    .filter(Boolean)
    .join('，');
}

// Access context for one stage of a development item: design (abap-fsd-agent)
// or development (abap-dev-agent). The stage decides who owns the work.
export function createWorkContext(pool, organizationId, requireSession, stage) {
  if (!['design', 'development'].includes(stage)) throw new Error('Unknown work stage: ' + stage);
  const delivery = deliveryContext(pool, organizationId, requireSession);
  // Contract 3.5: viewing needs agent.<stage>:view; working needs agent.<stage>:run for this
  // item (module scope; "own items only" means the stage's assignee).
  const agent = stage === 'design' ? 'agent.fsd' : 'agent.dev';
  async function authorize(req, db = pool, writing = !['GET', 'HEAD'].includes(req.method)) {
    const current = await requireSession(req, true);
    const project = await delivery.access(db, current, req.params.projectId, {
      write: writing,
      permission: agent + ':view',
    });
    const item = await delivery.item(
      db,
      { params: { ...req.params, id: req.params.itemId } },
      writing,
    );
    // The phase assignee owns the work (fsd for design, development for development).
    const { rows: phase } = await db.query(
      'SELECT assignee_id FROM app.development_item_phase WHERE item_id=$1 AND phase=$2',
      [item.id, stage === 'design' ? 'fsd' : 'development'],
    );
    const owner = phase[0]?.assignee_id ?? item.created_by;
    const context = { module: item.module, owners: [owner] };
    const canEdit = project.status !== 'archived' && project.grant.has(agent + ':run', context);
    const canFinalize = canEdit && project.grant.has(agent + ':finalize', context);
    if (writing && !canEdit) throw deniedError(agent + ':run');
    req.work = {
      current,
      item,
      canEdit,
      canFinalize,
      grant: project.grant,
      scope: {
        organizationId,
        projectId: project.id,
        projectName: project.name,
        itemId: item.id,
        itemCode: item.code,
        itemName: item.name,
        itemKind: item.kind,
        changeType: item.change_type,
        transactionCode: item.transaction_code ?? '',
        landscape: landscapeOf(project),
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
  // Development-list facts an agent reads as materials: SAP objects and uploaded files
  // (each file carries the local path its bytes are stored at).
  const itemObjects = (db, itemId) => delivery.objects(db, itemId);
  const itemFiles = (db, itemId) => delivery.files(db, itemId);
  return { pool, organizationId, delivery, authorize, write, itemObjects, itemFiles };
}
