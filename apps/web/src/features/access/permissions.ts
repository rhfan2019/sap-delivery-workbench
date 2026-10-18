// The web side of the permission model (docs/specs/project-access-admin.md 2). Pure functions:
// the API decides every request again; these only choose what to show.
import { SCOPED_PERMISSIONS } from '@sap-delivery-workbench/contracts/access/catalog';
import type { ProjectAccess } from '../../services/session';

// Does the project grant allow `code`; for one item when `module` / `owners` are given.
export function allows(
  access: ProjectAccess | null | undefined,
  code: string,
  item?: { module?: string; owners?: string[] },
  userId?: string,
): boolean {
  if (!access?.permissions.includes(code)) return false;
  if (!item || !SCOPED_PERMISSIONS.includes(code)) return true;
  // Without limits for the code the grant has no module or own-item narrowing.
  const grants = access.limits?.[code];
  if (!grants?.length) return true;
  return grants.some(
    (g) =>
      (item.module === undefined || !g.modules.length || g.modules.includes(item.module)) &&
      (item.owners === undefined || !g.ownOnly || (!!userId && item.owners.includes(userId))),
  );
}
