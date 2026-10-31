import { HEALTH_STALE_DAYS, KEY_ROLES } from '@sap-delivery-workbench/contracts/projects/options';
import { failure } from '../../platform/auth.mjs';
import { changed } from './context.mjs';
import * as v from './validation.mjs';

// Keyed milestones of a project (code freeze, SIT, UAT, go-live), for the development overview.
export async function keyedMilestones(db, organizationId, projectId) {
  return (
    await db.query(
      `SELECT milestone_key AS key,name,planned_on::text AS "plannedOn",achieved_on::text AS "achievedOn"
       FROM app.project_milestone WHERE organization_id=$1 AND project_id=$2 AND milestone_key IS NOT NULL
       ORDER BY planned_on NULLS LAST,sort`,
      [organizationId, projectId],
    )
  ).rows;
}

// The latest self-reported health of projects, for the development portfolio view.
export async function latestHealth(db, organizationId, projectIds) {
  return (
    await db.query(
      `SELECT DISTINCT ON (project_id) project_id AS "projectId",overall,reported_on::text AS "reportedOn"
       FROM app.project_health WHERE organization_id=$1 AND project_id=ANY($2::uuid[])
       ORDER BY project_id,reported_on DESC,created_at DESC`,
      [organizationId, projectIds],
    )
  ).rows;
}

// The projects a user may enter and their master data (docs/specs/project-access-admin.md 1).
// Reads need project:view; each group of fields has its own edit permission.

const keyColumns = {
  manager: 'manager_id',
  director: 'director_id',
  architect: 'architect_id',
  devLead: 'dev_lead_id',
  basisLead: 'basis_lead_id',
};
const projectColumns = `p.id,p.code,p.name,p.short_name AS "shortName",p.customer_id AS "customerId",c.name AS "customerName",
  p.project_type AS "projectType",p.status,p.is_paused AS "isPaused",p.description,
  p.planned_start_date::text AS "plannedStartDate",p.planned_end_date::text AS "plannedEndDate",
  p.methodology,p.contract_role AS "contractRole",p.prime_contractor AS "primeContractor",
  p.sap_product AS "sapProduct",p.sap_release AS "sapRelease",p.deployment,p.modules,p.language,p.namespace,
  p.default_package AS "defaultPackage",p.transport_method AS "transportMethod",
  p.manager_id AS "managerId",p.director_id AS "directorId",p.architect_id AS "architectId",
  p.dev_lead_id AS "devLeadId",p.basis_lead_id AS "basisLeadId",
  p.contract_no AS "contractNo",p.contract_model AS "contractModel",p.contract_days::float8 AS "contractDays",
  p.dev_budget_days::float8 AS "devBudgetDays",p.team_size AS "teamSize",
  p.archived_at AS "archivedAt",p.updated_at AS "updatedAt",p.row_version AS "rowVersion"`;
const commercial = ['contractNo', 'contractModel', 'contractDays', 'devBudgetDays', 'teamSize'];

