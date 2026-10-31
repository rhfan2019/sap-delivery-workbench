import { deliveryContext } from './context.mjs';
import { itemRoutes } from './items.mjs';
import { batchRoutes } from './batch.mjs';
import { catalogRoutes } from './catalog.mjs';
import { excelRoutes } from './excel.mjs';
import { fileRoutes } from './files.mjs';
import { transaction } from '../../platform/auth.mjs';
import { createAccess } from '../access/public.mjs';
export function registerDeliveryRoutes(app, pool, organizationId, requireSession) {
  const c = deliveryContext(pool, organizationId, requireSession);
  const access = createAccess(pool, organizationId);
  itemRoutes(app, c);
  batchRoutes(app, c);
  catalogRoutes(app, c);
  excelRoutes(app, c);
  fileRoutes(app, c);
  app.get('/api/project-preference', async (req) => {
    const current = await requireSession(req, true);
    const { rows } = await pool.query(
      `SELECT pref.project_id AS "projectId" FROM app.project_preference pref
      JOIN app.project p ON p.id=pref.project_id AND p.organization_id=pref.organization_id
      WHERE pref.organization_id=$1 AND pref.user_id=$2 AND p.status<>'archived'`,
      [organizationId, current.user.id],
    );
    // The remembered project counts only while the user may still enter it.
    const projectId = rows[0]?.projectId;
    if (!projectId) return { projectId: null };
    const grant = await access.project(pool, current.user.id, projectId);
    return { projectId: grant?.has('project:view') ? projectId : null };
  });
  app.post('/api/project-preference', async (req) => {
    const current = await requireSession(req, true);
    return transaction(pool, async (db) => {
      await db.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))', [
        organizationId,
      ]);
      const projectId = req.body?.projectId ?? null;
      if (projectId)
        await c.access(db, current, projectId, { write: true, permission: 'project:view' });
      await db.query(
        `INSERT INTO app.project_preference(organization_id,user_id,project_id) VALUES($1,$2,$3) ON CONFLICT(organization_id,user_id) DO UPDATE SET project_id=EXCLUDED.project_id`,
        [organizationId, current.user.id, projectId],
      );
      return { projectId };
    });
  });
}
