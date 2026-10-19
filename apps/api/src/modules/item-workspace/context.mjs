import { randomUUID } from 'node:crypto';
import { deliveryContext } from '../delivery/context.mjs';
import { deniedError } from '../access/public.mjs';
import { failure } from '../../platform/auth.mjs';
import { AGENT_STAGES, stageOwner } from '@sap-delivery-workbench/contracts/delivery/fields';
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
  // Contract 3.5 (docs/specs/agent-workspace-start-and-composer.md 6): the assistant page,
  // reads included, needs agent.<stage>:run for this item (module scope; "own items only"
  // means the stage's assignee). agent.<stage>:view only reads the outputs (`authorizeView`).
  const agent = AGENT_STAGES[stage].agent;
  async function itemOf(req, db, writing) {
    return delivery.item(db, { params: { ...req.params, id: req.params.itemId } }, writing);
  }
  async function authorize(req, db = pool, writing = !['GET', 'HEAD'].includes(req.method)) {
    const current = await requireSession(req, true);
    const project = await delivery.access(db, current, req.params.projectId, {
      write: writing,
      permission: agent + ':run',
    });
    const item = await itemOf(req, db, writing);
    // Who may use each assistant on this item: this page's check, and the other tab (spec 5).
    const { rows: phases } = await db.query(
      'SELECT phase,assignee_id FROM app.development_item_phase WHERE item_id=$1',
      [item.id],
    );
    const contextOf = (name) => ({
      module: item.module,
      owners: [
        stageOwner(
          phases.find((p) => p.phase === AGENT_STAGES[name].phase)?.assignee_id,
          item.created_by,
        ),
      ],
    });
    const stages = Object.fromEntries(
      Object.keys(AGENT_STAGES).map((name) => [
        name,
        project.grant.has(AGENT_STAGES[name].agent + ':run', contextOf(name)),
      ]),
    );
    const context = contextOf(stage);
    if (!project.grant.has(agent + ':run', context)) throw deniedError(agent + ':run');
    // An archived project stays readable to the people who worked in it.
    const canEdit = project.status !== 'archived';
    const canFinalize = canEdit && project.grant.has(agent + ':finalize', context);
    if (writing && !canEdit) throw failure(409, '项目已归档，只能查看。');
    req.work = {
      current,
      item,
      canEdit,
      canFinalize,
      stages,
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
  // Outputs only (the item drawer): agent.<stage>:view in the project, no module narrowing.
  async function authorizeView(req, db = pool) {
    const current = await requireSession(req, true);
    await delivery.access(db, current, req.params.projectId, { permission: agent + ':view' });
    const item = await itemOf(req, db, false);
    req.work = { current, item, scope: { organizationId, itemId: item.id, itemCode: item.code } };
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
  return {
    pool,
    organizationId,
    delivery,
    authorize,
    authorizeView,
    write,
    itemObjects,
    itemFiles,
  };
}
