import { adminContext } from './context.mjs';
import { organizationRoutes } from './organizations.mjs';
import { memberRoutes } from './members.mjs';

export function registerAdminRoutes(app, pool, organizationId, requireSession) {
  const context = adminContext(pool, organizationId, requireSession);
  organizationRoutes(app, context);
  memberRoutes(app, context);
}
