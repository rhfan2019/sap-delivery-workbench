import { api } from '../../services/session';

// Project SAP systems and personal credentials (docs/specs/project-access-admin.md 3).
export interface CredentialState {
  state: 'none' | 'session' | 'saved' | 'profile';
  username: string;
  savedAt?: string;
  expiresAt?: string;
  lastUsedAt?: string | null;
}
export interface SapSystem {
  id: string;
  projectId: string;
  name: string;
  purpose: 'development' | 'test';
  sid: string;
  sapUrl: string;
  client: string;
  language: string;
  description: string;
  isDefault: boolean;
  status: 'active' | 'inactive';
  testStatus: string | null;
  testMessage: string | null;
  testedAt: string | null;
  backendVersion: string | null;
  rowVersion: string;
  credential?: CredentialState;
  canRead?: boolean;
}
export interface ProjectSystems {
  projectId: string;
  readOnly: boolean;
  canManage: boolean;
  canSave: boolean;
  policy: { maxDays: number; idleDays: number };
  profileLogin: boolean;
  systems: SapSystem[];
}
export interface Policy {
  allowSave: boolean;
  maxDays: number;
  idleDays: number;
  subcontractorSave: boolean;
  rowVersion: string;
}
export const purposeLabel = (p: string) => (p === 'development' ? '开发系统' : '测试系统');
export const credentialLabel: Record<CredentialState['state'], string> = {
  none: '未登录',
  session: '本次登录有效',
  saved: '已加密保存',
  profile: '可用本机凭据文件',
};
const base = (projectId: string) => `/projects/${projectId}/sap-systems`;
export const sapApi = {
  systems: (projectId: string) => api<ProjectSystems>(base(projectId)),
  create: (projectId: string, body: unknown) => api<ProjectSystems>(base(projectId), body),
  update: (projectId: string, id: string, body: unknown) =>
    api<ProjectSystems>(`${base(projectId)}/${id}`, body, 'PATCH'),
  remove: (projectId: string, id: string, rowVersion: string) =>
    api<ProjectSystems>(`${base(projectId)}/${id}`, { rowVersion }, 'DELETE'),
  makeDefault: (projectId: string, id: string) =>
    api<ProjectSystems>(`${base(projectId)}/${id}/default`, {}),
  copy: (projectId: string, sourceProjectId: string) =>
    api<ProjectSystems & { copied: number }>(`${base(projectId)}/copy`, { sourceProjectId }),
  test: (projectId: string, id: string) =>
    api<{ status: string; message: string; version: string | null }>(
      `${base(projectId)}/${id}/test`,
      {},
    ),
  login: (
    projectId: string,
    id: string,
    body: { username: string; password: string; mode: string },
  ) => api<ProjectSystems>(`${base(projectId)}/${id}/credential`, body, 'PUT'),
  loginWithProfile: (projectId: string, id: string) =>
    api<ProjectSystems>(`${base(projectId)}/${id}/credential/profile`, {}),
  logout: (projectId: string, id: string) =>
    api<ProjectSystems>(`${base(projectId)}/${id}/credential`, undefined, 'DELETE'),
  mine: () =>
    api<{
      canSave: boolean;
      policy: { maxDays: number; idleDays: number };
      items: {
        projectId: string;
        projectCode: string;
        projectName: string;
        system: SapSystem;
        credential: CredentialState;
      }[];
    }>('/sap-credentials'),
  policy: () => api<Policy>('/admin/sap-credential-policy'),
  savePolicy: (body: unknown) => api<Policy>('/admin/sap-credential-policy', body, 'PUT'),
  savedCredentials: () =>
    api<
      {
        userId: string;
        displayName: string;
        loginName: string;
        projectCode: string;
        projectName: string;
        systemName: string;
        sid: string;
        client: string;
        sapUsername: string;
        savedAt: string;
        expiresAt: string;
        lastUsedAt: string | null;
      }[]
    >('/admin/sap-credentials'),
  directory: () =>
    api<
      (SapSystem & {
        projectCode: string;
        projectName: string;
        projectStatus: string;
        customerName: string;
      })[]
    >('/admin/sap-systems'),
};
