// Contract 3.5: the only entry other modules use for authorization.
export { createAccess, deniedError, hiddenProject } from './kernel.mjs';
export { accessContext } from './context.mjs';
export { syncBuiltInRoles, grantSuperAdmin } from './builtin.mjs';
export { registerAccessRoutes } from './routes.mjs';
export { describeUsers, saveProfile, keepsSuperAdmin, userAssignments } from './assignments.mjs';
export { projectMembers, addMember } from './members.mjs';
