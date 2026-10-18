import { accessContext } from '../access/public.mjs';
import { organizationRoutes } from './organizations.mjs';
import { userRoutes } from './users.mjs';
import { projectRoutes } from './projects.mjs';

export function registerAdminRoutes(app, pool, organizationId, requireSession) {
  const context = accessContext(pool, organizationId, requireSession);
  organizationRoutes(app, context);
  userRoutes(app, context);
  projectRoutes(app, context);
}
