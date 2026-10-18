import { api } from '../../services/session';

// Types and calls of the access module's API (docs/specs/project-access-admin.md 2).
export interface Role {
  id: string;
  code: string;
  name: string;
  description: string;
  kind: 'single' | 'composite';
  scope: 'organization' | 'project';
  builtIn: boolean;
  status: 'active' | 'inactive';
  rowVersion: string;
  permissions: string[];
  members: { id: string; code: string; name: string; scope: string; status: string }[];
  assignmentCount: number;
  projectAssignmentCount: number;
  compositeCount: number;
  positionCount: number;
  inUse: boolean;
}
export interface Holder {
  level: 'organization' | 'project';
  assignmentId: string;
  userId: string;
  displayName: string;
  loginName: string;
  viaCode: string;
  viaName: string;
  projectScope: string;
  projectId: string | null;
  projectName: string | null;
  validFrom: string;
  validTo: string | null;
}
export interface RoleDetail extends Role {
  containedIn: { id: string; code: string; name: string }[];
  holders: Holder[];
}
export interface Position {
  id: string;
  code: string;
  name: string;
  description: string;
  status: 'active' | 'inactive';
  rowVersion: string;
  userCount: number;
  roles: { id: string; code: string; name: string; scope: string; kind: string }[];
}
export interface ProjectRole {
  id: string;
  roleId: string;
  roleCode: string;
  roleName: string;
  roleKind: string;
  modules: string[];
  ownOnly: boolean;
  validFrom: string;
  validTo: string | null;
  active: boolean;
  rowVersion: string;
}
export interface Member {
  id: string;
  displayName: string;
  loginName: string;
  email: string | null;
  accountStatus: string;
  personType: string;
  skillModules: string[];
  positionName: string | null;
  joinedAt: string;
  rowVersion: string;
  roles: ProjectRole[];
}
export interface Candidate {
  id: string;
  displayName: string;
  loginName: string;
  personType: string;
  skillModules: string[];
  positionName: string | null;
  defaultRoleIds: string[];
}
export interface Assignment {
  id: string;
  roleId: string;
  roleCode: string;
  roleName: string;
  roleKind: string;
  projectScope: 'all' | 'customers' | 'projects' | 'none';
  scopeIds: string[];
  validFrom: string;
  validTo: string | null;
  grantedBy: string | null;
  grantedAt: string;
  active: boolean;
  rowVersion: string;
}
export interface Source {
  assignmentId: string;
  level: 'organization' | 'project';
  roleCode: string;
  roleName: string;
  modules: string[];
  ownOnly: boolean;
  validTo: string | null;
}
export interface UserAccess {
  assignments: Assignment[];
  projectRoles: (ProjectRole & {
    projectId: string;
    projectCode: string;
    projectName: string;
    projectStatus: string;
  })[];
  organization: { code: string; sources: Source[] }[];
  projects: {
    projectId: string;
    projectCode: string;
    projectName: string;
    permissions: { code: string; sources: Source[] }[];
  }[];
}

export const accessApi = {
  roles: () => api<Role[]>('/admin/roles'),
  role: (id: string) => api<RoleDetail>('/admin/roles/' + id),
  createRole: (body: unknown) => api<Role>('/admin/roles', body),
  saveRole: (id: string, body: unknown) => api<Role>('/admin/roles/' + id, body, 'PATCH'),
  deleteRole: (id: string, rowVersion: string) =>
    api('/admin/roles/' + id, { rowVersion }, 'DELETE'),
  holders: (code: string) =>
    api<Holder[]>(`/admin/permissions/${encodeURIComponent(code)}/holders`),
  positions: () => api<Position[]>('/admin/positions'),
  savePosition: (id: string | null, body: unknown) =>
    id
      ? api<Position>('/admin/positions/' + id, body, 'PATCH')
      : api<Position>('/admin/positions', body),
  deletePosition: (id: string, rowVersion: string) =>
    api('/admin/positions/' + id, { rowVersion }, 'DELETE'),
  userAccess: (id: string) => api<UserAccess>(`/admin/users/${id}/access`),
  assign: (userId: string, body: unknown) =>
    api<Assignment[]>(`/admin/users/${userId}/assignments`, body),
  saveAssignment: (id: string, body: unknown) =>
    api<Assignment[]>('/admin/assignments/' + id, body, 'PATCH'),
  revoke: (id: string, rowVersion: string) =>
    api<Assignment[]>('/admin/assignments/' + id, { rowVersion }, 'DELETE'),
  projectRoles: (projectId: string) => api<Role[]>(`/projects/${projectId}/roles`),
  members: (projectId: string) => api<Member[]>(`/projects/${projectId}/members`),
  candidates: (projectId: string) => api<Candidate[]>(`/projects/${projectId}/member-candidates`),
  addMember: (projectId: string, body: unknown) =>
    api<Member[]>(`/projects/${projectId}/members`, body),
  setRoles: (projectId: string, userId: string, roles: unknown) =>
    api<Member[]>(`/projects/${projectId}/members/${userId}/roles`, { roles }, 'PUT'),
  removeMember: (projectId: string, userId: string, rowVersion: string) =>
    api<Member[]>(`/projects/${projectId}/members/${userId}`, { rowVersion }, 'DELETE'),
};

// An end date within 7 days reads “即将到期” (section 2.7).
export function expiresSoon(validTo: string | null | undefined, days = 7) {
  if (!validTo) return false;
  const left =
    (Date.parse(validTo.slice(0, 10)) - Date.parse(new Date().toISOString().slice(0, 10))) /
    86400000;
  return left >= 0 && left <= days;
}
export const day = (value: string | null | undefined) => (value ? value.slice(0, 10) : '');
