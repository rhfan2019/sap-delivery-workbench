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
  rowVersion: string;
}
export interface AdminProject {
  id: string;
  customerId: string;
  code: string;
  name: string;
  projectType: string;
  status: string;
  description: string;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  rowVersion: string;
}
export interface AdminUser {
  id: string;
  loginName: string;
  displayName: string;
  email: string | null;
  status: 'active' | 'disabled';
  rowVersion: string;
  lastLoginAt: string | null;
  memberStatus: 'active' | 'disabled';
  accessLevel: 'admin' | 'member';
  memberVersion: string;
  joinedAt: string;
  projectCount: number;
}
export interface ProjectMember {
  id: string;
  displayName: string;
  loginName: string;
  accountStatus: string;
  organizationStatus: string;
  status: string;
  rowVersion: string;
  joinedAt: string;
}
export const projectStatus = (status: string) =>
  ({ preparing: '准备中', active: '进行中', completed: '已完成', archived: '已归档' })[status] ??
  status;
export const displayDate = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(value))
    : '—';
