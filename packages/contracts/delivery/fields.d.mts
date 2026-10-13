export type PhaseKey = 'fsd' | 'development' | 'consultant_test' | 'user_test';
export type GroupKey = 'basic' | PhaseKey | 'custom';
export type CustomType =
  | 'text'
  | 'long_text'
  | 'number'
  | 'date'
  | 'select'
  | 'multi_select'
  | 'member'
  | 'checkbox'
  | 'url';
export type FieldType =
  | 'readonly'
  | 'text'
  | 'rich'
  | 'date'
  | 'select'
  | 'member'
  | 'effort'
  | 'percent'
  | 'tags'
  | 'objects'
  | 'custom';

export interface Phase {
  key: PhaseKey;
  label: string;
  group: string;
  assignee: string;
  excel: string;
  effort: boolean;
}
export interface CustomOption {
  id: string;
  label: string;
  color?: string;
}
export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  group: GroupKey;
  excel: string;
  phase?: PhaseKey;
  name?: string;
  options?: Record<string, string> | CustomOption[];
  required?: boolean;
  max?: number;
  customType?: CustomType;
  archived?: boolean;
}
export interface CustomFieldDefinition {
  id: string;
  label: string;
  fieldType: CustomType;
  options: CustomOption[];
  groupKey: GroupKey;
  sortOrder: number;
  required: boolean;
  archivedAt: string | null;
  rowVersion: string;
}

export const PHASES: Phase[];
export const PHASE_KEYS: PhaseKey[];
export const GROUPS: { key: GroupKey; label: string }[];
export const OPTIONS: {
  module: Record<string, string>;
  kind: Record<string, string>;
  priority: Record<string, string>;
  difficulty: Record<string, string>;
  changeType: Record<string, string>;
  status: Record<string, string>;
};
export const CUSTOM_TYPES: Record<CustomType, string>;
export const TAG_COLORS: string[];
export const MAX_CUSTOM_FIELDS: number;
export const MAX_TAGS_PER_ITEM: number;
export const MAX_OBJECTS_PER_ITEM: number;
export const FIELDS: FieldDef[];
export const FIELD_MAP: Record<string, FieldDef>;
export const RESERVED_LABELS: Set<string>;
export function customKey(id: string): string;
export function customField(definition: CustomFieldDefinition): FieldDef;
export function fieldValue(item: object, key: string): unknown;
export function progressFor(status: string, progress: number): number;
export function richText(html: string | null | undefined): string;
