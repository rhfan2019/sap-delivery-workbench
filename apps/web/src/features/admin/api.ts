import { api } from '../../services/session';

// The admin module's API: organization profile, customers, the organization's projects, accounts.
export interface Organization {
  id: string;
  code: string;
  name: string;
  status: string;
  rowVersion: string;
}
export interface Customer {
  id: string;
  code: string;
  name: string;
  customerKind: 'external' | 'self';
  status: 'active' | 'inactive';
  description: string;
  projectCount: number;
  rowVersion: string;
}
export interface DirectoryProject {
  id: string;
  code: string;
  name: string;
  shortName: string;
  customerId: string;
  customerName: string;
  projectType: string;
  status: string;
  isPaused: boolean;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  managerName: string | null;
  memberCount: number;
  goLive: string | null;
  health: string | null;
}
export interface AdminUser {
  id: string;
  loginName: string;
  displayName: string;
  email: string | null;
  status: 'active' | 'disabled';
  rowVersion: string;
  lastLoginAt: string | null;
  createdAt: string;
  projectCount: number;
  personType: 'employee' | 'subcontractor' | 'external';
  skillModules: string[];
  position: { id: string; name: string } | null;
  roles: { code: string; name: string; validTo: string | null }[];
}
export const adminApi = {
  organization: () => api<Organization>('/admin/organization'),
  saveOrganization: (body: unknown) => api<Organization>('/admin/organization', body, 'PATCH'),
  customers: () => api<Customer[]>('/admin/customers'),
  saveCustomer: (body: unknown, id?: string) =>
    api<Customer>('/admin/customers' + (id ? '/' + id : ''), body, id ? 'PATCH' : 'POST'),
  projects: () => api<DirectoryProject[]>('/admin/projects'),
  createProject: (body: unknown) => api<{ id: string }>('/admin/projects', body),
  users: () => api<AdminUser[]>('/admin/users'),
  user: (id: string) => api<AdminUser>('/admin/users/' + id),
  createUser: (body: unknown) =>
    api<{ user: AdminUser; temporaryPassword: string; granted: string[] }>('/admin/users', body),
  saveUser: (id: string, body: unknown) =>
    api<{ user: AdminUser; granted: string[] }>('/admin/users/' + id, body, 'PATCH'),
  resetPassword: (id: string, rowVersion: string) =>
    api<{ temporaryPassword: string }>(`/admin/users/${id}/reset-password`, { rowVersion }),
  purgeSapCredentials: (id: string) =>
    api<{ removed: number }>(`/admin/users/${id}/sap-credentials`, {}, 'DELETE'),
};
