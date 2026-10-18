export type PermissionScope = 'organization' | 'project';
export type PermissionKind = 'menu' | 'action' | 'field';
export interface PermissionGroup {
  key: string;
  label: string;
  scope: PermissionScope;
}
export interface Permission {
  code: string;
  group: string;
  kind: PermissionKind;
  label: string;
  description: string;
}
export interface BuiltInRole {
  code: string;
  kind: 'single' | 'composite';
  scope: PermissionScope;
  name: string;
  description: string;
  permissions?: string[];
  members?: string[];
}
export interface BuiltInPosition {
  code: string;
  name: string;
  organizationRoles: string[];
  projectRoles: string[];
}
export declare const PERMISSION_GROUPS: PermissionGroup[];
export declare const PERMISSIONS: Permission[];
export declare const PERMISSION_CODES: string[];
export declare function permissionOf(code: string): Permission | undefined;
export declare function groupOf(key: string | undefined): PermissionGroup | undefined;
export declare function scopeOf(code: string): PermissionScope | undefined;
export declare const PROJECT_PERMISSIONS: string[];
export declare const ORGANIZATION_PERMISSIONS: string[];
export declare function viewOf(code: string): string | undefined;
export declare const SENSITIVE_PERMISSIONS: string[];
export declare const SCOPED_PERMISSIONS: string[];
export declare const SUPER_ADMIN: string;
export declare const BUILT_IN_ROLES: BuiltInRole[];
export declare function builtInRole(code: string): BuiltInRole | undefined;
export declare const BUILT_IN_POSITIONS: BuiltInPosition[];
export declare const PERSON_TYPES: Record<'employee' | 'subcontractor' | 'external', string>;
export declare const PROJECT_SCOPES: Record<'all' | 'customers' | 'projects' | 'none', string>;
