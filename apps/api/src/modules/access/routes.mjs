import { roleRoutes } from './roles.mjs';
import { assignmentRoutes } from './assignments.mjs';
import { memberRoutes } from './members.mjs';

export function registerAccessRoutes(app, ctx) {
  roleRoutes(app, ctx);
  assignmentRoutes(app, ctx);
  memberRoutes(app, ctx);
  // The user's permissions in one project (codes with module / own-item limits), for menus
  // and buttons; the API checks every request again.
  app.get('/api/projects/:projectId/access', async (req) => {
    const { grant } = await ctx.readProject(req);
    return grant.toJSON();
  });
}