export function projectRoutes(app, ctx) {
  const { pool, organizationId: org, requireSession, readProject, writeProject } = ctx;

  // Summary facts shown in lists: current phase, go-live, latest health.
  async function summaries(db, ids) {
    if (!ids.length) return new Map();
    const { rows } = await db.query(
      `SELECT p.id,
        (SELECT name FROM app.project_phase ph WHERE ph.project_id=p.id AND ph.status='in_progress' ORDER BY sort LIMIT 1) AS "currentPhase",
        (SELECT planned_on::text FROM app.project_milestone m WHERE m.project_id=p.id AND m.milestone_key='go_live') AS "goLive",
        (SELECT json_build_object('overall',h.overall,'reportedOn',h.reported_on::text) FROM app.project_health h
          WHERE h.project_id=p.id ORDER BY h.reported_on DESC,h.created_at DESC LIMIT 1) AS health
      FROM app.project p WHERE p.id=ANY($1)`,
      [ids],
    );
    return new Map(rows.map((r) => [r.id, r]));
  }
  async function base(db, id) {
    const { rows } = await db.query(
      `SELECT ${projectColumns} FROM app.project p JOIN app.customer c ON c.organization_id=p.organization_id AND c.id=p.customer_id
      WHERE p.organization_id=$1 AND p.id=$2`,
      [org, id],
    );
    return rows[0];
  }
  // The project as the user may see it: commercial fields and contact details need their
  // field permissions.
  async function detail(db, grant) {
    const p = await base(db, grant.project.id);
    const id = p.id;
    const [phases, milestones, leads, contacts, health, members, planned] = await Promise.all([
      db.query(
        `SELECT phase_key AS key,name,sort,planned_start::text AS "plannedStart",planned_end::text AS "plannedEnd",
          actual_start::text AS "actualStart",actual_end::text AS "actualEnd",status,row_version AS "rowVersion"
        FROM app.project_phase WHERE project_id=$1 ORDER BY sort`,
        [id],
      ),
      db.query(
        `SELECT id,milestone_key AS key,name,phase_key AS "phaseKey",planned_on::text AS "plannedOn",
          achieved_on::text AS "achievedOn",notes,sort,row_version AS "rowVersion"
        FROM app.project_milestone WHERE project_id=$1 ORDER BY planned_on NULLS LAST,sort,name`,
        [id],
      ),
      db.query(
        `SELECT l.module,l.user_id AS "userId",u.display_name AS "displayName" FROM app.project_module_lead l
        JOIN app.app_user u ON u.id=l.user_id WHERE l.project_id=$1 ORDER BY l.module`,
        [id],
      ),
      db.query(
        `SELECT id,name,title,department,contact_role AS "contactRole",modules,phone,email,notes,row_version AS "rowVersion"
        FROM app.project_contact WHERE project_id=$1 ORDER BY name,id`,
        [id],
      ),
      db.query(
        `SELECT h.id,h.reported_on::text AS "reportedOn",h.overall,h.schedule,h.scope,h.cost,h.quality,h.note,
          u.display_name AS "reportedBy",h.created_at AS "createdAt"
        FROM app.project_health h JOIN app.app_user u ON u.id=h.reported_by
        WHERE h.project_id=$1 ORDER BY h.reported_on DESC,h.created_at DESC LIMIT 26`,
        [id],
      ),
      db.query(
        `SELECT u.id,u.display_name AS "displayName" FROM app.project_member pm JOIN app.app_user u ON u.id=pm.user_id
        WHERE pm.organization_id=$1 AND pm.project_id=$2 AND pm.status='active' ORDER BY u.display_name`,
        [org, id],
      ),
      db.query(
        `SELECT COALESCE(sum(ph.effort_days),0)::float8 AS days FROM app.development_item_phase ph
        JOIN app.development_item i ON i.id=ph.item_id AND i.deleted_at IS NULL
        WHERE ph.organization_id=$1 AND ph.project_id=$2 AND ph.phase IN ('fsd','development')`,
        [org, id],
      ),
    ]);
    const names = new Map(members.rows.map((m) => [m.id, m.displayName]));
    const canCommercial = grant.has('project.commercial:view');
    const canContacts = grant.has('project.contact:view');
    const result = { ...p };
    for (const key of commercial) if (!canCommercial) delete result[key];
    if (canCommercial) result.plannedDays = planned.rows[0].days;
    result.keyRoles = Object.fromEntries(
      Object.keys(KEY_ROLES).map((k) => {
        const userId = p[k + 'Id'];
        return [
          k,
          userId ? { id: userId, displayName: names.get(userId) ?? '（已离开项目）' } : null,
        ];
      }),
    );
    for (const k of Object.keys(keyColumns)) delete result[k + 'Id'];
    result.phases = phases.rows;
    result.currentPhase = phases.rows.find((ph) => ph.status === 'in_progress')?.name ?? null;
    result.milestones = milestones.rows;
    result.moduleLeads = leads.rows;
    result.contacts = contacts.rows.map((c) =>
      canContacts ? c : { ...c, phone: '', email: '', hidden: true },
    );
    result.health = health.rows;
    const latest = health.rows[0];
    result.healthStale =
      !latest || (Date.now() - Date.parse(latest.reportedOn)) / 86400000 > HEALTH_STALE_DAYS;
    result.members = members.rows;
    result.access = grant.toJSON();
    return result;
  }

  // The projects of the signed-in user, for the home page, switcher and project list.
  app.get('/api/projects', async (req) => {
    const current = await requireSession(req, true);
    const grants = await ctx.projects(pool, current.user.id);
    const ids = grants.map((g) => g.project.id);
    if (!ids.length) return [];
    const { rows } = await pool.query(
      `SELECT ${projectColumns} FROM app.project p JOIN app.customer c ON c.organization_id=p.organization_id AND c.id=p.customer_id
      WHERE p.organization_id=$1 AND p.id=ANY($2) ORDER BY p.status='archived',p.updated_at DESC,p.id DESC`,
      [org, ids],
    );
    const facts = await summaries(pool, ids);
    return rows.map((p) => {
      const grant = grants.find((g) => g.project.id === p.id);
      const { currentPhase, goLive, health } = facts.get(p.id);
      const row = { ...p, currentPhase, goLive, health };
      if (!grant.has('project.commercial:view')) for (const key of commercial) delete row[key];
      for (const k of Object.keys(keyColumns)) delete row[k + 'Id'];
      return row;
    });
  });
  app.get('/api/projects/:projectId', async (req) => {
    const { grant } = await readProject(req, 'project:view');
    return detail(pool, grant);
  });

  const save = (permission, action, operation) => async (req) =>
    writeProject(req, permission, action, 'project', async (db, current, grant) => {
      const details = await operation(db, current, grant, req.body ?? {}, req.params);
      await db.query('UPDATE app.project SET updated_at=now() WHERE organization_id=$1 AND id=$2', [
        org,
        grant.project.id,
      ]);
      return { subjectId: grant.project.id, data: await detail(db, grant), details };
    });
  const bump = async (db, id, revision) =>
    changed(
      await db.query(
        'UPDATE app.project SET row_version=row_version+1,updated_at=now() WHERE organization_id=$1 AND id=$2 AND row_version=$3 RETURNING id',
        [org, id, revision],
      ),
    );

  app.patch(
    '/api/projects/:projectId',
    save('project:edit', 'project.update', async (db, current, grant, body) => {
      const input = v.projectInput(body);
      const revision = v.version(body.rowVersion);
      if (input.isPaused && !['preparing', 'active'].includes(input.status))
        throw failure(400, '只有筹备中或实施中的项目可以暂停。');
      await bump(db, grant.project.id, revision);
      await db.query(
        `UPDATE app.project SET code=$3,name=$4,short_name=$5,project_type=$6,status=$7,is_paused=$8,methodology=$9,
          contract_role=$10,prime_contractor=$11,description=$12,planned_start_date=$13,planned_end_date=$14,
          sap_product=$15,sap_release=$16,deployment=$17,modules=$18,language=$19,namespace=$20,default_package=$21,
          transport_method=$22 WHERE organization_id=$1 AND id=$2`,
        [
          org,
          grant.project.id,
          input.code,
          input.name,
          input.shortName,
          input.projectType,
          input.status,
          input.isPaused,
          input.methodology,
          input.contractRole,
          input.primeContractor,
          input.description,
          input.plannedStartDate,
          input.plannedEndDate,
          input.sapProduct,
          input.sapRelease,
          input.deployment,
          input.modules,
          input.language,
          input.namespace,
          input.defaultPackage,
          input.transportMethod,
        ],
      );
      return { status: input.status };
    }),
  );
  app.patch(
    '/api/projects/:projectId/commercial',
    save(
      'project.commercial:edit',
      'project.commercial.update',
      async (db, current, grant, body) => {
        const input = v.commercialInput(body);
        await bump(db, grant.project.id, v.version(body.rowVersion));
        await db.query(
          `UPDATE app.project SET contract_no=$3,contract_model=$4,contract_days=$5,dev_budget_days=$6,team_size=$7
        WHERE organization_id=$1 AND id=$2`,
          [
            org,
            grant.project.id,
            input.contractNo,
            input.contractModel,
            input.contractDays,
            input.devBudgetDays,
            input.teamSize,
          ],
        );
        return {};
      },
    ),
  );
  // Key positions and module leads are project members (section 1.4).
  app.put(
    '/api/projects/:projectId/team',
    save('project.team:edit', 'project.team.update', async (db, current, grant, body) => {
      await bump(db, grant.project.id, v.version(body.rowVersion));
      const { rows } = await db.query(
        "SELECT user_id FROM app.project_member WHERE organization_id=$1 AND project_id=$2 AND status='active'",
        [org, grant.project.id],
      );
      const members = new Set(rows.map((r) => r.user_id));
      const member = (value, label) => {
        const id = v.optionalUuid(value);
        if (id && !members.has(id)) throw failure(400, `${label}必须是项目成员。`);
        return id;
      };
      const keys = Object.fromEntries(
        Object.entries(KEY_ROLES).map(([k, label]) => [k, member(body.keyRoles?.[k], label)]),
      );
      await db.query(
        `UPDATE app.project SET manager_id=$3,director_id=$4,architect_id=$5,dev_lead_id=$6,basis_lead_id=$7
        WHERE organization_id=$1 AND id=$2`,
        [
          org,
          grant.project.id,
          keys.manager,
          keys.director,
          keys.architect,
          keys.devLead,
          keys.basisLead,
        ],
      );
      const leads = Array.isArray(body.moduleLeads) ? body.moduleLeads : [];
      const modules = v.modules(
        leads.map((l) => l?.module),
        '模块',
      );
      if (new Set(modules).size !== leads.length) throw failure(400, '每个模块只能有一位负责人。');
      await db.query('DELETE FROM app.project_module_lead WHERE project_id=$1', [grant.project.id]);
      for (const lead of leads)
        await db.query(
          'INSERT INTO app.project_module_lead(organization_id,project_id,module,user_id) VALUES($1,$2,$3,$4)',
          [org, grant.project.id, lead.module, member(lead.userId, `${lead.module} 模块负责人`)],
        );
      return { keyRoles: keys, moduleLeads: leads.length };
    }),
  );

  app.post(
    '/api/projects/:projectId/contacts',
    save('project.team:edit', 'project.contact.create', async (db, current, grant, body) => {
      const c = v.contactInput(body);
      const { rows } = await db.query(
        `INSERT INTO app.project_contact(organization_id,project_id,name,title,department,contact_role,modules,phone,email,notes)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [
          org,
          grant.project.id,
          c.name,
          c.title,
          c.department,
          c.contactRole,
          c.modules,
          c.phone,
          c.email,
          c.notes,
        ],
      );
      return { contactId: rows[0].id };
    }),
  );
  app.patch(
    '/api/projects/:projectId/contacts/:contactId',
    save(
      'project.team:edit',
      'project.contact.update',
      async (db, current, grant, body, params) => {
        const id = v.uuid(params.contactId);
        const c = v.contactInput(body);
        changed(
          await db.query(
            `UPDATE app.project_contact SET name=$4,title=$5,department=$6,contact_role=$7,modules=$8,phone=$9,email=$10,notes=$11,
          row_version=row_version+1,updated_at=now() WHERE organization_id=$1 AND project_id=$2 AND id=$3 AND row_version=$12 RETURNING id`,
            [
              org,
              grant.project.id,
              id,
              c.name,
              c.title,
              c.department,
              c.contactRole,
              c.modules,
              c.phone,
              c.email,
              c.notes,
              v.version(body.rowVersion),
            ],
          ),
        );
        return { contactId: id };
      },
    ),
  );
  app.delete(
    '/api/projects/:projectId/contacts/:contactId',
    save(
      'project.team:edit',
      'project.contact.delete',
      async (db, current, grant, body, params) => {
        const id = v.uuid(params.contactId);
        changed(
          await db.query(
            'DELETE FROM app.project_contact WHERE organization_id=$1 AND project_id=$2 AND id=$3 AND row_version=$4 RETURNING id',
            [org, grant.project.id, id, v.version(body.rowVersion)],
          ),
        );
        return { contactId: id };
      },
    ),
  );

  // Phases are saved together; each keeps its own version.
  app.put(
    '/api/projects/:projectId/phases',
    save('project.plan:edit', 'project.phases.update', async (db, current, grant, body) => {
      if (!Array.isArray(body.phases)) throw failure(400, '阶段数据无效。');
      for (const phase of body.phases) {
        const input = v.phaseInput(phase);
        changed(
          await db.query(
            `UPDATE app.project_phase SET name=$3,planned_start=$4,planned_end=$5,actual_start=$6,actual_end=$7,status=$8,
            row_version=row_version+1,updated_at=now() WHERE project_id=$1 AND phase_key=$2 AND row_version=$9 RETURNING phase_key`,
            [
              grant.project.id,
              String(phase?.key),
              input.name,
              input.plannedStart,
              input.plannedEnd,
              input.actualStart,
              input.actualEnd,
              input.status,
              v.version(phase?.rowVersion),
            ],
          ),
        );
      }
      return { phases: body.phases.length };
    }),
  );
  app.post(
    '/api/projects/:projectId/milestones',
    save('project.plan:edit', 'project.milestone.create', async (db, current, grant, body) => {
      const m = v.milestoneInput(body);
      const { rows } = await db.query(
        `INSERT INTO app.project_milestone(organization_id,project_id,name,phase_key,planned_on,achieved_on,notes,sort)
        VALUES($1,$2,$3,$4,$5,$6,$7,(SELECT COALESCE(max(sort),0)+1 FROM app.project_milestone WHERE project_id=$2)) RETURNING id`,
        [org, grant.project.id, m.name, m.phaseKey, m.plannedOn, m.achievedOn, m.notes],
      );
      return { milestoneId: rows[0].id };
    }),
  );
  app.patch(
    '/api/projects/:projectId/milestones/:milestoneId',
    save(
      'project.plan:edit',
      'project.milestone.update',
      async (db, current, grant, body, params) => {
        const id = v.uuid(params.milestoneId);
        const m = v.milestoneInput(body);
        changed(
          await db.query(
            `UPDATE app.project_milestone SET name=$4,phase_key=$5,planned_on=$6,achieved_on=$7,notes=$8,row_version=row_version+1,updated_at=now()
          WHERE organization_id=$1 AND project_id=$2 AND id=$3 AND row_version=$9 RETURNING id`,
            [
              org,
              grant.project.id,
              id,
              m.name,
              m.phaseKey,
              m.plannedOn,
              m.achievedOn,
              m.notes,
              v.version(body.rowVersion),
            ],
          ),
        );
        return { milestoneId: id };
      },
    ),
  );
  app.delete(
    '/api/projects/:projectId/milestones/:milestoneId',
    save(
      'project.plan:edit',
      'project.milestone.delete',
      async (db, current, grant, body, params) => {
        const id = v.uuid(params.milestoneId);
        const { rows } = await db.query(
          'SELECT milestone_key FROM app.project_milestone WHERE organization_id=$1 AND project_id=$2 AND id=$3',
          [org, grant.project.id, id],
        );
        if (rows[0]?.milestone_key)
          throw failure(409, '预置里程碑供其他页面引用，不能删除；不需要时清空计划日期即可。');
        changed(
          await db.query(
            'DELETE FROM app.project_milestone WHERE organization_id=$1 AND project_id=$2 AND id=$3 AND row_version=$4 RETURNING id',
            [org, grant.project.id, id, v.version(body.rowVersion)],
          ),
        );
        return { milestoneId: id };
      },
    ),
  );
  app.post(
    '/api/projects/:projectId/health',
    save('project.health:edit', 'project.health.report', async (db, current, grant, body) => {
      const h = v.healthInput(body);
      await db.query(
        `INSERT INTO app.project_health(organization_id,project_id,reported_on,overall,schedule,scope,cost,quality,note,reported_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          org,
          grant.project.id,
          h.reportedOn,
          h.overall,
          h.schedule,
          h.scope,
          h.cost,
          h.quality,
          h.note,
          current.user.id,
        ],
      );
      return { overall: h.overall };
    }),
  );
  // Archiving is one-way: the project and everything in it become read-only.
  app.post('/api/projects/:projectId/archive', async (req) =>
    writeProject(
      req,
      'project:archive',
      'project.archive',
      'project',
      async (db, current, grant) => {
        await bump(db, grant.project.id, v.version(req.body?.rowVersion));
        await db.query(
          "UPDATE app.project SET status='archived',archived_at=now(),is_paused=false WHERE organization_id=$1 AND id=$2",
          [org, grant.project.id],
        );
        return { subjectId: grant.project.id, data: { ok: true } };
      },
    ),
  );
}
