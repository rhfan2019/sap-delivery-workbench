import { api } from '../../services/session';
import type { Organization, Customer, AdminProject, AdminUser, ProjectMember } from './types';

export const adminApi = {
  organization: () => api<Organization>('/admin/organization'),
  customers: () => api<Customer[]>('/admin/customers'),
  projects: () => api<AdminProject[]>('/admin/projects'),
  users: () => api<AdminUser[]>('/admin/users'),
  projectMembers: (id: string) => api<ProjectMember[]>(`/admin/projects/${id}/members`),
  saveOrganization: (body: unknown) => api<Organization>('/admin/organization', body, 'PATCH'),
  saveCustomer: (body: unknown, id?: string) =>
    api<Customer>('/admin/customers' + (id ? '/' + id : ''), body, id ? 'PATCH' : 'POST'),
  saveProject: (body: unknown, id?: string) =>
    api<AdminProject>('/admin/projects' + (id ? '/' + id : ''), body, id ? 'PATCH' : 'POST'),
  createUser: (body: unknown) =>
    api<{ user: AdminUser; temporaryPassword: string }>('/admin/users', body),
  saveUser: (id: string, body: unknown) => api<AdminUser>('/admin/users/' + id, body, 'PATCH'),
  saveMember: (id: string, body: unknown) => api<AdminUser>('/admin/members/' + id, body, 'PATCH'),
  resetPassword: (id: string, rowVersion: string) =>
    api<{ temporaryPassword: string }>(`/admin/users/${id}/reset-password`, { rowVersion }),
  addMember: (projectId: string, userId: string) =>
    api(`/admin/projects/${projectId}/members`, { userId }),
  removeMember: (projectId: string, userId: string, rowVersion: string) =>
    api(`/admin/projects/${projectId}/members/${userId}`, { rowVersion }, 'DELETE'),
};
