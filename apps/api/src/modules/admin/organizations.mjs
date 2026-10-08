import { failure } from '../../platform/auth.mjs';
import { changed, found } from './context.mjs';
import * as v from './validation.mjs';

const organizationColumns = 'id,code,name,status,row_version AS "rowVersion"';
const customerColumns =
  'id,code,name,customer_kind AS "customerKind",status,description,row_version AS "rowVersion"';
const projectColumns = `id,customer_id AS "customerId",code,name,project_type AS "projectType",status,description,
  planned_start_date::text AS "plannedStartDate",planned_end_date::text AS "plannedEndDate",row_version AS "rowVersion"`;

export function organizationRoutes(app, ctx) {
  const { pool, organizationId: org, authorize, write } = ctx;
  app.get('/api/admin/organization', async (req) => {
    await authorize(req);
    return found(
      await pool.query(`SELECT ${organizationColumns} FROM app.organization WHERE id=$1`, [org]),
    );
  });
  app.patch('/api/admin/organization', async (req) => {
    const name = v.text(req.body?.name, '企业名称', 200),
      revision = v.version(req.body?.rowVersion);
    return write(req, 'admin.organization.update', 'organization', async (db) => ({
      subjectId: org,
      data: changed(
        await db.query(
          `UPDATE app.organization SET name=$2,row_version=row_version+1,updated_at=now() WHERE id=$1 AND row_version=$3 RETURNING ${organizationColumns}`,
          [org, name, revision],
        ),
      ),
    }));
  });
  app.get('/api/admin/customers', async (req) => {
    await authorize(req);
    return (
      await pool.query(
        `SELECT ${customerColumns} FROM app.customer WHERE organization_id=$1 ORDER BY name,id`,
        [org],
      )
    ).rows;
  });
  app.post('/api/admin/customers', async (req, reply) => {
    const input = v.customerInput(req.body);
    const result = await write(req, 'admin.customer.create', 'customer', async (db) => {
      const row = changed(
        await db.query(
          `INSERT INTO app.customer(organization_id,code,name,customer_kind,status,description) VALUES($1,$2,$3,$4,$5,$6) RETURNING ${customerColumns}`,
          [org, input.code, input.name, input.customerKind, input.status, input.description],
        ),
      );
      return { subjectId: row.id, data: row };
    });
    reply.code(201);
    return result;
  });
  app.patch('/api/admin/customers/:id', async (req) => {
    const id = v.uuid(req.params.id),
      input = v.customerInput(req.body),
      revision = v.version(req.body.rowVersion);
    return write(req, 'admin.customer.update', 'customer', async (db) => {
      found(
        await db.query('SELECT id FROM app.customer WHERE organization_id=$1 AND id=$2', [org, id]),
        '客户',
      );
      const row = changed(
        await db.query(
          `UPDATE app.customer SET code=$3,name=$4,customer_kind=$5,status=$6::varchar,description=$7,row_version=row_version+1,updated_at=now() WHERE organization_id=$1 AND id=$2 AND row_version=$8 RETURNING ${customerColumns}`,
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
      return { subjectId: id, data: row };
    });
  });
  app.get('/api/admin/projects', async (req) => {
    await authorize(req);
    return (
      await pool.query(
        `SELECT ${projectColumns} FROM app.project WHERE organization_id=$1 ORDER BY name,id`,
        [org],
      )
    ).rows;
  });
  app.post('/api/admin/projects', async (req, reply) => {
    const input = v.projectInput(req.body);
    if (input.status === 'archived') throw failure(400, '新项目不能直接归档。');
    const result = await write(req, 'admin.project.create', 'project', async (db) => {
      const customer = found(
        await db.query('SELECT status FROM app.customer WHERE organization_id=$1 AND id=$2', [
          org,
          input.customerId,
        ]),
        '客户',
      );
      if (customer.status !== 'active') throw failure(409, '客户已停用，不能创建新项目。');
      const row = changed(
        await db.query(
          `INSERT INTO app.project(organization_id,customer_id,code,name,project_type,status,description,planned_start_date,planned_end_date) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${projectColumns}`,
          [
            org,
            input.customerId,
            input.code,
            input.name,
            input.projectType,
            input.status,
            input.description,
            input.plannedStartDate,
            input.plannedEndDate,
          ],
        ),
      );
      return { subjectId: row.id, data: row };
    });
    reply.code(201);
    return result;
  });
  app.patch('/api/admin/projects/:id', async (req) => {
    const id = v.uuid(req.params.id),
      input = v.projectInput(req.body),
      revision = v.version(req.body.rowVersion);
    return write(req, 'admin.project.update', 'project', async (db) => {
      const existing = found(
        await db.query(
          'SELECT status,customer_id FROM app.project WHERE organization_id=$1 AND id=$2',
          [org, id],
        ),
        '项目',
      );
      if (existing.status === 'archived') throw failure(409, '已归档项目只读。');
      if (existing.customer_id !== input.customerId)
        throw failure(400, '项目所属客户不能在此更改。');
      const row = changed(
        await db.query(
          `UPDATE app.project SET code=$3,name=$4,project_type=$5,status=$6::varchar,description=$7,planned_start_date=$8,planned_end_date=$9,archived_at=CASE WHEN $6='archived' THEN now() ELSE NULL END,is_paused=CASE WHEN $6 IN ('completed','archived') THEN false ELSE is_paused END,row_version=row_version+1,updated_at=now() WHERE organization_id=$1 AND id=$2 AND row_version=$10 RETURNING ${projectColumns}`,
          [
            org,
            id,
            input.code,
            input.name,
            input.projectType,
            input.status,
            input.description,
            input.plannedStartDate,
            input.plannedEndDate,
            revision,
          ],
        ),
      );
      return { subjectId: id, data: row };
    });
  });
}
