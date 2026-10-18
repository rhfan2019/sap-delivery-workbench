import { MILESTONES, PHASES } from '@sap-delivery-workbench/contracts/projects/options';
import { addMember } from '../access/public.mjs';
import { failure } from '../../platform/auth.mjs';
import { changed, found } from './context.mjs';
import * as v from './validation.mjs';

const organizationColumns = 'id,code,name,status,row_version AS "rowVersion"';
const customerColumns = `c.id,c.code,c.name,c.customer_kind AS "customerKind",c.status,c.description,c.row_version AS "rowVersion",
  (SELECT count(*)::int FROM app.project p WHERE p.organization_id=c.organization_id AND p.customer_id=c.id) AS "projectCount"`;

// Organization profile, customers and the organization's project list.
export function organizationRoutes(app, ctx) {
  const { pool, organizationId: org, authorize, write } = ctx;
  app.get('/api/admin/organization', async (req) => {
    await authorize(req, 'org.profile:view');
    return found(
      await pool.query(`SELECT ${organizationColumns} FROM app.organization WHERE id=$1`, [org]),
    );
  });
  app.patch('/api/admin/organization', async (req) => {
    // The code is an ordinary unique attribute (every table refers to the id), so it may change;
    // left out, it stays as it is.
    const name = v.text(req.body?.name, '企业名称', 200),
      code = req.body?.code === undefined ? null : v.code(req.body.code),
      revision = v.version(req.body?.rowVersion);
    return write(
      req,
      'org.profile:edit',
      'admin.organization.update',
      'organization',
      async (db) => ({
        subjectId: org,
        data: changed(
          await db.query(
            `UPDATE app.organization SET name=$2,code=COALESCE($4,code),row_version=row_version+1,updated_at=now() WHERE id=$1 AND row_version=$3 RETURNING ${organizationColumns}`,
            [org, name, revision, code],
          ),
        ),
      }),
    );
  });

  app.get('/api/admin/customers', async (req) => {
    await authorize(req, 'customer:view');
    return (
      await pool.query(
        `SELECT ${customerColumns} FROM app.customer c WHERE c.organization_id=$1 ORDER BY c.name,c.id`,
        [org],
      )
    ).rows;
  });
  const customer = async (db, id) =>
    found(
      await db.query(
        `SELECT ${customerColumns} FROM app.customer c WHERE c.organization_id=$1 AND c.id=$2`,
        [org, id],
      ),
      '客户',
    );
  app.post('/api/admin/customers', async (req, reply) => {
    const input = v.customerInput(req.body);
    const result = await write(
      req,
      'customer:manage',
      'admin.customer.create',
      'customer',
      async (db) => {
        const { id } = changed(
          await db.query(
            `INSERT INTO app.customer(organization_id,code,name,customer_kind,status,description) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
            [org, input.code, input.name, input.customerKind, input.status, input.description],
          ),
        );
        return { subjectId: id, data: await customer(db, id) };
      },
    );
    reply.code(201);
    return result;
  });
  app.patch('/api/admin/customers/:id', async (req) => {
    const id = v.uuid(req.params.id),
      input = v.customerInput(req.body),
      revision = v.version(req.body.rowVersion);
    return write(req, 'customer:manage', 'admin.customer.update', 'customer', async (db) => {
      await customer(db, id);
      changed(
        await db.query(
          `UPDATE app.customer SET code=$3,name=$4,customer_kind=$5,status=$6::varchar,description=$7,row_version=row_version+1,updated_at=now() WHERE organization_id=$1 AND id=$2 AND row_version=$8 RETURNING id`,
          [
            org,
            id,
            input.code,
            input.name,
            input.customerKind,
            input.status,
            input.description,
            revision,
          ],
        ),
      );
      return { subjectId: id, data: await customer(db, id) };
    });
  });

  // Every project of the organization (section 4.3 “企业 → 项目”).
  app.get('/api/admin/projects', async (req) => {
    await authorize(req, 'project.directory:view');
    return (
      await pool.query(
        `SELECT p.id,p.code,p.name,p.short_name AS "shortName",p.customer_id AS "customerId",c.name AS "customerName",
          p.project_type AS "projectType",p.status,p.is_paused AS "isPaused",p.planned_start_date::text AS "plannedStartDate",
          p.planned_end_date::text AS "plannedEndDate",mgr.display_name AS "managerName",
          (SELECT count(*)::int FROM app.project_member pm WHERE pm.organization_id=p.organization_id AND pm.project_id=p.id AND pm.status='active') AS "memberCount",
          (SELECT planned_on::text FROM app.project_milestone m WHERE m.project_id=p.id AND m.milestone_key='go_live') AS "goLive",
          (SELECT h.overall FROM app.project_health h WHERE h.project_id=p.id ORDER BY h.reported_on DESC,h.created_at DESC LIMIT 1) AS health
        FROM app.project p JOIN app.customer c ON c.organization_id=p.organization_id AND c.id=p.customer_id
        LEFT JOIN app.app_user mgr ON mgr.id=p.manager_id
        WHERE p.organization_id=$1 ORDER BY p.status='archived',p.updated_at DESC,p.id`,
        [org],
      )
    ).rows;
  });
  // A new project starts with the SAP Activate phases and the preset milestones; with a
  // manager, that user joins as project manager (C_PM).
  app.post('/api/admin/projects', async (req, reply) => {
    const input = v.newProjectInput(req.body);
    const result = await write(
      req,
      'project:create',
      'admin.project.create',
      'project',
      async (db, current) => {
        const owner = await customer(db, input.customerId);
        if (owner.status !== 'active') throw failure(409, '客户已停用，不能创建新项目。');
        const { id } = changed(
          await db.query(
            `INSERT INTO app.project(organization_id,customer_id,code,name,short_name,project_type,planned_start_date,planned_end_date,manager_id)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
            [
              org,
              input.customerId,
              input.code,
              input.name,
              input.shortName,
              input.projectType,
              input.plannedStartDate,
              input.plannedEndDate,
              input.managerId,
            ],
          ),
        );
        await db.query(
          `INSERT INTO app.project_phase(organization_id,project_id,phase_key,name,sort)
        SELECT $1,$2,key,name,ord FROM unnest($3::text[],$4::text[]) WITH ORDINALITY AS t(key,name,ord)`,
          [org, id, PHASES.map((p) => p.key), PHASES.map((p) => p.name)],
        );
        await db.query(
          `INSERT INTO app.project_milestone(organization_id,project_id,milestone_key,name,phase_key,sort)
        SELECT $1,$2,key,name,phase,ord FROM unnest($3::text[],$4::text[],$5::text[]) WITH ORDINALITY AS t(key,name,phase,ord)`,
          [
            org,
            id,
            MILESTONES.map((m) => m.key),
            MILESTONES.map((m) => m.name),
            MILESTONES.map((m) => m.phase),
          ],
        );
        if (input.managerId) {
          const grant = await ctx.requireProject(db, current, id, 'project.member:manage');
          await addMember(org, db, current, grant, input.managerId, ['C_PM']);
        }
        return {
          subjectId: id,
          data: { id },
          details: { code: input.code, managerId: input.managerId },
        };
      },
    );
    reply.code(201);
    return result;
  });
}
